import { claudeFork } from './claude.js';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { assert, atomic, id, now, hash } from './util.js';
import { retainedGraph, bodyRefs, withForkMetadata } from './retention.js';
import { preferences } from './preferences.js';
export const trashState = (store) => store.local('trashState') || { schema: 1, events: [] };
export function deletedIds(store, graph = { branches: store.all('branch') }) {
    const events = [...trashState(store).events, ...(store.local('trashPending') || [])],
        ids = new Set(events.flatMap((e) => [...e.branchIds, ...(e.treeIds || [])])),
        trees = new Set(events.flatMap((e) => e.treeIds || [])),
        rows = new Map(graph.branches.map((b) => [b.id, b]));
    for (const b of rows.values()) {
        let r = b,
            seen = new Set();
        while (r?.parentId && !seen.has(r.id)) {
            seen.add(r.id);
            r = rows.get(r.parentId);
        }
        if (trees.has(r?.id)) ids.add(b.id);
    }
    return ids;
}
export function isTrashed(store, branchId) {
    return store.memo('trash-ids', () => deletedIds(store)).has(branchId);
}
export function nativeSuppressed(store, agent, nativeId) {
    if (!nativeId) return false;
    const kept = store.memo(
        'trash-kept-native-identities',
        () =>
            new Set(
                store
                    .instances()
                    .filter((i) => !isTrashed(store, i.branchId))
                    .map((i) => i.agent + ':' + i.nativeId),
            ),
    );
    if (kept.has(agent + ':' + nativeId)) return false;
    const keys = store.memo(
        'trash-native-identities',
        () =>
            new Set(
                [...trashState(store).events, ...(store.local('trashPending') || [])]
                    .flatMap((e) => (e.nativeIds || []).map((n) => n.agent + ':' + n.id))
                    .concat(
                        store
                            .instances()
                            .filter((i) => isTrashed(store, i.branchId))
                            .map((i) => i.agent + ':' + i.nativeId),
                    ),
            ),
    );
    return keys.has(agent + ':' + nativeId);
}
export function stageTrash(store, branchIds, treeIds = [], { rescueFor = null } = {}) {
    assert(branchIds.length, 'Select sessions to discard.');
    const selected = new Set(branchIds),
        branches = branchIds.map((id) => store.get('branch', id));
    assert(
        branches.every((b) => !isTrashed(store, b.id)),
        'Session is already in Trash.',
    );
    const event = {
        id: id(),
        deviceId: store.device.id,
        at: now(),
        branchIds: [...selected],
        treeIds: [...new Set(treeIds)],
        heads: Object.fromEntries(branches.map((b) => [b.id, b.head])),
        nativeIds: [],
    };
    for (const b of branches) {
        for (const i of store.instances().filter((i) => i.branchId === b.id))
            event.nativeIds.push({ agent: i.agent, id: i.nativeId });
        let r = store.get('revision', b.head),
            seen = new Set();
        while (r && !seen.has(r.id) && r.id !== b.forkRevision) {
            seen.add(r.id);
            if (
                ['import', 'capture', 'native-settings'].includes(r.source?.operation) &&
                r.source.nativeId
            )
                event.nativeIds.push({ agent: b.agent, id: r.source.nativeId });
            r = r.parent ? store.get('revision', r.parent) : null;
        }
    }
    event.nativeIds = [...new Map(event.nativeIds.map((n) => [n.agent + ':' + n.id, n])).values()];
    let graph = {
        schema: 3,
        projects: store.all('project'),
        branches: store.all('branch'),
        nodes: store.all('node'),
        layouts: store.all('layout'),
        revisions: [],
    };
    // Back up only selected trees and their frozen dependencies, not the library.
    const wanted = new Set(branchIds);
    for (const b of branches) {
        let c = b;
        while (c.parentId) {
            wanted.add(c.parentId);
            c = store.get('branch', c.parentId);
        }
    }
    graph.branches = graph.branches.filter((b) => wanted.has(b.id));
    graph.nodes = graph.nodes.filter((n) => wanted.has(n.branchId));
    graph.layouts = graph.layouts.filter((l) => wanted.has(l.rootId));
    const used = new Map();
    const visit = (id) => {
        if (!id || used.has(id)) return;
        const r = store.get('revision', id);
        used.set(id, r);
        visit(r.parent);
    };
    for (const b of graph.branches) {
        visit(b.head);
        visit(b.forkRevision);
    }
    for (const n of graph.nodes) visit(n.revisionId);
    graph.revisions = [...used.values()];
    const dependencies = new Set(
        graph.branches.filter((b) => !selected.has(b.id)).map((b) => b.id),
    );
    graph = retainedGraph(
        withForkMetadata(
            graph,
            (h) => store.objectStatement.get(h)?.body,
            claudeFork,
            dependencies,
        ),
        dependencies,
    );
    const objects = {};
    for (const h of bodyRefs(graph)) {
        const row = store.objectStatement.get(h);
        if (row) objects[h] = row.body;
    }
    const roots = new Map(),
        mainLayouts = [];
    for (const b of branches) {
        let root = b;
        while (root.parentId) root = store.get('branch', root.parentId);
        roots.set(root.id, root);
    }
    for (const root of roots.values()) {
        const view = store.treeGraph(root.id),
            chatIds = new Set(
                view.paths
                    .filter((p) => selected.has(p.branchId))
                    .flatMap((p) => p.messages.map((m) => m.id)),
            ),
            keptChats = new Set(
                view.paths
                    .filter((p) => !selected.has(p.branchId))
                    .flatMap((p) => p.messages.map((m) => m.id)),
            );
        if (keptChats.size)
            mainLayouts.push({
                id: id(),
                rootId: root.id,
                parent: root.layoutHead || null,
                createdAt: now(),
                assignments: Object.fromEntries(
                    Object.entries(view.assignments).filter(([key]) => keptChats.has(key)),
                ),
            });
        const layout = {
            id: 'recovery-' + id(),
            rootId: root.id,
            parent: null,
            createdAt: now(),
            assignments: Object.fromEntries(
                Object.entries(view.assignments).filter(([key]) => chatIds.has(key)),
            ),
        };
        graph.layouts.push(layout);
        graph.branches = graph.branches.map((b) =>
            b.id === root.id ? { ...b, layoutHead: layout.id } : b,
        );
    }
    const expiresAt = new Date(
            Date.now() + preferences(store).trashRetentionDays * 86400000,
        ).toISOString(),
        entry = {
            ...event,
            names: branches.filter((b) => !b.synthetic).map((b) => b.name),
            expiresAt,
            state: rescueFor ? 'removed' : 'pending',
            ...(rescueFor ? { rescueFor } : {}),
        };
    atomic(
        path.join(store.root, 'trash', event.id + '.json.gz'),
        gzipSync(JSON.stringify({ entry, graph, objects }), { level: 6 }),
    );
    store.transaction(() => {
        if (!rescueFor)
            for (const layout of mainLayouts) {
                store.put('layout', layout);
                const root = store.get('branch', layout.rootId);
                store.put('branch', { ...root, layoutHead: layout.id });
            }
        store.local('trashEntries', [...(store.local('trashEntries') || []), entry]);
        if (!rescueFor)
            store.local('trashPending', [...(store.local('trashPending') || []), event]);
        store.invalidate();
    });
    return entry;
}
export function applyTrashState(store, state) {
    assert(state?.schema === 1 && Array.isArray(state.events), 'Invalid Trash state.');
    for (const e of state.events)
        assert(
            typeof e.id === 'string' &&
                Array.isArray(e.branchIds) &&
                e.branchIds.every((i) => typeof i === 'string') &&
                Array.isArray(e.treeIds || []),
            'Invalid deletion marker.',
        );
    if (
        !!trashState(store).cleanupComplete === !!state.cleanupComplete &&
        JSON.stringify(trashState(store).events) === JSON.stringify(state.events) &&
        !(store.local('trashPending') || []).length
    )
        return;
    const previous = new Set(trashState(store).events.map((e) => e.id)),
        dirtyRoots = store.local('trashDirtyRoots'),
        rescued = new Set();
    for (const e of state.events) {
        if (previous.has(e.id) || e.deviceId === store.device.id) continue;
        const rows = new Map(store.all('branch').map((b) => [b.id, b]));
        const divergent = [...rows.values()].filter((b) => {
            if (b.synthetic || rescued.has(b.id) || isTrashed(store, b.id)) return false;
            let root = b,
                seen = new Set();
            while (root?.parentId && !seen.has(root.id)) {
                seen.add(root.id);
                root = rows.get(root.parentId);
            }
            return (
                (!Array.isArray(dirtyRoots) || dirtyRoots.includes(root?.id)) &&
                (e.branchIds.includes(b.id) || (e.treeIds || []).includes(root?.id)) &&
                !state.events.some((event) => event.heads?.[b.id] === b.head)
            );
        });
        if (divergent.length) {
            stageTrash(
                store,
                divergent.map((b) => b.id),
                [],
                { rescueFor: e.id },
            );
            for (const b of divergent) rescued.add(b.id);
        }
    }
    const events = new Map([...trashState(store).events, ...state.events].map((e) => [e.id, e]));
    store.local('trashState', {
        schema: 1,
        events: [...events.values()],
        cleanupComplete: !!state.cleanupComplete,
    });
    const pending = (store.local('trashPending') || []).filter((e) => !events.has(e.id));
    store.local('trashPending', pending);
    store.local(
        'trashEntries',
        (store.local('trashEntries') || []).map((e) =>
            events.has(e.rescueFor || e.id) && e.state !== 'cleaned'
                ? { ...e, state: state.cleanupComplete ? 'cleaned' : 'removed' }
                : e,
        ),
    );
    store.invalidate();
}
function pruneCompletedJournals(store) {
    const directory = path.join(store.root, 'operations');
    if (!fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory).filter((n) => /^[a-f0-9-]+\.json$/.test(n))) {
        const file = path.join(directory, name);
        const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (journal.status !== 'complete' || journal.backupsPruned) continue;
        const files = (journal.files || []).map(({ path, afterHash }) => ({ path, afterHash }));
        const { instancesBefore, ...metadata } = journal;
        atomic(file, JSON.stringify({ ...metadata, files, backupsPruned: true }));
    }
}
export function cleanupLocal(store) {
    const removed = deletedIds(store);
    if (!removed.size) return { records: 0 };
    const graph = {
        schema: 3,
        projects: store.all('project'),
        branches: store.all('branch'),
        nodes: store.all('node'),
        layouts: store.all('layout'),
        revisions: store.all('revision'),
    };
    const kept = retainedGraph(
            withForkMetadata(graph, (h) => store.objectStatement.get(h)?.body, claudeFork, removed),
            removed,
        ),
        refs = new Set(bodyRefs(kept));
    store.transaction(() => {
        for (const r of kept.revisions)
            if (!store.getStatement.get('revision', r.id)) store.put('revision', r);
        for (const b of kept.branches) if (b.trashDependency) store.put('branch', b);
        const dependencies = new Set(kept.branches.map((b) => b.id));
        for (const id of removed)
            if (!dependencies.has(id) && store.getStatement.get('branch', id)) {
                const b = store.get('branch', id);
                store.put('branch', { ...b, trashed: true, nodeHead: null, layoutHead: null });
            }
        const result = store.db
            .prepare('DELETE FROM objects WHERE hash NOT IN (SELECT value FROM json_each(?))')
            .run(JSON.stringify([...refs]));
        store.invalidate();
        store.parseCache.clear();
        store.parseBytes = 0;
        store.recordCache.clear();
        store.recordBytes = 0;
        store.summaryCache.clear();
        store.db.exec('DELETE FROM summaries');
        store.local(
            'instances',
            store.instances().map((i) => (removed.has(i.branchId) ? { ...i, baseline: null } : i)),
        );
        const retainedRevisions = kept.revisions.map((r) => r.id),
            retainedNodes = kept.nodes.map((n) => n.id),
            retainedLayouts = kept.layouts.map((l) => l.id);
        for (const [kind, ids] of [
            ['revision', retainedRevisions],
            ['node', retainedNodes],
            ['layout', retainedLayouts],
        ])
            store.db
                .prepare(
                    'DELETE FROM entities WHERE kind=? AND id NOT IN (SELECT value FROM json_each(?))',
                )
                .run(kind, JSON.stringify(ids));
        store.local('lastTrashCleanup', { at: now(), records: result.changes });
    });
    pruneCompletedJournals(store);
    if (store.local('lastTrashCleanup').records)
        store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM');
    return store.local('lastTrashCleanup');
}
export function expireTrash(store, at = Date.now()) {
    let changed = false;
    const entries = (store.local('trashEntries') || []).map((e) => {
        if (!e.expired && Date.parse(e.expiresAt) <= at) {
            fs.rmSync(path.join(store.root, 'trash', e.id + '.json.gz'), { force: true });
            changed = true;
            return { ...e, expired: true };
        }
        return e;
    });
    if (changed) {
        store.local('trashEntries', entries);
        cleanupLocal(store);
    }
    return entries;
}
export function restoreTrash(store, entryId) {
    const entry = expireTrash(store).find((e) => e.id === entryId);
    assert(entry && !entry.expired && !entry.restoredAt, 'The local recovery copy has expired.');
    const file = path.join(store.root, 'trash', entry.id + '.json.gz'),
        backup = JSON.parse(
            gunzipSync(fs.readFileSync(file), { maxOutputLength: 512 * 1024 * 1024 }).toString(),
        );
    const dependencies = new Set(
        backup.graph.branches.filter((b) => !entry.branchIds.includes(b.id)).map((b) => b.id),
    );
    backup.graph = retainedGraph(
        withForkMetadata(backup.graph, (h) => backup.objects[h], claudeFork, dependencies),
        dependencies,
    );
    const wanted = new Set(bodyRefs(backup.graph));
    const mapping = new Map(backup.graph.branches.map((b) => [b.id, id()])),
        selected = new Set(entry.branchIds),
        created = [];
    store.transaction(() => {
        for (const [h, body] of Object.entries(backup.objects)) {
            if (!wanted.has(h)) continue;
            assert(hash(body) === h, 'Recovery copy integrity failed.');
            store.insertObject.run(h, body);
        }
        for (const r of backup.graph.revisions)
            if (!store.getStatement.get('revision', r.id)) store.put('revision', r);
        for (const p of backup.graph.projects)
            if (!store.getStatement.get('project', p.id)) store.put('project', p);
        for (const b of backup.graph.branches) {
            const restored = {
                ...b,
                id: mapping.get(b.id),
                chatIdentity: b.chatIdentity || b.id,
                parentId: mapping.get(b.parentId) || null,
                trashed: false,
                trashDependency: false,
                synthetic: !selected.has(b.id) || b.synthetic,
                projectId:
                    b.projectId && store.get('project', b.projectId).archived ? null : b.projectId,
                archived: false,
                nodeHead: null,
                layoutHead: null,
                metaVersion: id(),
                metaAncestors: [],
                createdAt: now(),
                updatedAt: now(),
            };
            store.put('branch', restored);
            if (selected.has(b.id) && !restored.synthetic) created.push(restored.id);
        }
        for (const l of backup.graph.layouts) {
            if (!backup.graph.branches.some((b) => b.layoutHead === l.id)) continue;
            const rootId = mapping.get(l.rootId),
                layout = { ...l, id: id(), rootId, parent: null, mergeParents: [] };
            store.put('layout', layout);
            const root = store.get('branch', rootId);
            store.put('branch', { ...root, layoutHead: layout.id });
        }
        store.local(
            'trashEntries',
            (store.local('trashEntries') || []).map((e) =>
                e.id === entryId ? { ...e, restoredAt: now() } : e,
            ),
        );
    });
    cleanupLocal(store);
    return {
        branchIds: created,
        projectIds: [
            ...new Set(
                created.map(
                    (id) =>
                        store.get('branch', id).projectId || '00000000-0000-4000-8000-000000000001',
                ),
            ),
        ],
        background: created.some((id) => store.get('branch', id).background),
    };
}
