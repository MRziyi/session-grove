import { claudeFork } from './claude.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store.js';
import { Cloud } from './cloud.js';
import { WebDAV, sealAsync, unseal, davSucceeded, assertDavListing } from './sync.js';
import { decodeRevisionRefs } from './revision-wire.js';
import { copyRecords, copySummaries, downloadRecords } from './record-packs.js';
import { assert, atomic, hash, id, now, mapConcurrent } from './util.js';
import { retainedGraph, bodyRefs, withForkMetadata } from './retention.js';
import { applyTrashState, trashState, deletedIds, cleanupLocal } from './trash.js';
import { withVaultLock } from './dav-lock.js';
const directories = ['objects/', 'trees/', 'projects/', 'heads/', 'commits/'];
export function transferCachePath(cloud) { return path.join(cloud.store.root, 'transfer-cache', hash(cloud.cacheKey)); }
function retainedInput(graph, deleted) {
    const kept = retainedGraph(graph, deleted), revisions = new Map(graph.revisions.map(r => [r.id, r]));
    const needsMetadata = kept.branches.some(b => b.agent === 'claude' && revisions.get(b.head)?.source?.operation === 'fork' && revisions.get(b.head)?.source?.claudeCheckpoint);
    return { kept, needsMetadata, input: needsMetadata ? graph : { ...kept, packs: graph.packs } };
}
async function cleanupTargets(rootDav, newGeneration) {
    const targets = [...directories];
    const r = await rootDav.request('PROPFIND', 'generations/', undefined, { Depth: '1' });
    if (r.status !== 404) {
        assert(r.ok, 'Cannot enumerate old cloud generations.');
        const xml = (await rootDav.readResponse(r, 16 * 1024 * 1024)).toString();
        assertDavListing(xml);
        for (const m of xml.matchAll(/<(?:[\w-]+:)?href[^>]*>([^<]+)<\/(?:[\w-]+:)?href>/g)) {
            const name = decodeURIComponent(m[1]).split('/').filter(Boolean).at(-1);
            if (/^[a-f0-9]{32}$/.test(name) && name !== newGeneration)
                targets.push('generations/' + name + '/');
        }
    }
    return [...new Set(targets)];
}
function readManifest(encoded, key, ref) {
    const graph = unseal(encoded, key);
    assert(hash(JSON.stringify(graph)) === ref, 'Cloud manifest integrity check failed.');
    return decodeRevisionRefs(graph);
}
// Generation staging gives cleanup a single publication point. Bodies from
// trashed suffixes are never placed in the new generation.
export async function collectTrash(cloud, passphrase, { onPrepared = () => {}, onProgress = () => {} } = {}) {
    const connection = await cloud.connect(passphrase),
        { rootDav, dav, key, vaultBytes } = connection;
    return withVaultLock(rootDav, async (assertHeld) => {
        assert(
            (await rootDav.get('vault.json'))?.equals(vaultBytes),
            'Cloud generation changed. Retry Sync.',
        );
        const previousLease = await rootDav.get('migration.json');
        if (previousLease) {
            assert(
                JSON.parse(previousLease.toString()).kind === 'trash',
                'Cloud migration already in progress.',
            );
            const r = await rootDav.request('DELETE', 'migration.json');
            const body = await rootDav.readResponse(r, 1048576);
            assert(davSucceeded(r, body), 'Could not recover an interrupted Trash lease.');
        }
        const lease = Buffer.from(JSON.stringify({ id: id(), kind: 'trash', at: now() }));
        assert(
            await rootDav.put('migration.json', lease, true),
            'Another cloud operation is in progress.',
        );
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-retention-')),
            stage = new Store(path.join(temp, 'library')),
            journal = path.join(cloud.store.root, 'trash-cleanup.json');
        const generation = randomBytes(16).toString('hex'),
            nextDav = rootDav.scoped('generations/' + generation + '/');
        const cachePath = transferCachePath(cloud); fs.mkdirSync(cachePath, { recursive: true, mode: 0o700 });
        const verified = new Store(cachePath);
        let committed = false, completedCleanup = false;
        try {
            await cloud.catalog(passphrase);
            for (const p of cloud.summaries()) await cloud.project(p.id, passphrase);
            const events = [
                    ...trashState(cloud.store).events,
                    ...(cloud.store.local('trashPending') || []),
                ],
                state = {
                    schema: 1,
                    cleanupComplete: false,
                    events: [...new Map(events.map((e) => [e.id, e])).values()],
                };
            applyTrashState(stage, state);
            const versions = [...new Map(cloud.items({ includeTrashed: true }).flatMap(item => item.versions).map(v => [v.ref, v])).values()];
            const manifests = [], branchGroups = [], manifestCount = versions.length, manifestStart = Date.now();
            let manifestDone = 0;
            cloud.report('Reading cloud session manifests', 0, manifestCount, manifestStart);
            await mapConcurrent(versions, async (v, index) => {
                const encoded = cloud.cache().legacyGraphs[v.ref];
                const g = encoded || readManifest(await dav.get('trees/' + v.ref + '.bin'), key, v.ref);
                // Spool manifests to disk; retain only branch metadata between downloads.
                const file = path.join(temp, 'manifest-' + index + '.json');
                fs.writeFileSync(file, JSON.stringify(g), { mode: 0o600 });
                manifests[index] = file;
                branchGroups[index] = g.branches;
                cloud.report('Reading cloud session manifests', ++manifestDone, manifestCount, manifestStart);
            });
            const allBranches = branchGroups.flat();
            const deleted = deletedIds(stage, { branches: allBranches });
            // Existing cloud archives/background records are not implicitly
            // migrated to Trash by the current upload visibility policy.
            stage.local('preserveRemoteForRetention', [
                ...new Set(allBranches.filter((b) => !deleted.has(b.id)).map((b) => b.id)),
            ]);
            stage.invalidate();
            // Count missing records across all sessions once. Reuse verified downloads
            // across retries, and prefetch shared pack members needed by later sessions.
            const wanted = new Set();
            for (const file of manifests) { const g = JSON.parse(fs.readFileSync(file, 'utf8')), { kept, input } = retainedInput(g, deleted); if (kept.branches.length) for (const ref of bodyRefs(input)) wanted.add(ref); }
            const refs = [...wanted];
            copyRecords(cloud.store, stage, refs); const reused = copyRecords(verified, stage, refs);
            const exists = stage.db.prepare('SELECT 1 FROM objects WHERE hash=?'), missing = new Set(refs.filter(h => !exists.get(h))), total = missing.size, started = Date.now();
            cloud.store.local('lastTransferCache', { reused, missing: total, at: now() });
            const report = detail => { const done = total - missing.size; onProgress({ completed: done, total }); cloud.report('Preparing shared history', done, total, started, detail); };
            report(null);
            for (const file of manifests) {
                const g = JSON.parse(fs.readFileSync(file, 'utf8'));
                let { kept, input, needsMetadata } = retainedInput(g, deleted);
                if (kept.branches.length) {
                    const name = kept.branches.find(b => !b.synthetic && !b.trashDependency)?.name || null;
                    await downloadRecords(stage, dav, key, input, () => report(name), () => {}, { cache: verified, globalMissing: missing });
                    if (needsMetadata) {
                        kept = retainedGraph(
                            withForkMetadata(
                                g,
                                (h) => stage.objectStatement.get(h)?.body,
                                claudeFork,
                                deleted,
                            ),
                            deleted,
                        );
                    }
                    stage.merge(kept, {}, { latest: !!cloud.mergeByModified });
                    copySummaries(cloud.store, stage, kept);
                }
                fs.unlinkSync(file);
                await new Promise(resolve => setImmediate(resolve));
            }
            report(null);
            // Local surviving edits are included so Trash never races this device's work.
            const local = cloud.store.exportGraph();
            if (local.branches.length) {
                const kept = retainedGraph(local, deletedIds(cloud.store, local));
                copyRecords(cloud.store, stage, bodyRefs(kept));
                stage.merge(kept, {}, { latest: !!cloud.mergeByModified });
                copySummaries(cloud.store, stage, kept);
            }
            assert(
                !(stage.local('conflicts') || []).length,
                'Resolve context conflicts before reclaiming Trash.',
            );
            onPrepared();
            await rootDav.mkdir('generations/');
            await nextDav.mkdir();
            for (const dir of directories) await nextDav.mkdir(dir);
            const nextVault = {
                ...JSON.parse(vaultBytes.toString()),
                schema: 3,
                mode: JSON.parse(vaultBytes.toString()).mode || 'encrypted',
                generation,
                retentionVersion: 1,
            };
            const staged = new Cloud(stage, cloud.readConfig);
            staged.cacheKey = 'cloud:staging';
            staged.connection = {
                dav: nextDav,
                rootDav,
                key,
                vaultBytes: Buffer.from(JSON.stringify(nextVault)),
                retentionStaging: true,
            };
            staged.connect = async () => staged.connection;
            staged.onProgress = (p) => cloud.onProgress?.(p);
            const ids = stage.syncCollections().items.map((i) => i.id);
            const publication = ids.length ? await staged.publish(ids, passphrase, { catalogFresh: true }) : { uploaded: 0, published: 0 };
            const stateBytes = await sealAsync(state, key);
            await nextDav.put('trash-state.bin', stateBytes);
            assert(
                (await nextDav.get('trash-state.bin'))?.equals(stateBytes),
                'Deletion marker verification failed.',
            );
            // Read back all published manifests; record packs already passed read-back verification.
            for (const name of await nextDav.list('heads/', /^[a-f0-9-]+\.bin$/)) {
                const head = unseal(await nextDav.get('heads/' + name), key);
                for (const p of head.projects) {
                    const index = unseal(await nextDav.get('projects/' + p.index + '.bin'), key);
                    assert(
                        hash(JSON.stringify(index)) === p.index,
                        'Staged index verification failed.',
                    );
                    await mapConcurrent(index.items, async i => readManifest(await nextDav.get('trees/' + i.ref + '.bin'), key, i.ref));
                }
            }
            const oldFiles = await cleanupTargets(rootDav, generation);
            if (dav.base !== rootDav.base) {
                const oldPrefix = dav.base.slice(rootDav.base.length);
                if (!oldFiles.includes(oldPrefix)) oldFiles.push(oldPrefix);
            }
            assertHeld();
            assert(
                (await rootDav.get('vault.json'))?.equals(vaultBytes),
                'Cloud settings changed during cleanup.',
            );
            const nextBytes = Buffer.from(JSON.stringify(nextVault));
            atomic(
                journal,
                JSON.stringify({
                    schema: 1,
                    oldBase: rootDav.base,
                    previousVaultHash: hash(vaultBytes),
                    newGeneration: generation,
                    oldFiles,
                    state,
                    committed: false,
                }),
            );
            await rootDav.put('vault.json', nextBytes);
            committed = true;
            atomic(
                journal,
                JSON.stringify({
                    schema: 1,
                    oldBase: rootDav.base,
                    previousVaultHash: hash(vaultBytes),
                    newGeneration: generation,
                    oldFiles,
                    state,
                    committed: true,
                }),
            );
            applyTrashState(cloud.store, state);
            cloud.connection = { ...connection, dav: nextDav, vaultBytes: nextBytes, protocol: 3 };
            cloud.save({
                heads: {},
                indexes: {},
                loaded: {},
                ack: {},
                ownProjects: [],
                legacyGraphs: {},
                generation,
            });
            await cloud.catalog(passphrase);
            for (const p of cloud.summaries()) await cloud.project(p.id, passphrase);
            cloud.saveDirectory();
            // Hydrate live snapshots before discarding old local bodies.
            for (const i of cloud.items())
                if (cloud.store.getStatement.get('branch', i.id))
                    await cloud.hydrate(i.id, passphrase);
            cleanupLocal(cloud.store);
            let done = 0;
            for (const file of oldFiles) {
                assertHeld();
                const r = await rootDav.request('DELETE', file);
                const response = await rootDav.readResponse(r, 1048576);
                assert(
                    davSucceeded(r, response) || r.status === 404,
                    'Some old cloud files still need cleanup.',
                );
                cloud.report('Reclaiming cloud space', ++done, oldFiles.length);
            }
            state.cleanupComplete = true;
            await nextDav.put('trash-state.bin', await sealAsync(state, key));
            applyTrashState(cloud.store, state);
            fs.rmSync(journal, { force: true });
            cloud.store.local(
                'trashEntries',
                (cloud.store.local('trashEntries') || []).map((e) => state.events.some(event => event.id === (e.rescueFor || e.id)) ? { ...e, state: 'cleaned' } : e),
            );
            completedCleanup = true;
            return { ...publication, removed: deleted.size, cleaned: true, rebuilt: true };
        } catch (e) {
            if (!committed) {
                try {
                    const current = await rootDav.get('vault.json');
                    if (current?.equals(vaultBytes)) {
                        const r = await rootDav.request(
                            'DELETE',
                            'generations/' + generation + '/',
                        );
                        await rootDav.readResponse(r, 1048576);
                        fs.rmSync(journal, { force: true });
                    }
                } catch {}
            }
            throw e;
        } finally {
            stage.close();
            verified.close();
            if (completedCleanup) fs.rmSync(cachePath, { recursive: true, force: true });
            fs.rmSync(temp, { recursive: true, force: true });
            try {
                if ((await rootDav.get('migration.json'))?.equals(lease)) {
                    const r = await rootDav.request('DELETE', 'migration.json');
                    await rootDav.readResponse(r, 1048576);
                }
            } catch {}
        }
    });
}
export async function resumeTrashCleanup(cloud, passphrase) {
    const file = path.join(cloud.store.root, 'trash-cleanup.json');
    if (!fs.existsSync(file)) return null;
    const j = JSON.parse(fs.readFileSync(file, 'utf8')),
        conn = await cloud.connect(passphrase);
    return withVaultLock(conn.rootDav, async (assertHeld) => {
        const bytes = await conn.rootDav.get('vault.json'),
            vault = JSON.parse(bytes.toString());
        if (hash(bytes) === j.previousVaultHash) {
            const r = await conn.rootDav.request('DELETE', 'generations/' + j.newGeneration + '/');
            await conn.rootDav.readResponse(r, 1048576);
            assert(r.ok || r.status === 404, 'Could not remove interrupted staging data.');
            fs.rmSync(file, { force: true });
            return null;
        }
        if (vault.generation !== j.newGeneration) {
            assert(vault.schema === 3, 'Cleanup journal belongs to another generation.');
            const currentDav = conn.rootDav.scoped('generations/' + vault.generation + '/'),
                currentState = unseal(await currentDav.get('trash-state.bin'), conn.key);
            assert(
                j.state.events.every((e) => currentState.events.some((v) => v.id === e.id)),
                'A newer generation does not contain these deletion markers.',
            );
            j.oldFiles = [
                ...new Set([
                    ...j.oldFiles,
                    ...(await cleanupTargets(conn.rootDav, vault.generation)),
                    'generations/' + j.newGeneration + '/',
                ]),
            ];
            j.state = currentState;
            j.newGeneration = vault.generation;
            cloud.connection = { ...conn, dav: currentDav, vaultBytes: bytes, protocol: 3 };
            cloud.save({
                heads: {},
                indexes: {},
                loaded: {},
                ack: {},
                ownProjects: [],
                legacyGraphs: {},
                generation: vault.generation,
            });
        }
        assert(j.oldBase === conn.rootDav.base, 'Invalid old cleanup namespace.');
        const old = Object.create(conn.rootDav);
        old.base = j.oldBase;
        let count = 0;
        for (const name of j.oldFiles) {
            assert(
                /^(?:(?:objects|trees|projects|heads|commits)\/|generations\/[a-f0-9]{32}\/|trash-state\.bin)$/.test(
                    name,
                ),
                'Invalid cleanup file.',
            );
            assert(
                !name.startsWith('generations/' + vault.generation + '/'),
                'Refusing to clean the current generation.',
            );
            assertHeld();
            const r = await old.request('DELETE', name);
            const response = await old.readResponse(r, 1048576);
            assert(davSucceeded(r, response) || r.status === 404, 'Cloud cleanup is incomplete.');
            cloud.report('Reclaiming cloud space', ++count, j.oldFiles.length);
        }
        j.state.cleanupComplete = true;
        await cloud.connection.dav.put('trash-state.bin', await sealAsync(j.state, conn.key));
        applyTrashState(cloud.store, j.state);
        cleanupLocal(cloud.store);
        fs.rmSync(file, { force: true });
        fs.rmSync(transferCachePath(cloud), { recursive: true, force: true });
        cloud.store.local(
            'trashEntries',
            (cloud.store.local('trashEntries') || []).map((e) => j.state.events.some(event => event.id === (e.rescueFor || e.id)) ? { ...e, state: 'cleaned' } : e),
        );
        return { cleaned: true };
    });
}
