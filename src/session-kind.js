// Native Codex ThreadSource feature labels (including automation):
// https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs
// Session provenance, not prompt text or title length, determines whether a
// native record belongs in the user's conversation manager.
export function backgroundKind({ agent, source, threadSource, sidechain = false, originKind, sessionKind }) {
    if (typeof source === 'string' && source.trim().startsWith('{')) { try { source = JSON.parse(source); } catch {} }
    if (sidechain || source && typeof source === 'object' && ('subagent' in source || 'sub_agent' in source)) return 'agent-owned';
    if (typeof source === 'string' && /^sub[_-]?agent/i.test(source)) return 'agent-owned';
    if (threadSource && ['agent', 'subagent', 'internal'].includes(String(threadSource).toLowerCase())) return 'agent-owned';
    if ([source, threadSource, source?.feature, source?.type, sessionKind, originKind].some(v => typeof v === 'string' && /^(exec|automation|scheduled|cron|background|daemon|daemon-worker|agent)(?:[_:-].*)?$/i.test(v))) return 'scheduled';
    return null;
}
export function sessionExclusion(options) {
    const kind = backgroundKind(options); if (kind) return options.showScheduled ? null : kind;
    const { chats } = options;
    if (chats === 0) return 'empty';
    return null;
}
export const BACKGROUND_PROJECT = '00000000-0000-4000-8000-000000000002';
