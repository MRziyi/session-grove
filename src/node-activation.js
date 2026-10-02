import {policyForCompactions} from './compaction-identity.js';
import { pendingLabels } from '../web/library-view.js';
import { activationInfo } from './activation.js';
import { assert, hash } from './util.js';

export const groveTitle = (session, node) => `[Grove] ${session} · ${node || 'Pending'}`;

// Preview a prefix without creating a branch or changing native files.
export function nodeActivation(store, native, { branchId, nodeId, version, cwd }) {
    const graph = store.treeGraph(branchId, 'in-use');
    assert(version === graph.version, 'Conversation changed. Refresh before activating.', 409);
    const branch = store.get('branch', branchId), path = graph.paths.find(p => p.branchId === branchId);
    const node = graph.nodes.find(n => n.id === nodeId && n.branchIds.includes(branchId));
    assert(path && node, 'Select a node on this path.');
    assert(!branch.archived && !(branch.projectId && store.get('project', branch.projectId).archived), 'Restore this session before activating.');
    const terminal = node.endBranchIds.includes(branchId), revision = store.get('revision', branch.head);
    const last = path.messages.findLast(m => node.chatIds.includes(m.id));
    const next = last && path.messages[path.messages.indexOf(last) + 1];
    // The next compaction belongs to the following context window.
    const followingCompact = last && path.context.compactions.find(c => c.line > last.line);
    const boundary = Math.min(next?.line ?? Infinity, followingCompact?.line ?? Infinity);
    const checkpoint = last && path.checkpoints.findLast(c => c.end >= last.line && c.end < boundary);
    let end = terminal ? revision.refs.length : checkpoint?.end;
    if (!end && last) {
        end = Number.isFinite(boundary) ? Math.ceil(boundary) - 1 : revision.refs.length;
        // Duplicate native event text belongs to the following visible message.
        const records = store.parsed(branch.head, branch.agent).records;
        for (let i = Math.ceil(last.line); i < end; i++) {
            const v = records[i]?.value;
            if (v?.type === 'event_msg' && ['task_started', next?.role === 'assistant' ? 'agent_message' : 'user_message'].includes(v.payload?.type)) { end = i; break; }
        }
    }
    if (end && Number.isFinite(boundary)) end = Math.min(end, Math.ceil(boundary) - 1);
    const nodeName = node.name || 'Pending ' + pendingLabels(graph.nodes).get(node.id);
    if (!end) return { branch, node, terminal, preview: { complete: false, readiness: 'node-boundary', title: groveTitle(branch.name, nodeName), nodeName } };
    const parsed = store.parsed(branch.head, branch.agent, end);
    const contextPolicy = policyForCompactions(branch.contextPolicy,parsed.context.compactions);
    const nodeBoundary = !path.checkpoints.some(c => c.end === end) && !parsed.pendingToolCalls;
    const prefix = { ...branch, contextPolicy, allowNodeBoundary: nodeBoundary };
    const virtual = { get: () => prefix, parsed: () => parsed, instances: () => [] };
    const budget = activationInfo(virtual, native, branchId, cwd);
    const fingerprint = hash(JSON.stringify([budget.fingerprint, graph.version, branchId, nodeId, end]));
    return { branch, node, terminal, end, parsed, prefix, nodeBoundary, preview: { ...budget, fingerprint, title: groveTitle(branch.name, nodeName), nodeName, end, createsContinuation: true } };
}
