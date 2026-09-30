import { activationInfo } from './activation.js';
import { assert, hash } from './util.js';

export const groveTitle = (session, node) => `[Grove] ${session} · ${node || 'Pending'}`;

// Preview a prefix without creating a branch or changing native files.
export function nodeActivation(store, native, { branchId, nodeId, version, cwd }) {
    const graph = store.treeGraph(branchId, 'all');
    assert(version === graph.version, 'Conversation changed. Refresh before activating.', 409);
    const branch = store.get('branch', branchId), path = graph.paths.find(p => p.branchId === branchId);
    const node = graph.nodes.find(n => n.id === nodeId && n.branchIds.includes(branchId));
    assert(path && node, 'Select a node on this path.');
    assert(!branch.archived && !(branch.projectId && store.get('project', branch.projectId).archived), 'Restore this session before activating.');
    const terminal = node.endBranchIds.includes(branchId), revision = store.get('revision', branch.head);
    const last = path.messages.findLast(m => node.chatIds.includes(m.id));
    const next = last && path.messages[path.messages.indexOf(last) + 1];
    const checkpoint = last && path.checkpoints.findLast(c => c.end >= last.line && (!next || c.end < next.line));
    const end = terminal ? revision.refs.length : checkpoint?.end;
    const nodeName = node.name || (node.empty ? branch.activationNodeName : null) || 'Pending';
    if (!end) return { branch, node, terminal, preview: { complete: false, readiness: 'node-boundary', title: groveTitle(branch.name, nodeName), nodeName } };
    const parsed = store.parsed(branch.head, branch.agent, end);
    const contextPolicy = branch.contextPolicy ? { disabled: branch.contextPolicy.disabled.filter(id => parsed.context.compactions.some(e => e.id === id)) } : undefined;
    const prefix = { ...branch, contextPolicy };
    const virtual = { get: () => prefix, parsed: () => parsed, instances: () => terminal ? store.instances() : [] };
    const budget = activationInfo(virtual, native, branchId, cwd);
    const fingerprint = hash(JSON.stringify([budget.fingerprint, graph.version, branchId, nodeId, end]));
    return { branch, node, terminal, end, parsed, prefix, preview: { ...budget, fingerprint, title: groveTitle(branch.name, nodeName), nodeName, end, createsContinuation: !terminal } };
}
