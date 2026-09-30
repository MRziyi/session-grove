// One-time import. The source database and old WebDAV vault are never modified.
// Run --prepare first; add --publish to send the prepared current state to Git.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync, backup } from 'node:sqlite';
import { Store } from '../src/store.js';
import { Cloud } from '../src/cloud.js';
import { GitCloud } from '../src/git-cloud.js';
import { bodyRefs, retainedGraph, withForkMetadata } from '../src/retention.js';
import { decodeRevisionRefs } from '../src/revision-wire.js';
import { copyRecords, downloadRecords } from '../src/record-packs.js';
import { deletedIds, trashState, applyTrashState } from '../src/trash.js';
import { claudeFork } from '../src/claude.js';
import { assert, atomic, json, hash, now } from '../src/util.js';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const source = path.resolve(option('--source', path.join(os.homedir(), '.session-grove')));
const root = path.resolve(option('--staging', '.grove/git-migration'));
const remote = option('--remote', null);
assert(remote, 'Pass --remote git@host:owner/repository.git');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const file = path.join(root, 'grove.sqlite'), prepared = path.join(root, 'prepared.json');
if (!fs.existsSync(file)) {
    const db = new DatabaseSync(path.join(source, 'grove.sqlite'), { readOnly: true });
    try { await backup(db, file); } finally { db.close(); }
    fs.copyFileSync(path.join(source, 'device.json'), path.join(root, 'device.json'));
}
const store = new Store(root), caches = [];
let legacy, git;
try {
    if (!fs.existsSync(prepared)) {
        let remoteGraphs = [];
        const config = json(path.join(source, 'webdav.json'), {});
        if (config.url && !args.includes('--local-only')) {
            const key = fs.readFileSync(path.join(source, 'sync-key.txt'), 'utf8').replace(/\r?\n$/, '');
            legacy = new Cloud(store, () => config);
            await legacy.catalog(key);
            for (const project of legacy.summaries()) await legacy.project(project.id, key);
            const items = legacy.items();
            console.log(JSON.stringify({ phase: 'Reading previous directory', trees: items.length }));
            let count = 0;
            for (const item of items) {
                for (const version of item.versions) remoteGraphs.push(decodeRevisionRefs(await legacy.manifest(version.ref)));
                console.log(JSON.stringify({ phase: 'Reading previous manifests', completed: ++count, total: items.length }));
            }
            const base = path.join(source, 'transfer-cache');
            if (fs.existsSync(base)) for (const dir of fs.readdirSync(base)) {
                const dbFile = path.join(base, dir, 'grove.sqlite');
                if (!fs.existsSync(dbFile)) continue;
                const db = new DatabaseSync(dbFile, { readOnly: true });
                caches.push({ db, objectStatement: db.prepare('SELECT body FROM objects WHERE hash=?') });
            }
        }
        const graphs = [store.exportGraph(), ...remoteGraphs];
        const archivedProjects = new Set(graphs.flatMap(g => g.projects.filter(p => p.archived).map(p => p.id)));
        const removed = new Set(graphs.flatMap(g => g.branches.filter(b => b.archived || archivedProjects.has(b.projectId)).map(b => b.id)));
        const events = [...trashState(store).events, ...(store.local('trashPending') || [])];
        if (removed.size) events.push({ id: 'git-migration-archives-' + hash([...removed].sort().join(',')), deviceId: store.device.id, at: now(), branchIds: [...removed], treeIds: [], heads: {}, nativeIds: [] });
        applyTrashState(store, { schema: 1, events, cleanupComplete: true });
        const deleted = deletedIds(store, { branches: graphs.flatMap(g => g.branches) });
        let completed = 0;
        const neededGraphs = remoteGraphs.map(graph => {
            const kept = retainedGraph(graph, deleted);
            const checkpoint = kept.branches.some(b => b.agent === 'claude' && graph.revisions.find(r => r.id === b.head)?.source?.claudeCheckpoint);
            return { graph, kept, input: checkpoint ? graph : { ...kept, packs: graph.packs } };
        }).filter(({kept}) => kept.branches.some(b => !b.synthetic));
        const refs = [...new Set(neededGraphs.flatMap(({input}) => bodyRefs(input)))];
        let reused = 0; for (const cache of caches) reused += copyRecords(cache, store, refs);
        const exists = store.db.prepare('SELECT 1 FROM objects WHERE hash=?');
        const missing = new Set(refs.filter(h => !exists.get(h)));
        console.log(JSON.stringify({ phase: 'Reusing local records', reused, missing: missing.size, excludedArchivedBranches: removed.size, deletedEvents: events.length }));
        let last = 0;
        for (const { graph, input } of neededGraphs) {
            await downloadRecords(store, legacy.connection.dav, legacy.connection.key, input, () => {
                if (Date.now() - last > 3000) { last = Date.now(); console.log(JSON.stringify({ phase: 'Fetching remaining legacy records', remaining: missing.size })); }
            }, () => {}, { globalMissing: missing });
            const kept = retainedGraph(withForkMetadata(graph, h => store.objectStatement.get(h)?.body, claudeFork, deleted), deleted);
            store.merge(kept, {}, { latest: true });
            console.log(JSON.stringify({ phase: 'Imported previous sessions', completed: ++completed, total: neededGraphs.length }));
        }
        assert(!(store.local('conflicts') || []).length, 'Resolve existing session conflicts before migration.');
        const current = store.exportGraph(), prohibited = current.branches.filter(b => !b.synthetic && (b.archived || removed.has(b.id) || deleted.has(b.id)));
        assert(!prohibited.length, 'Excluded sessions leaked into the migration.');
        // A stale device cannot reintroduce excluded sessions. No recovery blobs are committed.
        const report = { phase: 'Prepared', at: now(), sessions: current.branches.filter(b => !b.synthetic).length, trees: store.syncCollections().items.length, records: bodyRefs(current).length, excludedArchivedBranches: removed.size, deletedEvents: events.length };
        atomic(prepared, JSON.stringify(report)); console.log(JSON.stringify(report));
    } else console.log(fs.readFileSync(prepared, 'utf8'));
    if (args.includes('--publish')) {
        git = new GitCloud(store, () => ({ provider: 'git', url: remote }));
        let phase, progressAt = 0;
        git.onProgress = p => { if (p.phase !== phase || p.completed === p.total || Date.now() - progressAt >= 3000) { phase = p.phase; progressAt = Date.now(); const { detail, ...progress } = p; console.log(JSON.stringify(progress)); } };
        await git.catalog();
        assert(!git.connection.remote.head, 'Initial migration requires an empty destination repository.');
        const result = await git.publish(git.dirtyIds(), '', { catalogFresh: true });
        console.log(JSON.stringify({ phase: 'Published', ...result }));
    }
} finally { git?.lock(); legacy?.connection?.dav.controller.abort(); caches.forEach(c => c.db.close()); store.close(); }
