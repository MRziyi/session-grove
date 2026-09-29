import { supportedHistory } from './codex-history.js';
import { claudeMessages, claudeFork } from './claude.js';
import { contextProjection } from './context-policy.js';
import { contextInfo } from './context.js';
import { assert, hash, id, now } from './util.js';
import path from 'node:path';
export function parse(raw, agent, immutableRecords = null) {
    const records = immutableRecords || [], errors = [];
    if (immutableRecords) for (const [i, r] of records.entries()) if (!r.value && r.raw.trim()) errors.push(`第 ${i + 1} 行不是完整 JSON`);
    const lines = immutableRecords ? [] : raw.match(/[^\n]*\n|[^\n]+$/g) || [];
    for (const [index, line] of lines.entries()) {
        if (!line.trim()) {
            records.push({ raw: line, value: null });
            continue;
        }
        try {
            records.push({ raw: line, value: JSON.parse(line) });
        }
        catch {
            errors.push(`第 ${index + 1} 行不是完整 JSON`);
            records.push({ raw: line, value: null });
        }
    }
    const meta = records.findLast(r => r.value?.type === 'session_meta')?.value?.payload;
    const first = records.find(r => r.value?.sessionId)?.value;
    const nativeId = agent === 'codex' ? meta?.id : first?.sessionId;
    const cwd = agent === 'codex' ? meta?.cwd : records.find(r => r.value?.cwd)?.value.cwd;
    const messages = [], checkpoints = [];
    const pendingTools = new Set();
    let turnOpen = false, hasUser = false;
    const contentText = content => typeof content === 'string' ? content : (content || []).map(c => c.text || (c.type === 'tool_use' ? `[${c.name}] ${JSON.stringify(c.input)}` : c.type === 'tool_result' ? (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)) : `[${c.type}]`)).join('\n');
    const nativeMessages = agent === 'claude' && nativeId && !errors.length ? claudeMessages(raw ?? records.map(r => r.raw).join('')) : null;
    const rawLines = new Map(records.flatMap((r, i) => r.value?.uuid ? [[r.value.uuid, i + 1]] : []));
    const projected = nativeMessages?.map((m, index) => ({ value: { ...records[(rawLines.get(m.uuid) || 0) - 1]?.value, ...m, sessionId: m.session_id },
        line: rawLines.get(m.uuid) ?? ((nativeMessages.slice(index + 1).map(v => rawLines.get(v.uuid)).find(Boolean) || records.length + 1) - 0.5) }));
    for (const [index, rec] of (projected || records).entries()) {
        const i = projected ? rec.line - 1 : index;
        const v = rec.value;
        if (!v)
            continue;
        if (agent === 'codex') {
            const p = v.payload || {};
            if (v.type === 'event_msg' && p.type === 'task_started')
                turnOpen = true;
            if (v.type === 'response_item' && p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
                messages.push({ role: p.role, text: contentText(p.content), line: i + 1, timestamp: v.timestamp, phase: p.phase });
                if (p.role === 'user')
                    hasUser = true;
            }
            if (v.type === 'response_item' && /^(function_call|custom_tool_call)$/.test(p.type))
                pendingTools.add(p.call_id);
            if (v.type === 'response_item' && /^(function_call_output|custom_tool_call_output)$/.test(p.type))
                pendingTools.delete(p.call_id);
            if (v.type === 'event_msg' && p.type === 'task_complete') {
                turnOpen = false;
                if (!pendingTools.size && hasUser)
                    checkpoints.push({ end: i + 1, label: `轮次 ${checkpoints.length + 1}`, turnId: p.turn_id });
            }
        }
        else {
            if (['user', 'assistant'].includes(v.type) && v.message) {
                const content = v.message.content;
                for (const c of Array.isArray(content) ? content : []) {
                    if (c.type === 'tool_use')
                        { pendingTools.add(c.id); turnOpen = true; }
                    if (c.type === 'tool_result')
                        pendingTools.delete(c.tool_use_id);
                }
                const isTool = Array.isArray(content) && content.length && content.every(c => c.type === 'tool_result');
                const prose = typeof content === 'string' ? content : (content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n');
                if (isTool || prose) messages.push({ role: isTool ? 'tool' : v.type, text: isTool ? contentText(content) : prose, line: i + 1, timestamp: v.timestamp });
                if (v.type === 'user' && !isTool) { hasUser = true; turnOpen = true; }
                if (v.type === 'assistant' && !pendingTools.size && ['end_turn', 'stop_sequence'].includes(v.message.stop_reason)) {
                    turnOpen = false;
                    checkpoints.push({ end: i + 1, label: `轮次 ${checkpoints.length + 1}`, turnId: v.uuid });
                }
            }
        }
    }
    const warnings = [...errors];
    if (!nativeId && records.length)
        warnings.push('无法识别原生会话身份');
    if (agent === 'codex' && meta?.history_mode === 'paginated' && !supportedHistory({ meta, records })) warnings.push('Native history prefix is missing. Keep the earlier rollout segments available.');
    if (agent === 'codex' && meta?.history_mode && !['legacy', 'paginated'].includes(meta.history_mode))
        warnings.push(`暂不支持 ${meta.history_mode} 历史格式的原生写回`);
    if (turnOpen || pendingTools.size)
        warnings.push('存在未完成轮次或工具调用；可从较早的检查点分支');
    const media = records.some(({ raw, value }) => value && /"(?:image_url|file_id|audio_url)"\s*:\s*"(?!data:)|"(?:local_images|local_audio)"\s*:\s*\[\s*"/.test(raw));
    if (media)
        warnings.push('包含外部附件引用；当前版本需在目标环境保留这些资源');
    return { context: contextInfo(records, agent), records, nativeMessages, nativeId, cwd, messages, checkpoints, warnings, errors, hasUser, complete: !turnOpen && !pendingTools.size, meta };
}
export function renderNative(raw, agent, nativeId, cwd, title, contextPolicy = null, nativeFork = null) {
    const parsed = parse(raw, agent);
    assert(!parsed.errors.length, '损坏或尚未写完的记录不能激活');
    assert(!raw || parsed.nativeId, '未知会话格式，不能写回');
    assert(parsed.complete, '请等待原生轮次结束，或从已完成检查点创建分支');
    assert(supportedHistory(parsed), parsed.warnings.join('；') || 'Unsupported native history format.');
    const old = parsed.nativeId;
    const relocate = value => {
        if (!parsed.cwd || parsed.cwd === cwd || !path.isAbsolute(value || '')) return value;
        const relative = path.relative(parsed.cwd, value);
        return relative === '' || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) ? path.join(cwd, relative) : value;
    };
    if (agent === 'claude' && nativeId !== old && parsed.records.some(r => ['user', 'assistant'].includes(r.value?.type))) {
        const original = nativeFork?.raw || raw, originalParsed = nativeFork ? parse(original, agent) : parsed;
        const input = contextPolicy ? contextProjection(originalParsed, agent, contextPolicy, old, cwd).map(r => JSON.stringify(r.value) + '\n').join('') : original;
        const rows = claudeFork(input, title, nativeFork?.upToMessageId);
        return rows.map(v => JSON.stringify({ ...v, ...(v.sessionId ? { sessionId: nativeId } : {}), ...(v.cwd ? { cwd: relocate(v.cwd) } : {}) }) + '\n').join('');
    }
    const records = contextPolicy ? contextProjection(parsed, agent, contextPolicy, nativeId, cwd) : parsed.records;
    const rows = records.map(({ raw: line, value }, index) => {
        if (!value)
            return line;
        // Preserve untouched Codex model/history records byte-for-byte. Besides
        // avoiding large tool-output clones, this preserves unknown numeric fields
        // that JavaScript cannot represent exactly.
        if (agent === 'codex' && !['session_meta','turn_context','token_usage_record'].includes(value.type)) return line;
        const v = structuredClone(value);
        if (agent === 'codex' && parsed.meta?.history_mode === 'paginated' && index === 0) v.payload = structuredClone(parsed.meta);
        if (agent === 'codex') {
            if (v.type === 'session_meta') {
                delete v.payload.history_base;
                if (nativeId !== old) { v.payload.forked_from_id = old; if (parsed.meta?.history_mode === 'paginated') v.payload.forked_from_ordinal_exclusive = parsed.records.filter(r => r.value).at(-1).value.ordinal + 1; }
                v.payload.id = nativeId;
                if (v.payload.session_id === old)
                    v.payload.session_id = nativeId;
                v.payload.cwd = cwd;
                if (v.payload.runtime_workspace_roots) v.payload.runtime_workspace_roots = [cwd];
            }
            if (v.type === 'turn_context') {
                v.payload.cwd = relocate(v.payload.cwd) || cwd;
                if (v.payload.workspace_roots)
                    v.payload.workspace_roots = [cwd];

            }
            if (v.type === 'token_usage_record')
                for (const k of ['thread_id', 'session_id'])
                    if (v.payload[k] === old)
                        v.payload[k] = nativeId;
        }
        else {
            if (v.sessionId)
                v.sessionId = nativeId;
            if (v.cwd)
                v.cwd = relocate(v.cwd);
            if (v.type === 'custom-title')
                v.customTitle = title;
        }
        return JSON.stringify(v) + '\n';
    });
    if (!rows.length && agent === 'codex')
        rows.push(JSON.stringify({ timestamp: now(), type: 'session_meta', payload: { id: nativeId, timestamp: now(), cwd, originator: 'session_grove', cli_version: '0.0.0', source: 'cli', model_provider: 'openai' } }) + '\n');
    if (agent === 'claude')
        rows.push(JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: nativeId }) + '\n');
    return rows.join('');
}
export function blank(agent, cwd) {
    const nativeId = id();
    if (agent === 'codex')
        return renderNative('', agent, nativeId, cwd, 'New session');
    return JSON.stringify({ type: 'system', subtype: 'session_grove_origin', sessionId: nativeId, cwd, uuid: id(), timestamp: now(), content: 'Session created by Session Grove.' }) + '\n';
}
export function recordRefs(raw) { return (raw.match(/[^\n]*\n|[^\n]+$/g) || []).map(body => ({ hash: hash(body), body })); }
