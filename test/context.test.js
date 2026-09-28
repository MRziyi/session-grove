import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/transcript.js';
import { estimateTokens } from '../src/context.js';
import { codexSample, codexTurn, claudeSample } from '../src/demo.js';
const lines = rows => rows.map(v => JSON.stringify(v) + '\n').join('');
test('Codex compaction preserves history and distinguishes opaque summary, retained text and reported usage', () => {
    const usage = n => ({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: n, output_tokens: 30 }, total_token_usage: { total_tokens: 900000 }, model_context_window: 200000 } } });
    const raw = codexSample('/work', [['Old context', 'Done']]) + lines([usage(150000), { type: 'compacted', payload: { message: '', replacement_history: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Retained user request' }] }, { type: 'compaction', encrypted_content: 'opaque-example' }] } }, usage(8000), ...codexTurn('New turn', 'Done')]);
    const p = parse(raw, 'codex'); assert.equal(p.messages.length, 4);
    assert.equal(p.context.compactions[0].summary, null); assert.equal(p.context.compactions[0].opaque, true);
    assert.equal(p.context.compactions[0].retained[0].text, 'Retained user request');
    assert.equal(p.context.compactions[0].before, 150000); assert.equal(p.context.compactions[0].after, 8000);
    assert.equal(p.context.lastUsage.input, 8000); assert.equal(p.context.lastUsage.cumulative, 900000);
    const partial = parse(raw.split(JSON.stringify(usage(8000)))[0], 'codex'); assert.equal(partial.context.usageAfterCompaction, false);
});
test('Claude recognizes a saved readable compact summary and includes cache tokens in reported input', () => {
    const raw = claudeSample('/work', [['A', 'B']]) + lines([{ type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 120000 } }, { type: 'user', isCompactSummary: true, message: { content: 'Keep the research constraints.' } }, { type: 'assistant', message: { content: 'Ready', stop_reason: 'end_turn', usage: { input_tokens: 1000, cache_read_input_tokens: 4000, cache_creation_input_tokens: 500 } } }]);
    const p = parse(raw, 'claude'); assert.equal(p.context.compactions[0].summary, 'Keep the research constraints.'); assert.equal(p.context.lastUsage.input, 5500); assert.equal(p.context.lastUsage.window, null);
});
test('text estimates are explicitly approximate, handle Chinese, and do not use cumulative billing as context', () => {
    assert.equal(estimateTokens('abcd'), 1); assert.equal(estimateTokens('上下文'), 5); assert.equal(estimateTokens(''), 0);
});
test('Claude expansion removes only the selected boundary/summary and reconnects the known parent chain', async () => {
    const { renderNative } = await import('../src/transcript.js');
    const prefix = claudeSample('/work', [['Original request', 'Original answer']]).trim().split('\n').map(JSON.parse);
    const parent = prefix.at(-1).uuid, sessionId = prefix[0].sessionId;
    const raw = lines([...prefix,
        { type: 'system', subtype: 'compact_boundary', uuid: 'boundary', parentUuid: parent, sessionId, cwd: '/work' },
        { type: 'user', uuid: 'summary', parentUuid: null, sessionId, cwd: '/work', isCompactSummary: true, message: { role: 'user', content: 'Summary-only text' } },
        { type: 'assistant', uuid: 'after', parentUuid: 'summary', sessionId, cwd: '/work', message: { role: 'assistant', content: 'Continuation', stop_reason: 'end_turn' } }
    ]);
    const event = parse(raw, 'claude').context.compactions[0];
    const output = renderNative(raw, 'claude', 'new-session', '/target', 'Resumed', { disabled: [event.id] });
    const p = parse(output, 'claude'); assert.equal(p.context.compactions.length, 0); assert.equal(p.messages.length, 3);
    assert.equal(p.records.find(r => r.value?.uuid === 'after').value.parentUuid, parent);
    assert.ok(!output.includes('Summary-only text')); assert.ok(raw.includes('Summary-only text'));
});
