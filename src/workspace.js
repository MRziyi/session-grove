import { ledger } from './context-ledger.js';
import { assert, hash, id as newId, now } from './util.js';
import { estimateTokens, toolText } from './context.js';
import { policyHash } from './context-policy.js';
import { sessionExclusion } from './session-kind.js';
import { parse } from './transcript.js';
import { rootOf, treeMembers } from './organization.js';

// Native threads, collection rows, and logical nodes are distinct projections.
export const isActive = i => i.applied && !i.missing && !i.excluded && i.cwdAvailable !== false;
export function visibleSession(store, b) {
    if (b.synthetic || b.excluded) return false;
    const p = store.parsed(b.head, b.agent);
    return !sessionExclusion({ agent: b.agent, source: p.meta?.source, sidechain: b.agent === 'claude' && p.records.find(r => ['user', 'assistant'].includes(r.value?.type))?.value?.isSidechain === true, chats: p.messages.filter(m => m.role !== 'tool').length });
}
const modified = b => b.contentUpdatedAt || b.updatedAt;
export function collections(store) {
    const branches = store.all('branch'), instances = store.instances(), buckets = new Map();
    for (const b of branches) {
        const root = rootOf(store, b.id);
        if (!buckets.has(root.id)) buckets.set(root.id, { root, members: [] });
        buckets.get(root.id).members.push(b);
    }
    const items = [...buckets.values()].flatMap(({ root, members }) => {
        const sessions = members.filter(b => visibleSession(store, b));
        if (!sessions.length) return [];
        const representative = root.synthetic ? [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0] : root;
        const count = b => store.parsed(b.head, b.agent).messages.filter(m => m.role !== 'tool').length;
        return [{ id: root.id, name: representative.name, projectId: root.projectId, agent: root.agent,
            kind: sessions.length > 1 ? 'tree' : 'session', sessionIds: sessions.map(b => b.id),
            sessions: sessions.map(b => ({ id: b.id, name: b.name, agent: b.agent, archived: !!b.archived,
                active: instances.some(i => i.branchId === b.id && isActive(i)), chats: count(b), updatedAt: modified(b) })),
            archived: sessions.every(b => b.archived), updatedAt: sessions.map(modified).sort().at(-1) }];
    });
    return { items, activeCounts: Object.fromEntries(['codex', 'claude'].map(agent => [agent, branches.filter(b => visibleSession(store, b) && b.agent === agent && instances.some(i => i.branchId === b.id && isActive(i))).length])) };
}
export function listing(store, scope = 'active:codex', query = '') {
    const { items } = store.collections(), projects = store.all('project');
    const activeAgent = scope.startsWith('active:') ? scope.slice(7) : null;
    const q = String(query).trim().toLocaleLowerCase();
    const result = items.flatMap(item => {
        const project = projects.find(p => p.id === item.projectId);
        let sessions = item.sessions;
        if (activeAgent) sessions = sessions.filter(s => s.agent === activeAgent && s.active && !s.archived && !project?.archived);
        else if (scope === 'archived') sessions = sessions.filter(s => s.archived || project?.archived);
        else sessions = sessions.filter(s => item.projectId === scope && !s.archived && !project?.archived);
        if (!sessions.length) return [];
        const matching = q ? sessions.filter(s => s.name.toLocaleLowerCase().includes(q) || parse(store.raw(store.get('branch', s.id).head), s.agent).messages.some(m => m.text.toLocaleLowerCase().includes(q))) : sessions;
        if (!matching.length && !item.name.toLocaleLowerCase().includes(q)) return [];
        return [{ ...item, sessions, sessionIds: sessions.map(s => s.id), name: sessions.find(s => s.id === item.id)?.name || sessions[0].name, kind: sessions.length > 1 ? 'tree' : 'session', visibleSessionIds: sessions.map(s => s.id), matchedSessionIds: matching.map(s => s.id),
            visibleCount: sessions.length, updatedAt: sessions.map(s => s.updatedAt).sort().at(-1),
            chats: sessions.length === 1 ? sessions[0].chats : null,
            groupName: project?.name || null, groupId: project?.id || null }];
    });
    const groupTimes = new Map();
    for (const item of result) groupTimes.set(item.groupId, [groupTimes.get(item.groupId) || '', item.updatedAt].sort().at(-1));
    result.sort((a, b) => (groupTimes.get(b.groupId) || '').localeCompare(groupTimes.get(a.groupId) || '') || String(a.groupId).localeCompare(String(b.groupId)) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return { items: result, sessionCount: result.reduce((n, i) => n + i.visibleCount, 0), itemCount: result.length };
}

// IDs are derived from the owning native thread and the semantic prefix. Metadata
// and materialized path changes never invalidate a user's organization.
export function buildGraph(store, branchId) {
    const root = rootOf(store, branchId), members = treeMembers(store, root.id), cache = new Map(), messages = new Map();
    function pathFor(b, revisionId = b.head) {
        const key = `${b.id}:${revisionId}`;
        if (cache.has(key)) return cache.get(key);
        const p = store.parsed(revisionId, b.agent), inventory = ledger(p, b.agent), visible = p.messages.filter(m => m.role !== 'tool');
        const byChat = new Map();
        for (const e of inventory.entries) { if (!byChat.has(e.chatLine)) byChat.set(e.chatLine, []); byChat.get(e.chatLine).push(e); }
        let inherited = [];
        if (b.parentId && b.forkRevision) {
            const parent = store.get('branch', b.parentId);
            const parentPath = pathFor(parent, b.forkRevision);
            const childPrefix = visible.filter(m => m.line <= b.forkEnd);
            const parentPrefix = parentPath.filter(m => m.line <= (b.forkParentEnd ?? b.forkEnd));
            // Rewritten native history must not be mistaken for its former prefix.
            if (childPrefix.length === parentPrefix.length && childPrefix.every((m, i) => m.role === parentPrefix[i].role && m.text === parentPrefix[i].text))
                inherited = parentPrefix.map((m, i) => ({ ...m, line: childPrefix[i].line }));
        }
        let prefix = '';
        const path = visible.map((m, index) => {
            prefix = hash(prefix + JSON.stringify([m.role, m.text]));
            const message = inherited[index] || { ...m, id: `${b.chatIdentity || b.id}:${prefix.slice(0, 24)}`, ownerId: b.id };
            const value = { ...message, line: m.line, toolTokens: (byChat.get(m.line) || []).filter(e => ['tool-call', 'tool-result'].includes(e.kind)).reduce((n,e) => n + e.tokens, 0), activity: byChat.get(m.line) || [] };
            if (!messages.has(value.id)) messages.set(value.id, value);
            return value;
        });
        cache.set(key, path);
        return path;
    }
    const paths = members.filter(b => visibleSession(store, b)).map(b => ({ branchId: b.id, name: b.name, agent: b.agent, archived: !!b.archived,
        head: b.head, canRewriteContext: !store.parsed(b.head, b.agent).meta?.history_mode || store.parsed(b.head, b.agent).meta.history_mode === 'legacy', canActivate: !store.parsed(b.head, b.agent).meta?.history_mode || store.parsed(b.head, b.agent).meta.history_mode === 'legacy' || store.instances().some(i => i.branchId === b.id && i.adopted && i.baseRevision === b.head && (i.contextPolicyHash || policyHash(null)) === policyHash(b.contextPolicy)), active: store.instances().some(i => i.branchId === b.id && isActive(i)),
        context: { ...store.parsed(b.head, b.agent).context, ledger: (() => { const l = ledger(store.parsed(b.head, b.agent), b.agent); return { ...l, entries: l.entries.filter(e => e.chatLine === null) }; })(), compactions: store.parsed(b.head, b.agent).context.compactions.map(e => ({ ...e, enabled: !(b.contextPolicy?.disabled || []).includes(e.id) })) }, contextPolicy: b.contextPolicy || null, contextPending: store.instances().some(i => i.branchId === b.id && isActive(i) && ((i.contextPolicyHash || policyHash(null)) !== policyHash(b.contextPolicy) || i.baseRevision !== b.head)), messages: pathFor(b), checkpoints: store.parsed(b.head, b.agent).checkpoints }));
    const assignments = {};
    // Read legacy append-only nodes as initial annotations without changing history.
    for (const b of members) {
        if (b.synthetic || b.excluded) continue;
        const detail = store.detail(b.id);
        for (const node of detail.nodes) for (const m of pathFor(b, node.revisionId)) {
            if (m.line > node.start && m.line <= node.end) assignments[m.id] = { id: node.id, name: node.name };
        }
    }
    const layout = root.layoutHead ? store.get('layout', root.layoutHead) : null;
    if (layout) for (const [id, value] of Object.entries(layout.assignments)) assignments[id] = value;
    const next = new Map(), previous = new Map(), endpoints = new Set(), compactStarts = new Set();
    for (const p of paths) for (const event of p.context.compactions) {
        const first = p.messages.find(m => m.line > event.line);
        if (first) compactStarts.add(first.id);
    }
    for (const p of paths) {
        if (p.messages.length) endpoints.add(p.messages.at(-1).id);
        for (let i = 0; i < p.messages.length; i++) {
            const id = p.messages[i].id;
            if (!next.has(id)) next.set(id, new Set());
            if (!previous.has(id)) previous.set(id, new Set());
            if (i) { next.get(p.messages[i - 1].id).add(id); previous.get(id).add(p.messages[i - 1].id); }
        }
    }
    const nodeByChat = new Map(), nodes = [], edges = new Map();
    const same = (a, b) => (assignments[a]?.id || null) === (assignments[b]?.id || null);
    for (const p of paths) {
        let current;
        for (const m of p.messages) {
            if (nodeByChat.has(m.id)) { current = nodeByChat.get(m.id); continue; }
            const predecessor = [...(previous.get(m.id) || [])][0];
            const parent = nodeByChat.get(predecessor);
            const extend = !compactStarts.has(m.id) && parent && current === parent && next.get(predecessor)?.size === 1 && !endpoints.has(predecessor) && same(predecessor, m.id);
            if (!extend) {
                current = { id: `segment-${hash(m.id).slice(0, 20)}`, annotationId: assignments[m.id]?.id || null,
                    name: assignments[m.id]?.name || null, pending: !assignments[m.id], chatIds: [], branchIds: [], endBranchIds: [], parentIds: [], childIds: [] };
                nodes.push(current);
            }
            current.chatIds.push(m.id);
            nodeByChat.set(m.id, current);
        }
    }
    for (const p of paths) {
        p.nodeIds = [...new Set(p.messages.map(m => nodeByChat.get(m.id).id))];
        for (const id of p.nodeIds) {
            const n = nodes.find(n => n.id === id);
            n.branchIds.push(p.branchId);
        }
        if (p.nodeIds.length) nodes.find(n => n.id === p.nodeIds.at(-1)).endBranchIds.push(p.branchId);
        for (let i = 1; i < p.nodeIds.length; i++) {
            const a = p.nodeIds[i - 1], b = p.nodeIds[i];
            edges.set(`${a}:${b}`, { from: a, to: b });
        }
    }
    for (const { from, to } of edges.values()) {
        nodes.find(n => n.id === from).childIds.push(to);
        nodes.find(n => n.id === to).parentIds.push(from);
    }
    // Topological order, deterministic colors, and adjacent Pending warm colors.
    const ordered = [], remaining = new Set(nodes.map(n => n.id));
    while (remaining.size) {
        const ready = nodes.filter(n => remaining.has(n.id) && n.parentIds.every(id => !remaining.has(id)));
        assert(ready.length, 'Conversation graph contains a cycle.');
        for (const n of ready) {
            n.depth = n.parentIds.length ? 1 + Math.max(...n.parentIds.map(id => nodes.find(x => x.id === id).depth)) : 0;
            const used = new Set(n.parentIds.map(id => nodes.find(x => x.id === id).color));
            let color = parseInt(hash(n.annotationId || n.id).slice(0, 4), 16) % (n.pending ? 4 : 7);
            while (used.has(`${n.pending ? 'pending' : 'color'}-${color}`)) color = (color + 1) % (n.pending ? 4 : 7);
            n.color = `${n.pending ? 'pending' : 'color'}-${color}`;
            n.splitBoundary = n.childIds.length > 1 || n.endBranchIds.length > 0;
            n.count = n.chatIds.length;
            n.tokens = { estimate: n.chatIds.reduce((sum, id) => sum + estimateTokens(messages.get(id)?.text), 0), recordedEstimate: n.chatIds.reduce((sum, id) => sum + estimateTokens(messages.get(id)?.text) + (messages.get(id)?.toolTokens || 0), 0), kind: 'recorded-text-estimate' };
            n.afterCompaction = compactStarts.has(n.chatIds[0]);
            ordered.push(n); remaining.delete(n.id);
        }
    }
    return { id: root.id, projectId: root.projectId, layoutHead: root.layoutHead || null,
        version: hash(JSON.stringify([members.map(b => [b.id, b.head, b.nodeHead, b.parentId, b.archived, b.contextPolicy]), root.layoutHead || null])),
        name: store.collections().items.find(i => i.id === root.id)?.name || root.name,
        nodes: ordered, edges: [...edges.values()], paths, assignments,
        chatCount: new Set(paths.flatMap(p => p.messages.map(m => m.id))).size,
        pendingCount: ordered.filter(n => n.pending).reduce((n, s) => n + s.count, 0) };
}

export function treeGraph(store, branchId, view = 'all') {
    assert(['all', 'in-use', 'archived'].includes(view), 'Unknown tree view.');
    const root = rootOf(store, branchId), graph = store.memo('graph:' + root.id, () => buildGraph(store, root.id));
    if (view === 'all') return graph;
    const projectArchived = root.projectId && store.get('project', root.projectId).archived;
    const paths = graph.paths.filter(p => view === 'archived' ? p.archived || projectArchived : !p.archived && !projectArchived);
    const pathIds = new Set(paths.map(p => p.branchId)), nodeIds = new Set(paths.flatMap(p => p.nodeIds)), chats = new Set(paths.flatMap(p => p.messages.map(m => m.id)));
    const nodes = graph.nodes.filter(n => nodeIds.has(n.id)).map(n => ({ ...n, branchIds: n.branchIds.filter(id => pathIds.has(id)), endBranchIds: n.endBranchIds.filter(id => pathIds.has(id)), parentIds: n.parentIds.filter(id => nodeIds.has(id)), childIds: n.childIds.filter(id => nodeIds.has(id)) }));
    return { ...graph, view, projectArchived: !!projectArchived, paths, nodes, edges: graph.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to)), assignments: Object.fromEntries(Object.entries(graph.assignments).filter(([id]) => chats.has(id))), name: paths.find(p => p.branchId === root.id)?.name || paths[0]?.name || graph.name, chatCount: chats.size, pendingCount: nodes.filter(n => n.pending).reduce((sum, n) => sum + n.count, 0) };
}

export function organize(store, branchId, { version, pathId, chatIds, action, name, nodeId }) {
    return store.transaction(() => {
        const graph = treeGraph(store, branchId);
        assert(version === graph.version, 'Conversation changed. Refresh before organizing.', 409);
        const path = graph.paths.find(p => p.branchId === pathId);
        assert(path && !path.archived && !(graph.projectId && store.get('project', graph.projectId).archived), 'Restore this session before organizing.');
        if (action === 'rename') { const node = graph.nodes.find(n => n.id === nodeId && n.branchIds.includes(pathId)); assert(node, 'Select a node to rename.'); if (node.name && node.name === String(name || '').trim()) return { layoutHead: graph.layoutHead }; chatIds = node.chatIds; }
        const selected = new Set(chatIds);
        assert(Array.isArray(chatIds) && selected.size && selected.size === chatIds.length, 'Select chats to organize.');
        const route = graph.paths.find(p => p.branchId === pathId);
        assert(route, 'Select a session path.');
        const positions = route.messages.map((m, i) => selected.has(m.id) ? i : -1).filter(i => i >= 0);
        assert(positions.length === selected.size, 'All selected chats must belong to one path.');
        assert(['combine', 'dissolve', 'rename'].includes(action), 'Unknown organization action.');
        assert(positions.at(-1) - positions[0] + 1 === positions.length, 'Select a consecutive range.');
        if (action === 'combine') {
            // A segment cannot straddle an actual split or another session endpoint.
            const selectedNodes = graph.nodes.filter(n => n.chatIds.some(id => selected.has(id)));
            for (const n of selectedNodes) {
                const endPosition = route.messages.findIndex(m => m.id === n.chatIds.at(-1));
                if (endPosition >= positions[0] && endPosition < positions.at(-1))
                    assert(n.childIds.length <= 1 && !n.endBranchIds.length, 'Cannot combine across a fork point.');
            }
        }
        const root = store.get('branch', graph.id), assignments = { ...graph.assignments };
        const annotation = action !== 'dissolve' ? { id: newId(), name: String(name || '').trim() } : null;
        if (annotation) assert(annotation.name.length > 0 && annotation.name.length <= 200, 'Enter a node title (1–200 characters).');
        for (const id of selected) assignments[id] = annotation;
        const layout = { id: newId(), rootId: root.id, parent: root.layoutHead || null, assignments, createdAt: now() };
        store.put('layout', layout);
        store.put('branch', { ...root, layoutHead: layout.id });
        return { layoutHead: layout.id };
    });
}

export function moveItems(store, { itemIds, projectId, projectName }) {
    assert(Array.isArray(itemIds) && itemIds.length, 'Select sessions to move.');
    return store.transaction(() => {
        const roots = [...new Set(itemIds.map(id => rootOf(store, id).id))];
        const project = projectId ? store.get('project', projectId) : store.project(projectName);
        assert(!project.archived, 'Restore the destination project first.');
        for (const id of roots) {
            for (const b of treeMembers(store, id)) {
                // Written directly here to keep project creation and all moves atomic.
                store.put('branch', { ...b, projectId: project.id, group: '', metaVersion: newId(),
                    metaAncestors: [...new Set([...(b.metaAncestors || []), b.metaVersion].filter(Boolean))] });
            }
        }
        return { projectId: project.id, moved: roots.length };
    });
}
