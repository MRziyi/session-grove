import { assert, hash } from './util.js';

// Keep immutable revision identities for offline ancestry checks, but explicitly
// declare which record bodies are still reachable. Deleted suffix hashes are
// metadata, never an excuse to retain their bodies.
export function requiredRanges(graph) {
    const revisions = new Map(graph.revisions.map((r) => [r.id, r])),
        ranges = new Map();
    const require = (id, end) => {
        if (!id) return;
        const r = revisions.get(id);
        assert(r, 'Missing retained revision.');
        const n = end ?? r.refs.length;
        assert(Number.isInteger(n) && n >= 0 && n <= r.refs.length, 'Invalid retained prefix.');
        ranges.set(id, Math.max(ranges.get(id) || 0, n));
    };
    for (const b of graph.branches) {
        require(b.head);
        if (!b.synthetic) {
            let r = revisions.get(b.head),
                seen = new Set();
            while (r?.parent && r.parent !== b.forkRevision) {
                assert(!seen.has(r.id), 'Revision cycle.');
                seen.add(r.id);
                r = revisions.get(r.parent);
                assert(r, 'Missing revision ancestor.');
                require(r.id);
            }
        }
        require(b.forkRevision, b.forkParentEnd ?? b.forkEnd);
    }
    for (const n of graph.nodes || []) require(n.revisionId, n.end);
    return ranges;
}
export function bodyRefs(graph) {
    if (!graph.retention) return [...new Set(graph.revisions.flatMap((r) => r.refs))];
    const needed = requiredRanges(graph),
        declared = new Map(Object.entries(graph.retention.ranges || {})),
        revisions = new Map(graph.revisions.map((r) => [r.id, r]));
    assert(graph.retention.schema === 1, 'Unsupported retention manifest.');
    for (const [id, n] of needed)
        assert((declared.get(id) ?? -1) >= n, 'Retention manifest omits live context.');
    const refs = new Set();
    for (const [id, values] of Object.entries(graph.retention.extras || {})) {
        const r = revisions.get(id),
            available = new Set(r?.refs || []);
        assert(
            r && Array.isArray(values) && values.every((h) => available.has(h)),
            'Invalid retained metadata.',
        );
        for (const h of values) refs.add(h);
    }
    for (const [id, end] of declared) {
        const r = revisions.get(id);
        assert(
            r && Number.isInteger(end) && end >= 0 && end <= r.refs.length,
            'Invalid retention range.',
        );
        for (const h of r.refs.slice(0, end)) refs.add(h);
    }
    return [...refs];
}
export function retainedGraph(graph, deleted) {
    const rows = new Map(graph.branches.map((b) => [b.id, b])),
        needed = new Set(
            graph.branches.filter((b) => !deleted.has(b.id) && !b.trashed).map((b) => b.id),
        );
    for (const id of [...needed]) {
        let b = rows.get(id),
            seen = new Set();
        while (b?.parentId) {
            assert(!seen.has(b.id), 'Branch cycle.');
            seen.add(b.id);
            needed.add(b.parentId);
            b = rows.get(b.parentId);
            assert(b, 'Missing branch ancestor.');
        }
    }
    const revisions = new Map(graph.revisions.map((r) => [r.id, r])),
        branches = graph.branches.filter((b) => needed.has(b.id)).map((b) => ({ ...b }));
    for (const b of branches)
        if (deleted.has(b.id) || b.trashed) {
            const children = branches
                .filter((c) => c.parentId === b.id && c.forkRevision)
                .sort((a, c) => (c.forkParentEnd ?? c.forkEnd) - (a.forkParentEnd ?? a.forkEnd));
            const child = children[0];
            assert(child, 'Trashed dependency has no retained child.');
            const source = revisions.get(child.forkRevision),
                end = child.forkParentEnd ?? child.forkEnd;
            assert(source && end <= source.refs.length, 'Missing shared prefix.');
            const id = 'prefix-' + hash(source.id + ':' + end),
                r = {
                    ...source,
                    id,
                    parent: null,
                    refs: source.refs.slice(0, end),
                    source: { ...source.source, operation: 'shared-prefix' },
                };
            revisions.set(id, r);
            Object.assign(b, {
                head: id,
                name: 'Shared context',
                synthetic: true,
                trashed: true,
                trashDependency: true,
                nodeHead: null,
            });
        }
    const ids = new Set(branches.map((b) => b.id)),
        live = new Set(branches.filter((b) => !b.trashed).map((b) => b.id));
    const nodes = (graph.nodes || []).filter((n) => live.has(n.branchId)),
        layouts = (graph.layouts || []).filter((l) => ids.has(l.rootId));
    const used = new Map();
    const visit = (id) => {
        if (!id || used.has(id)) return;
        const r = revisions.get(id);
        assert(r, 'Missing retained revision.');
        used.set(id, r);
        visit(r.parent);
    };
    for (const b of branches) {
        visit(b.head);
        visit(b.forkRevision);
    }
    for (const n of nodes) visit(n.revisionId);
    const result = {
        ...graph,
        branches,
        nodes,
        layouts,
        revisions: [...used.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
    const projectIds = new Set(branches.map((b) => b.projectId));
    result.projects = graph.projects.filter((p) => projectIds.has(p.id));
    result.retention = {
        schema: 1,
        extras: Object.fromEntries(
            Object.entries(graph.retention?.extras || {}).filter(([id]) => used.has(id)),
        ),
        ranges: Object.fromEntries(
            [...requiredRanges(result)].sort(([a], [b]) => a.localeCompare(b)),
        ),
    };
    return result;
}

// Claude's native fork also inherits selected metadata appearing after the
// checkpoint. Preserve exactly the referenced metadata classes/UUID records;
// do not retain the discarded conversation suffix to obtain those fields.
export function withForkMetadata(graph, readObject, forkClaude, deleted = new Set()) {
    const revisions = new Map(graph.revisions.map((r) => [r.id, r])),
        extras = {};
    for (const b of graph.branches) {
        if (b.trashed || deleted.has(b.id) || b.agent !== 'claude') continue;
        const head = revisions.get(b.head);
        if (head?.source?.operation !== 'fork' || !head.source.claudeCheckpoint || !head.parent)
            continue;
        const source = revisions.get(head.parent);
        if (!source) continue;
        const rows = source.refs.map((h) => {
            const body = readObject(h);
            if (!body) return null;
            try {
                return JSON.parse(body);
            } catch {
                return null;
            }
        });
        const raw = source.refs.map((h) => readObject(h) || '\n').join(''),
            forked = forkClaude(raw, b.name, head.source.claudeCheckpoint);
        const uuids = new Set(forked.map((r) => r.forkedFrom?.messageUuid).filter(Boolean)),
            types = new Set(
                forked
                    .filter(
                        (r) =>
                            !r.forkedFrom &&
                            !['user', 'assistant', 'custom-title'].includes(r.type),
                    )
                    .map((r) => r.type),
            );
        extras[source.id] = [
            ...new Set([
                ...(extras[source.id] || []),
                ...source.refs.filter(
                    (h, i) => rows[i] && (uuids.has(rows[i].uuid) || types.has(rows[i].type)),
                ),
            ]),
        ];
    }
    return { ...graph, retention: { ...(graph.retention || {}), extras } };
}
