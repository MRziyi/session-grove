import { id, now, hash, assert, text } from './util.js';
import { parse } from './transcript.js';
export function metadata(value, patch) {
    const previous = value.metaVersion || hash(JSON.stringify([value.name, value.description, value.projectId, value.group, value.archived]));
    return { ...value, ...patch, updatedAt: now(), metaVersion: id(), metaAncestors: [...new Set([...(value.metaAncestors || []), previous])] };
}
export function initializeOrganization(store) {
    for (const kind of ['project', 'branch'])
        for (const value of store.all(kind)) {
            if (!value.metaVersion) {
                value.metaVersion = hash(JSON.stringify([value.name, value.description, value.projectId, value.group, value.archived]));
                value.metaAncestors = [];
            }
            if (kind === 'branch' && !value.logicalVersion) {
                const parsed = parse(store.raw(value.head), value.agent);
                const end = parsed.checkpoints.at(-1)?.end || value.forkEnd || 0;
                if (end > (value.forkEnd || 0))
                    store.put('node', {
                        id: `legacy-${value.id}`, branchId: value.id, revisionId: value.head,
                        name: value.name, start: value.forkEnd || 0, end, createdAt: value.createdAt
                    });
                value.logicalVersion = 1;
            }
            if (kind === 'branch' && value.nodeHead === undefined) {
                let previousId = null;
                for (const node of store.all('node').filter(n => n.branchId === value.id).sort((a, b) => a.end - b.end)) {
                    store.put('node', { ...node, previousId });
                    previousId = node.id;
                }
                value.nodeHead = previousId;
            }
            store.put(kind, value);
        }
}
export function pendingDetail(store, branch, parsed) {
    const nodes = [];
    let cursor = branch.nodeHead;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const node = store.get('node', cursor);
        assert(node.branchId === branch.id, 'Logical node belongs to another session.');
        if (store.ancestor(node.revisionId, branch.head))
            nodes.unshift(node);
        cursor = node.previousId;
    }
    const start = nodes.at(-1)?.end ?? branch.forkEnd ?? 0;
    const messages = parsed.messages.filter(m => m.line > start);
    const checkpoints = parsed.checkpoints.filter(c => c.end > start).map(c => ({ ...c, messages: messages.filter(m => m.line <= c.end && m.role !== 'tool').length }));
    return { nodes, pending: { id: `pending-${branch.id}`, revisionId: branch.head, start, end: parsed.records.length, messages, count: messages.filter(m => m.role !== 'tool').length, checkpoints } };
}
export function commitPending(store, branchId, { name, end, revisionId, expectedStart }) {
    return store.transaction(() => {
        const branch = store.get('branch', branchId);
        assert(revisionId === branch.head, 'Pending changed. Refresh before committing.', 409);
        const parsed = parse(store.raw(branch.head), branch.agent), { pending } = pendingDetail(store, branch, parsed);
        assert(Number(expectedStart) === pending.start, 'This range was already organized. Refresh before committing.', 409);
        assert(pending.checkpoints.some(c => c.end === Number(end)), 'Choose a complete turn boundary.');
        const node = { id: id(), branchId, revisionId: branch.head, name: text(name, 'Node name'), start: pending.start, end: Number(end), previousId: branch.nodeHead || null, createdAt: now() };
        store.put('node', node);
        store.put('branch', { ...branch, nodeHead: node.id, updatedAt: now() });
        return node;
    });
}
export function rootOf(store, branchId) {
    let b = store.get('branch', branchId);
    const seen = new Set();
    while (b.parentId && !seen.has(b.id)) {
        seen.add(b.id);
        b = store.get('branch', b.parentId);
    }
    return b;
}
export function treeMembers(store, branchId) {
    const root = rootOf(store, branchId);
    return store.all('branch').filter(b => rootOf(store, b.id).id === root.id);
}
export function moveTree(store, branchId, projectId, group = '') {
    assert(projectId, 'Choose a destination project.');
    store.get('project', projectId);
    return store.transaction(() => {
        const members = treeMembers(store, branchId);
        for (const b of members)
            store.put('branch', metadata(b, { projectId: projectId || null, group: String(group).slice(0, 100) }));
        return { moved: members.length, rootId: rootOf(store, branchId).id, projectId: projectId || null };
    });
}
export function forest(store, scope) {
    const all = store.all('branch'), instances = store.instances(), roots = new Map();
    const eligible = scope === 'local'
        ? all.filter(b => !b.projectId || instances.some(i => i.branchId === b.id && (i.desired || i.applied)))
        : all.filter(b => b.projectId === scope);
    for (const b of eligible) {
        const root = rootOf(store, b.id);
        roots.set(root.id, root);
    }
    return [...roots.values()].map(root => {
        const members = all.filter(b => rootOf(store, b.id).id === root.id);
        const active = members.filter(b => instances.some(i => i.branchId === b.id && (i.desired || i.applied)));
        return { id: root.id, name: root.name, group: root.group || '', projectId: root.projectId, kind: members.length > 1 ? 'tree' : 'session', branchIds: members.map(b => b.id), activeCount: active.length, archived: members.every(b => b.archived), updatedAt: members.map(b => b.updatedAt).sort().at(-1) };
    });
}
// Compare complete semantic event sequences, never a bag of matching messages.
// Volatile native identifiers are excluded, tool arguments/results remain included.
function signatures(raw, agent) {
    const p = parse(raw, agent), units = [];
    for (let i = 0; i < p.records.length; i++) {
        const v = p.records[i].value;
        if (agent === 'codex' && v?.type === 'response_item') {
            const payload = structuredClone(v.payload);
            delete payload.id;
            units.push({ line: i + 1, key: hash(JSON.stringify(payload)) });
        }
        else if (agent === 'claude' && ['user', 'assistant'].includes(v?.type) && v.message) {
            units.push({ line: i + 1, key: hash(JSON.stringify({ role: v.message.role, content: v.message.content })) });
        }
    }
    return { p, boundaries: p.checkpoints.map(c => ({ end: c.end, count: p.messages.filter(m => m.line <= c.end && m.role !== 'tool').length, key: hash(units.filter(u => u.line <= c.end).map(u => u.key).join(':')) })) };
}
export function detectFamilies(store) {
    let grouped = 0;
    // Only automatically organize the unfiled inbox; user project structure is authoritative.
    let roots = store.all('branch').filter(b => !b.projectId && !b.parentId && !b.archived && !b.excluded);
    const signaturesById = new Map();
    const get = b => { if (!signaturesById.has(b.id))
        signaturesById.set(b.id, signatures(store.raw(b.head), b.agent)); return signaturesById.get(b.id); };
    // Native forks can arrive after their parent was filed or organized. Keep
    // the existing family root and its annotations when adopting such a fork.
    for (const fresh of [...roots]) {
        if (fresh.synthetic || fresh.layoutHead || fresh.nodeHead) continue;
        const x = get(fresh);
        const candidates = store.all('branch').filter(b => b.id !== fresh.id && b.agent === fresh.agent && !b.archived && !b.excluded && (b.projectId || b.parentId || b.synthetic || b.layoutHead || b.nodeHead));
        let best = null;
        for (const candidate of candidates) {
            if (rootOf(store, candidate.id).id === fresh.id) continue;
            const y = get(candidate);
            if (!x.p.cwd || x.p.cwd !== y.p.cwd) continue;
            const linked = x.p.meta?.forked_from_id === y.p.nativeId || x.p.meta?.forkedFromId === y.p.nativeId;
            const common = x.boundaries.filter(c => c.count >= (linked ? 2 : 4)).map(c => ({ a: c, b: y.boundaries.find(d => d.key === c.key && d.count === c.count) })).filter(c => c.b).at(-1);
            if (common && (!best || common.a.count > best.common.a.count)) best = { candidate, common };
        }
        if (best) {
            const { candidate, common } = best;
            store.put('branch', metadata(fresh, { parentId: candidate.id, projectId: candidate.projectId, forkRevision: candidate.head, forkEnd: common.a.end, forkParentEnd: common.b.end, inferred: true }));
            grouped++;
        }
    }
    for (let a = 0; a < roots.length; a++)
        for (let j = a + 1; j < roots.length; j++) {
            const left = store.get('branch', roots[a].id), right = store.get('branch', roots[j].id);
            if (left.parentId || right.parentId || left.agent !== right.agent)
                continue;
            // Existing named logical nodes are never silently reorganized by inference.
            if ([left, right].some(b => !b.synthetic && store.all('node').some(n => n.branchId === b.id)))
                continue;
            const x = get(left), y = get(right);
            if (!x.p.cwd || x.p.cwd !== y.p.cwd)
                continue;
            const nativeLink = x.p.meta?.forked_from_id === y.p.nativeId || y.p.meta?.forked_from_id === x.p.nativeId || x.p.meta?.forkedFromId === y.p.nativeId || y.p.meta?.forkedFromId === x.p.nativeId;
            const common = x.boundaries.filter(c => c.count >= (nativeLink ? 2 : 4)).map(c => ({ a: c, b: y.boundaries.find(d => d.key === c.key && d.count === c.count) })).filter(c => c.b).at(-1);
            if (!common)
                continue;
            if (nativeLink) {
                const leftIsChild = [x.p.meta?.forked_from_id, x.p.meta?.forkedFromId].includes(y.p.nativeId);
                const child = leftIsChild ? left : right, parent = leftIsChild ? right : left;
                store.put('branch', metadata(child, { parentId: parent.id, forkRevision: parent.head,
                    forkEnd: leftIsChild ? common.a.end : common.b.end,
                    forkParentEnd: leftIsChild ? common.b.end : common.a.end, inferred: true }));
                grouped++; continue;
            }
            // A shared root may accept another child without creating an extra hierarchy level.
            const existingRoot = left.synthetic && common.a.end === store.get('revision', left.head).refs.length ? left : right.synthetic && common.b.end === store.get('revision', right.head).refs.length ? right : null;
            if (existingRoot) {
                const child = existingRoot.id === left.id ? right : left;
                store.put('branch', metadata(child, { parentId: existingRoot.id, forkRevision: existingRoot.head, forkEnd: existingRoot.id === left.id ? common.b.end : common.a.end, forkParentEnd: existingRoot.id === left.id ? common.a.end : common.b.end, inferred: true }));
                grouped++;
                continue;
            }
            const root = store.branch(null, 'Shared context', left.agent, store.raw(left.head, common.a.end), { operation: 'shared-prefix', cwd: x.p.cwd });
            root.synthetic = true;
            store.put('branch', root);
            const node = { id: id(), branchId: root.id, revisionId: root.head, start: 0, end: common.a.end, previousId: null, name: 'Shared context', createdAt: now() };
            store.put('node', node);
            root.nodeHead = node.id;
            store.put('branch', root);
            store.put('branch', metadata(left, { parentId: root.id, forkRevision: root.head, forkEnd: common.a.end, forkParentEnd: common.a.end, inferred: true }));
            store.put('branch', metadata(right, { parentId: root.id, forkRevision: root.head, forkEnd: common.b.end, forkParentEnd: common.a.end, inferred: true }));
            grouped++;
            roots.push(root);
        }
    return { grouped };
}
