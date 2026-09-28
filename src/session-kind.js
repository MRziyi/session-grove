// Native Codex ThreadSource feature labels (including automation):
// https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs
// Session provenance, not prompt text or title length, determines whether a
// native record belongs in the user's conversation manager.
export function sessionExclusion({ agent, source, threadSource, sidechain = false, chats, showScheduled = false }) {
    if (typeof source === 'string' && source.trim().startsWith('{')) { try { source = JSON.parse(source); } catch {} }
    if (sidechain || source && typeof source === 'object' && ('subagent' in source || 'sub_agent' in source)) return 'agent-owned';
    if (typeof source === 'string' && /^sub[_-]?agent/i.test(source)) return 'agent-owned';
    if (threadSource && ['agent', 'subagent', 'internal'].includes(String(threadSource).toLowerCase())) return 'agent-owned';
    if (agent === 'codex' && [source, threadSource, source?.feature, source?.type].some(v => typeof v === 'string' && /^(exec|automation|scheduled|cron|background)(?:[_:-].*)?$/i.test(v)) && !showScheduled) return 'scheduled';
    if (chats === 0) return 'empty';
    return null;
}
