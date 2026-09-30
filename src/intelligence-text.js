// Extract prose for naming only; original transcripts and model context stay untouched.
const injected = /^(?:\s*<(recommended_plugins|environment_context|ide_opened_file|ide_selection|system-reminder|local-command-caveat|local-command-stdout|command-name|command-message|command-args|skills_instructions|apps_instructions|plugins_instructions)>[\s\S]*?<\/\1>\s*)/;
export function humanText(text) {
    let value = String(text || '').trim();
    if (/^# Context from my IDE setup:\s/.test(value)) {
        const request = value.match(/^## My request:\s*\n/m);
        value = request ? value.slice(request.index + request[0].length).trim() : '';
    }
    while (injected.test(value)) value = value.replace(injected, '').trim();
    if (/^(?:# AGENTS\.md instructions for |\[Request interrupted by user|This session is being continued from a previous conversation|<turn_aborted>|<task-notification>|<subagent_notification>|<send_user_message_question_reply>)/.test(value)) return '';
    return value;
}
const textBlocks = content => typeof content === 'string' ? [content] : (content || []).filter(c => ['text','input_text','output_text'].includes(c.type)).map(c => c.text || '');
export function namingMessages(records, agent) {
    const messages = [];
    const hasResponseUsers = records.some(r => (r.value || r)?.type === 'response_item' && (r.value || r).payload?.role === 'user');
    for (const [index, record] of records.entries()) {
        const v = record.value || record, p = v.payload || {};
        let role, content;
        if (agent === 'codex') {
            if (v.type === 'response_item' && p.type === 'message' && ['user','assistant'].includes(p.role)) {
                if (p.role === 'assistant' && (p.channel === 'analysis' || p.recipient && p.recipient !== 'all')) continue;
                role = p.role; content = p.content;
            } else if (!hasResponseUsers && v.type === 'event_msg' && p.type === 'user_message') { role = 'user'; content = p.message; }
            else continue;
        } else {
            if (!['user','assistant'].includes(v.type) || v.isMeta || v.isCompactSummary || v.isApiErrorMessage || v.isSidechain || v.type === 'user' && v.origin?.kind && v.origin.kind !== 'human') continue;
            role = v.type; content = v.message?.content;
        }
        const text = textBlocks(content).map(s => role === 'user' ? humanText(s) : s.trim()).filter(Boolean).join('\n\n');
        if (text) messages.push({role, text, line:index + 1});
    }
    return messages;
}
export function namingEvidence(records, agent, {start=0,end=Infinity}={}) {
    const messages = namingMessages(records,agent).filter(m => m.line > start && m.line <= end);
    const user = messages.find(m => m.role === 'user');
    const assistant = user && messages.findLast(m => m.role === 'assistant' && m.line > user.line);
    return user && assistant ? {user:user.text, assistant:assistant.text} : null;
}
export function shortenAssistant(text, limit=6000) {
    text = String(text || '');
    const points = [...text];
    if (points.length <= limit) return text;
    return points.slice(0,Math.floor(limit/3)).join('')+'\n[…middle omitted…]\n'+points.slice(-Math.floor(limit*2/3)).join('');
}
