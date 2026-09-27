import fs from 'node:fs';
import path from 'node:path';
import { id, now } from './util.js';
import { parse } from './transcript.js';
export function codexSample(cwd, pairs) {
    const nativeId = id(), rows = [{ timestamp: now(), type: 'session_meta', payload: { id: nativeId, timestamp: now(), cwd, originator: 'codex_cli_rs', cli_version: '0.155.0', source: 'cli', model_provider: 'openai', history_mode: 'legacy' } }];
    for (const [user, assistant] of pairs)
        rows.push(...codexTurn(user, assistant));
    return rows.map(r => JSON.stringify(r) + '\n').join('');
}
export function codexTurn(user, assistant) {
    const turnId = id();
    return [
        { timestamp: now(), type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } },
        { timestamp: now(), type: 'event_msg', payload: { type: 'user_message', message: user, images: [], local_images: [], text_elements: [] } },
        { timestamp: now(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: user }] } },
        { timestamp: now(), type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: assistant }] } },
        { timestamp: now(), type: 'event_msg', payload: { type: 'agent_message', message: assistant, phase: 'final_answer' } },
        { timestamp: now(), type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId } }
    ];
}
export function claudeSample(cwd, pairs) {
    const sessionId = id();
    let parentUuid = null;
    const rows = [];
    for (const [user, assistant] of pairs)
        for (const [type, content] of [['user', user], ['assistant', assistant]]) {
            const uuid = id();
            rows.push({ type, uuid, parentUuid, sessionId, cwd, timestamp: now(), version: '2.1.0', message: { role: type, content: [{ type: 'text', text: content }], ...(type === 'assistant' ? { stop_reason: 'end_turn' } : {}) } });
            parentUuid = uuid;
        }
    return rows.map(r => JSON.stringify(r) + '\n').join('');
}
export function seedDemo(store, roots) {
    if (store.all('project').length)
        return;
    const cwd = path.join(store.root, 'workspace', 'Chrono');
    fs.mkdirSync(cwd, { recursive: true });
    for (const root of Object.values(roots))
        fs.mkdirSync(root, { recursive: true });
    const project = store.project('Chrono', '论文研究 · 从共同背景到不同的研究方向');
    const base = store.branch(project.id, '建立论文上下文', 'codex', codexSample(cwd, [['我们来整理 Chrono 的研究背景和核心问题。', 'Chrono 研究时间信息在长期推理中的作用。我们先建立共同背景，再分别探索引言、方法与实验。'], ['请记住：我们需要比较不同时间跨度下的推理表现。', '已整理三个研究问题：时间顺序是否重要、长期信息如何保留，以及跨时间段的泛化。这个位置适合作为后续工作的共同检查点。']]), { cwd, client: 'VS Code', deviceName: 'Research Mac', operation: 'import' });
    const end = store.detail(base.id).checkpoints.at(-1).end;
    const intro = store.fork(base.id, { name: 'Introduction · 叙事结构', end });
    const append = (b, u, a) => store.ingest(b.id, store.raw(b.head) + codexTurn(u, a).map(r => JSON.stringify(r) + '\n').join(''), b.head, { cwd, agent: 'codex', client: 'CLI', deviceName: 'Research Mac' });
    const revised = append(intro, '从研究动机开始，拟定 Introduction 的三段结构。', '第一段提出长期任务中的时间依赖；第二段说明现有上下文管理的局限；第三段介绍 Chrono 的方法与贡献。');
    const method = store.fork(base.id, { name: 'Method · 时间表示', end });
    append(method, '探索显式时间表示的设计。', '可以将事件时间、观察时间和相对间隔分别编码。先进行受控消融，再决定是否增加复杂度。');
    const alternate = store.fork(base.id, { name: '早期思路 · 已归档', end });
    store.edit(alternate.id, { archived: true });
    const exp = store.fork(revised.id, { name: '实验设计', end: store.detail(revised.id).checkpoints.at(-1).end });
    append(exp, '设计三个有区分度的实验。', '建议依次验证：时间排序任务、长跨度事件检索，以及跨域时间推理。保持数据量与上下文预算一致。');
    const related = store.branch(project.id, 'Related Work · 文献梳理', 'claude', claudeSample(cwd, [['梳理与 Chrono 相关的研究方向。', '可以从长期记忆、时间推理和检索增强三个方向建立文献矩阵，记录每项工作的时间假设和评估方式。']]), { cwd, agent: 'claude', client: 'CLI', deviceName: 'Research Mac' });
    store.edit(related.id, { group: 'Literature' });
    store.project('Session Grove', '项目会话管理控制端');
    store.local('demoCwd', cwd);
    // Named work nodes are deliberately independent of native messages and threads.
    for (const b of store.all('branch')) {
        const d = store.detail(b.id);
        if (d.pending.checkpoints.length)
            store.commitPending(b.id, { name: b.name, end: d.pending.checkpoints.at(-1).end, revisionId: d.head, expectedStart: d.pending.start });
    }
    const sessionsDir = path.join(roots.codex, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const common = [['Establish the Chrono research context.', 'We are studying temporal information in long-running reasoning.'], ['Keep the evaluation budget fixed.', 'Agreed. All experiments should use the same context and data budget.']];
    const titles = [];
    for (const [index, name] of ['Introduction experiments', 'Method alternatives'].entries()) {
        const raw = codexSample(cwd, [...common, ...Array.from({ length: 10 }, (_, i) => [`${index ? 'Method' : 'Intro'} question ${i + 1}`, `Research note ${i + 1}: a complete step in this direction.`])]);
        const nativeId = parse(raw, 'codex').nativeId;
        fs.writeFileSync(path.join(sessionsDir, `demo-${nativeId}.jsonl`), raw);
        titles.push({ id: nativeId, thread_name: name, updated_at: now() });
    }
    fs.writeFileSync(path.join(roots.codex, 'session_index.jsonl'), titles.map(v => JSON.stringify(v) + '\n').join(''));
    const raw = claudeSample(cwd, [['A few unrelated notes for later.', 'I will keep these notes separate until you file them.']]);
    const nativeId = parse(raw, 'claude').nativeId, dir = path.join(roots.claude, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${nativeId}.jsonl`), raw);
}
