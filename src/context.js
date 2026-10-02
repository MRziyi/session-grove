import {identifyCompactions} from './compaction-identity.js';
import { hash } from './util.js';
const tokenCache = new Map(); let tokenCacheBytes = 0;
// A local, deliberately approximate text metric. This is not a model tokenizer,
// billing usage, or the size of the live post-compaction context window.
export function estimateTokens(text) {
    const value = String(text || ''), cached = tokenCache.get(value);
    if (cached !== undefined) return cached;
    const nonAscii = value.replace(/[\u0000-\u007f]+/g, '');
    const latin = value.length - nonAscii.length, other = [...nonAscii].length;
    const result = Math.ceil(latin / 4 + other * 1.5), bytes = value.length * 2;
    if (bytes <= 1024 * 1024) {
        while (tokenCache.size && (tokenCacheBytes + bytes > 4 * 1024 * 1024 || tokenCache.size >= 1024)) { const oldest = tokenCache.keys().next().value; tokenCacheBytes -= oldest.length * 2; tokenCache.delete(oldest); }
        tokenCache.set(value, result); tokenCacheBytes += bytes;
    }
    return result;
}
const plain = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(c => ['text', 'input_text', 'output_text'].includes(c.type)).map(c => c.text || '').join('\n') : '';
export function contextInfo(records, agent) {
    const compactions = [], usage = [];
    let model = null;
    for (const [i, r] of records.entries()) {
        const v = r.value; if (!v) continue;
        const p = v.payload || {}, line = i + 1;
        if (agent === 'codex') {
            if (v.type === 'turn_context') model = p.model || model;
            if (v.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) {
                usage.push({ line, at: v.timestamp, input: p.info.last_token_usage.input_tokens, output: p.info.last_token_usage.output_tokens,
                    window: p.info.model_context_window || null, cumulative: p.info.total_token_usage?.total_tokens || null });
            }
            if (v.type === 'compacted') {
                const replacement = Array.isArray(p.replacement_history) ? p.replacement_history : [];
                const summaries = [p.message, ...replacement.filter(v => v.type === 'compaction').map(v => v.summary || v.text)].filter(v => typeof v === 'string' && v.trim());
                compactions.push({ line, at: v.timestamp, summary: summaries.join('\n\n') || null,
                    opaque: replacement.some(v => v.type === 'compaction' && !!v.encrypted_content),
                    retained: replacement.filter(v => v.type === 'message' && ['user', 'assistant'].includes(v.role)).map(v => ({ role: v.role, text: plain(v.content) })),
                    before: usage.at(-1)?.input ?? null, windowNumber: p.window_number ?? null });
            }
        } else {
            model = v.message?.model || model;
            const u = v.message?.usage;
            if (u && Number.isFinite(u.input_tokens)) usage.push({ line, at: v.timestamp,
                input: u.input_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens ?? null, window: null });
            if (v.type === 'system' && v.subtype === 'compact_boundary') compactions.push({ line, at: v.timestamp, summary: null, opaque: false, retained: [], before: v.compactMetadata?.preTokens ?? usage.at(-1)?.input ?? null });
            if (v.isCompactSummary && v.message) {
                let event = compactions.at(-1);
                if (!event) { event = { line, at: v.timestamp, retained: [], opaque: false, before: null }; compactions.push(event); }
                event.summary = plain(v.message.content) || null; event.summaryLine = line;
            }
        }
    }
    identifyCompactions(records,compactions,agent);
    for (const event of compactions) {
        event.canDisable = records.slice(0, event.line - 1).some(r => agent === 'codex' ? r.value?.type === 'response_item' && r.value.payload?.type === 'message' && r.value.payload.role === 'user' : r.value?.type === 'user' && !r.value.isCompactSummary && r.value.uuid);
    }
    for (const [i, event] of compactions.entries()) event.after = usage.find(u => u.line > event.line && (!compactions[i + 1] || u.line < compactions[i + 1].line))?.input ?? null;
    const last = usage.at(-1) || null, compact = compactions.at(-1);
    return { model, compactions, lastUsage: last, usageAfterCompaction: !compact || !!last && last.line > compact.line, estimateMethod: 'ascii/4 + non-ascii×1.5; visible text only' };
}

export function toolText(value, agent) {
    if (agent !== 'codex' || value?.type !== 'response_item') return '';
    const p = value.payload || {};
    if (['function_call', 'custom_tool_call'].includes(p.type)) return typeof (p.arguments ?? p.input) === 'string' ? p.arguments ?? p.input : JSON.stringify(p.arguments ?? p.input ?? '');
    if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) return typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
    return '';
}
