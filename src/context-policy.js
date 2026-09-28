import { assert, hash, now } from './util.js';
export const policyHash = policy => hash(JSON.stringify([...(policy?.disabled || [])].sort()));
export const validPolicy = policy => !policy || Array.isArray(policy.disabled) && policy.disabled.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
export function contextProjection(parsed, agent, policy, nativeId, cwd) {
    const disabled = new Set(policy?.disabled || []), remove = new Set();
    for (const event of parsed.context.compactions) if (disabled.has(event.id)) {
        assert(event.canDisable, 'Original pre-compaction history is unavailable.');
        remove.add(event.line); if (event.summaryLine) remove.add(event.summaryLine);
    }
    if (agent === 'codex') {
        assert(parsed.records.every(r => !r.value || ['session_meta', 'response_item', 'event_msg', 'turn_context', 'world_state', 'token_usage_record', 'compacted'].includes(r.value.type)), 'This history format cannot be rebuilt safely.');
        const kept = parsed.records.filter((r, i) => !remove.has(i + 1) && (['response_item', 'compacted'].includes(r.value?.type) || r.value?.type === 'event_msg' && ['task_started', 'task_complete', 'user_message', 'agent_message', 'item_completed'].includes(r.value.payload?.type)));
        // Rebuild a fresh legacy rollout from conversation items. Do not replay a
        // paginated world's old permission/environment settings on this device.
        const meta = { timestamp: now(), type: 'session_meta', payload: { id: nativeId, timestamp: now(), cwd, source: 'cli', originator: 'session_grove', cli_version: parsed.meta?.cli_version || '', model_provider: parsed.meta?.model_provider || 'openai', history_mode: 'legacy' } };
        return [{ value: meta, raw: JSON.stringify(meta) + '\n' }, ...kept];
    }
    // Claude compact summaries can start a new parent chain. Reconnect only the
    // removed boundary/summary UUIDs to the retained prefix when expansion is requested.
    const parents = new Map(); let previous = null;
    for (const [i, r] of parsed.records.entries()) {
        if (remove.has(i + 1) && r.value?.uuid) parents.set(r.value.uuid, previous);
        else if (r.value?.uuid) previous = r.value.uuid;
    }
    return parsed.records.flatMap((r, i) => {
        if (remove.has(i + 1)) return [];
        if (!r.value || !parents.has(r.value.parentUuid)) return [r];
        const value = structuredClone(r.value), seen = new Set();
        while (parents.has(value.parentUuid) && !seen.has(value.parentUuid)) { seen.add(value.parentUuid); value.parentUuid = parents.get(value.parentUuid); }
        return [{ value, raw: JSON.stringify(value) + '\n' }];
    });
}
