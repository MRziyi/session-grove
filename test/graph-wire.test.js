import test from 'node:test';
import assert from 'node:assert/strict';
import { packGraph } from '../src/graph-wire.js';
test('graph wire format deduplicates bodies while preserving every path and tool location', () => {
    const message = { id: 'shared', role: 'user', text: 'context'.repeat(1000), activity: [{ id: 'tool', line: 4, chatLine: 3, preview: 'result' }] };
    const graph = { id: 'tree', paths: [{ branchId: 'a', messages: [{ ...message, line: 3 }] }, { branchId: 'b', messages: [{ ...message, line: 8 }] }, { branchId: 'c', messages: [{ ...message, line: 11, activity: [{ id: 'other-tool', line: 12, chatLine: 11 }] }] }] };
    const wire = packGraph(graph); assert.equal(Object.keys(wire.messagePool).length, 2);
    const { messagePool, format, ...decoded } = wire; decoded.paths = wire.paths.map(p => ({ ...p, messages: p.messages.map(m => ({ ...messagePool[m.ref], line: m.line })) }));
    assert.deepEqual(decoded, graph); assert.ok(JSON.stringify(wire).length < JSON.stringify(graph).length);
});
