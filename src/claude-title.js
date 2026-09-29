// Presentation only: never rewrite the original transcript or strip user XML.
export function claudeTitle(records) {
    const values = records.map(r => r.value ?? r);
    const custom = values.findLast(v => v.type === 'custom-title' && v.customTitle)?.customTitle;
    const automatic = values.findLast(v => v.type === 'ai-title' && v.aiTitle)?.aiTitle;
    let prompt = '';
    for (const v of values) {
        if (v.type !== 'user' || v.isMeta) continue;
        const content = v.message?.content;
        const text = typeof content === 'string' ? content : (content || []).filter(b=>b.type==='text').map(b=>b.text).join('\n');
        const cleaned = text.replace(/<(ide_opened_file|ide_selection|system-reminder|local-command-caveat|local-command-stdout|command-name|command-message|command-args)>[\s\S]*?<\/\1>/g,'').trim();
        if (cleaned && !/^\[Request interrupted by user/.test(cleaned)) { prompt = cleaned; break; }
    }
    const initialization = !custom && !automatic && !prompt && values.some(v=>v.type==='user' && /<(?:ide_opened_file|command-name|local-command)/.test(JSON.stringify(v.message?.content))) && !values.some(v=>v.type==='assistant' && !v.isApiErrorMessage);
    // Detach short previews so a sliced title cannot retain a huge prompt.
    const shortPrompt = JSON.parse(JSON.stringify(prompt.slice(0,100)));
    return { title: custom || automatic || shortPrompt, prompt: shortPrompt, titleSource: custom?'custom':automatic?'automatic':'first-prompt', initialization };
}
