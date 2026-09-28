import { contextInfo } from './context.js';
import { assert, hash, id, now } from './util.js';
export function parse(raw, agent) {
    const records = [], errors = [];
    const lines = raw.match(/[^\n]*\n|[^\n]+$/g) || [];
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
    const meta = records.find(r => r.value?.type === 'session_meta')?.value?.payload;
    const first = records.find(r => r.value?.sessionId)?.value;
    const nativeId = agent === 'codex' ? meta?.id : first?.sessionId;
    const cwd = agent === 'codex' ? meta?.cwd : first?.cwd;
    const messages = [], checkpoints = [];
    const pendingTools = new Set();
    let turnOpen = false, hasUser = false;
    const contentText = content => typeof content === 'string' ? content : (content || []).map(c => c.text || (c.type === 'tool_use' ? `[${c.name}] ${JSON.stringify(c.input)}` : c.type === 'tool_result' ? (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)) : `[${c.type}]`)).join('\n');
    for (const [i, rec] of records.entries()) {
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
                        pendingTools.add(c.id);
                    if (c.type === 'tool_result')
                        pendingTools.delete(c.tool_use_id);
                }
                const isTool = Array.isArray(content) && content.length && content.every(c => c.type === 'tool_result');
                messages.push({ role: isTool ? 'tool' : v.type, text: contentText(content), line: i + 1, timestamp: v.timestamp });
                if (v.type === 'user' && !isTool)
                    hasUser = true;
                if (v.type === 'assistant' && !pendingTools.size && ['end_turn', 'stop_sequence'].includes(v.message.stop_reason))
                    checkpoints.push({ end: i + 1, label: `轮次 ${checkpoints.length + 1}`, turnId: v.uuid });
            }
        }
    }
    const warnings = [...errors];
    if (!nativeId && records.length)
        warnings.push('无法识别原生会话身份');
    if (agent === 'codex' && meta?.history_mode && meta.history_mode !== 'legacy')
        warnings.push(`暂不支持 ${meta.history_mode} 历史格式的原生写回`);
    if (turnOpen || pendingTools.size)
        warnings.push('存在未完成轮次或工具调用；可从较早的检查点分支');
    const media = records.some(({ value: v }) => v && /"(?:image_url|file_id|local_images|local_audio|audio_url)"/.test(JSON.stringify(v)) && /"(?:image_url|file_id|audio_url)"\s*:\s*"(?!data:)|"(?:local_images|local_audio)"\s*:\s*\[\s*"/.test(JSON.stringify(v)));
    if (media)
        warnings.push('包含外部附件引用；当前版本需在目标环境保留这些资源');
    return { context: contextInfo(records, agent), records, nativeId, cwd, messages, checkpoints, warnings, errors, hasUser, complete: !turnOpen && !pendingTools.size, meta };
}
export function renderNative(raw, agent, nativeId, cwd, title) {
    const parsed = parse(raw, agent);
    assert(!parsed.errors.length, '损坏或尚未写完的记录不能激活');
    assert(!raw || parsed.nativeId, '未知会话格式，不能写回');
    assert(parsed.complete, '请等待原生轮次结束，或从已完成检查点创建分支');
    assert(!parsed.warnings.some(w => w.includes('历史格式')), parsed.warnings.join('；'));
    const old = parsed.nativeId;
    const rows = parsed.records.map(({ raw: line, value }) => {
        if (!value)
            return line;
        const v = structuredClone(value);
        if (agent === 'codex') {
            if (v.type === 'session_meta') {
                v.payload.id = nativeId;
                if (v.payload.session_id === old)
                    v.payload.session_id = nativeId;
                v.payload.cwd = cwd;
                v.payload.runtime_workspace_roots = [cwd];
            }
            if (v.type === 'turn_context') {
                v.payload.cwd = cwd;
                if (v.payload.workspace_roots)
                    v.payload.workspace_roots = [cwd];
                // Permissions are re-established by the destination client, not copied between machines.
                for (const k of ['permission_profile', 'active_permission_profile', 'file_system_sandbox_policy'])
                    delete v.payload[k];
                v.payload.approval_policy = 'on-request';
                v.payload.sandbox_policy = { type: 'read-only' };
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
                v.cwd = cwd;
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
