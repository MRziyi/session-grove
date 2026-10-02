import {compactionDisabled} from './compaction-identity.js';
import { supportedHistory } from './codex-history.js';
import { assert, hash } from './util.js';
export const policyHash = policy => hash(JSON.stringify([...(policy?.disabled || [])].sort()));
export const validPolicy = policy => !policy || Array.isArray(policy.disabled) && policy.disabled.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
export function contextProjection(parsed, agent, policy, nativeId, cwd) {
    const remove = new Set();
    for (const event of parsed.context.compactions) if (compactionDisabled(policy,event)) {
        assert(event.canDisable, 'Original pre-compaction history is unavailable.');
        remove.add(event.line); if (event.summaryLine) remove.add(event.summaryLine);
    }
    if (agent === 'codex') {
        assert(supportedHistory(parsed), 'Native history prefix is missing. Keep the earlier rollout segments available.');
        // Preserve every original record and unknown field. Only an explicitly
        // disabled compaction boundary is removed; never synthesize new instructions.
        return parsed.records.filter((r, i) => !remove.has(i + 1));
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
