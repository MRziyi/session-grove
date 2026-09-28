// Session provenance, not prompt text or title length, determines whether a
// native record belongs in the user's conversation manager.
export function sessionExclusion({ agent, source, threadSource, sidechain = false, chats }) {
    if (typeof source === 'string' && source.trim().startsWith('{')) { try { source = JSON.parse(source); } catch {} }
    if (sidechain || source && typeof source === 'object' && ('subagent' in source || 'sub_agent' in source)) return 'agent-owned';
    if (typeof source === 'string' && /^sub[_-]?agent/i.test(source)) return 'agent-owned';
    if (threadSource && ['agent', 'subagent', 'internal'].includes(String(threadSource).toLowerCase())) return 'agent-owned';
    if (agent === 'codex' && ['exec', 'automation'].includes(source)) return 'non-interactive';
    if (chats === 0) return 'empty';
    return null;
}
