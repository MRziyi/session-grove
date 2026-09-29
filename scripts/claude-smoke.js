// Read-only personal inventory; all native forks use an in-memory SDK store.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getSessionMessages, forkSession } from '@anthropic-ai/claude-agent-sdk';
import { parse, renderNative } from '../src/transcript.js';
import { walk, hash, id } from '../src/util.js';
const home = process.argv[2];
assert(home, 'Usage: node scripts/claude-smoke.js /path/to/claude-home');
const files = walk(path.join(home, 'projects')).filter(f => !f.includes('/subagents/') && !path.basename(f).startsWith('agent-'));
const semantic = messages => messages.map(m => [m.type, m.message]);
function normalizeFork(rows) {
    const identities = new Map(rows.map(r => [r.uuid, r.forkedFrom?.messageUuid || '<generated>']));
    const lastCopied = rows.findLastIndex(r => r.forkedFrom);
    const normalize = (v, key, depth, generatedTime) => {
        if (depth === 1 && key === 'timestamp' && generatedTime) return '<timestamp>';
        if (depth === 1 && key === 'sessionId') return '<session>';
        if (typeof v === 'string') return identities.get(v) || v;
        if (Array.isArray(v)) return v.map(x => normalize(x, undefined, depth + 1, generatedTime));
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x, k, depth + 1, generatedTime)]));
        return v;
    };
    return rows.map((r,i) => normalize(r, undefined, 0, i === lastCopied || !r.forkedFrom));
}

const report = { sessions: 0, checkpoints: 0, importedBytes: 0, modelRequests: 0, originalFilesUnchanged: true, sdk: '0.3.283', failures: [] };
for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8'), before = hash(raw), p = parse(raw, 'claude');
    if (p.errors.length || !p.nativeId) { report.failures.push({ phase: 'parse' }); continue; }
    const rows = p.records.map(r => r.value), source = await getSessionMessages(p.nativeId, { sessionStore: { load: async () => rows } });
    assert.equal(hash(JSON.stringify(semantic(p.nativeMessages))), hash(JSON.stringify(semantic(source))), 'Native message projection differs.'); report.sessions++; report.importedBytes += Buffer.byteLength(raw);
    for (const checkpoint of p.checkpoints) {
        const prefix = p.records.slice(0, checkpoint.end).map(r => r.raw).join('');
        const output = renderNative(prefix, 'claude', id(), p.cwd, 'Equivalence check', null, { raw, upToMessageId: checkpoint.turnId });
        let forked;
        await forkSession(p.nativeId, { upToMessageId: checkpoint.turnId, title: 'Equivalence check', sessionStore: { load: async () => rows, append: async (_key, entries) => { forked = entries; } } });
        const expected = await getSessionMessages(id(), { sessionStore: { load: async () => forked } });
        assert.equal(hash(JSON.stringify(semantic(parse(output, 'claude').nativeMessages))), hash(JSON.stringify(semantic(expected))), 'Fork message payloads differ.'); report.checkpoints++;
        assert.equal(hash(JSON.stringify(normalizeFork(output.trim().split('\n').map(JSON.parse)))), hash(JSON.stringify(normalizeFork(forked))), 'Native fork records differ beyond generated IDs/timestamps.');
    }
    assert.equal(hash(fs.readFileSync(file)), before);
}
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync('test-results/claude-equivalence.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
