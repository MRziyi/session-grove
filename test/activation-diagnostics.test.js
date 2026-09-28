import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { activationInfo } from '../src/activation.js';
import { Diagnostics } from '../src/diagnostics.js';
import { codexSample, claudeSample } from '../src/demo.js';
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-budget-')), store = new Store(path.join(root, 'library'));
    const native = { roots: { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') } }; Object.values(native.roots).forEach(p => fs.mkdirSync(p));
    t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); }); return { root, store, native };
}
test('activation reads explicit Codex window/profile and marks estimated risk without assuming a model limit', t => {
    const { root, store, native } = fixture(t), b = store.branch(null, 'Budget', 'codex', codexSample(root, [['x'.repeat(4000), 'Ready']]));
    assert.equal(activationInfo(store, native, b.id, root, {}).unknown, true);
    fs.writeFileSync(path.join(native.roots.codex, 'config.toml'), 'model_context_window = 800\nprofile = "research"\n[model_providers.private]\nmodel_context_window = 999999\n');
    let c = activationInfo(store, native, b.id, root, {}); assert.equal(c.window, 800); assert.equal(c.risk, true);
    fs.writeFileSync(path.join(native.roots.codex, 'research.config.toml'), 'model_context_window = 10_000\n');
    c = activationInfo(store, native, b.id, root, {}); assert.equal(c.window, 10000); assert.equal(c.risk, false);
});
test('Claude explicit compaction budget is a planning threshold, not a fabricated hard context limit', t => {
    const { root, store, native } = fixture(t), b = store.branch(null, 'Claude', 'claude', claudeSample(root, [['x'.repeat(4000), 'Ready']]));
    fs.writeFileSync(path.join(native.roots.claude, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80' } }));
    const c = activationInfo(store, native, b.id, root, {}); assert.equal(c.window, null); assert.equal(c.compactAt, 800); assert.equal(c.risk, true);
});
test('diagnostic reports omit payloads and credential fields', t => {
    const { root } = fixture(t), logs = new Diagnostics(root);
    logs.record('test', { password: 'secret-password', transcript: 'private conversation', url: 'https://private.example', durationMs: 12 });
    logs.request('POST', '/api/trees/01234567-abcd-abcd-abcd-012345678901?q=private', 409, 8, 'reference');
    const report = JSON.stringify(logs.report());
    for (const secret of ['secret-password', 'private conversation', 'private.example', '?q=', '01234567-abcd']) assert.ok(!report.includes(secret));
    assert.ok(report.includes('reference')); assert.equal(fs.statSync(logs.file).mode & 0o777, 0o600);
});
test('native Codex index titles and archive flags are observed without writing native files', async t => {
    const { root, store, native: options } = fixture(t);
    const { DatabaseSync } = await import('node:sqlite');
    const { Native } = await import('../src/native.js');
    const { parse } = await import('../src/transcript.js');
    const raw = codexSample(root, [['An old prompt', 'Ready']]), nativeId = parse(raw, 'codex').nativeId;
    const dir = path.join(options.roots.codex, 'sessions'); fs.mkdirSync(dir);
    const file = path.join(dir, 'session.jsonl'); fs.writeFileSync(file, raw);
    const db = new DatabaseSync(path.join(options.roots.codex, 'state_5.sqlite'));
    db.exec('CREATE TABLE threads (id TEXT, title TEXT, archived INTEGER)'); db.prepare('INSERT INTO threads VALUES (?,?,?)').run(nativeId, 'Actual native title', 1); db.close();
    const native = new Native(store, { roots: options.roots, guard: () => {} }); native.refreshLocal();
    assert.equal(store.collections().activeCounts.codex, 0);
    assert.equal(store.listing('archived').items[0].name, 'Actual native title');
    assert.equal(store.listing('archived').sessionCount, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
});
test('long native auto-titles import as bounded display labels without rewriting the source', async t => {
    const { root, store, native: options } = fixture(t);
    const { Native } = await import('../src/native.js');
    const { parse } = await import('../src/transcript.js');
    const raw = codexSample(root, [['Prompt', 'Ready']]), id = parse(raw, 'codex').nativeId;
    fs.mkdirSync(path.join(options.roots.codex, 'sessions')); const file = path.join(options.roots.codex, 'sessions', 'a.jsonl'); fs.writeFileSync(file, raw);
    fs.writeFileSync(path.join(options.roots.codex, 'session_index.jsonl'), JSON.stringify({ id, thread_name: 'Native title '.repeat(100) }) + '\n');
    const native = new Native(store, { roots: options.roots, guard: () => {} }), result = native.refreshLocal();
    assert.equal(result.discovered, 1); assert.equal(result.errors.length, 0);
    assert.equal(store.all('branch')[0].name.length, 200); assert.equal(native.plan().operations.length, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
});
test('bounded transfer workers drain pending requests before reporting a failure', async () => {
    const { mapConcurrent } = await import('../src/util.js');
    let active = 0, maximum = 0;
    await assert.rejects(mapConcurrent([0, 1, 2, 3, 4, 5], async n => { active++; maximum = Math.max(active, maximum); await new Promise(r => setTimeout(r, 5)); active--; if (n === 1) throw new Error('failed'); }, 3), /failed/);
    assert.ok(maximum <= 3); assert.equal(active, 0);
});
test('historical duplicate rollouts never become a second active instance of the same native thread', async t => {
    const { root, store, native: options } = fixture(t);
    const { DatabaseSync } = await import('node:sqlite'); const { Native } = await import('../src/native.js'); const { parse } = await import('../src/transcript.js');
    const raw = codexSample(root, [['Context', 'Ready']]), id = parse(raw, 'codex').nativeId, dir = path.join(options.roots.codex, 'sessions'); fs.mkdirSync(dir);
    const current = path.join(dir, 'current.jsonl'), old = path.join(dir, 'historical.jsonl'); fs.writeFileSync(current, raw); fs.writeFileSync(old, raw);
    const db = new DatabaseSync(path.join(options.roots.codex, 'state_5.sqlite')); db.exec('CREATE TABLE threads (id TEXT,title TEXT,archived INTEGER,rollout_path TEXT)'); db.prepare('INSERT INTO threads VALUES (?,?,?,?)').run(id, 'Current title', 0, current); db.close();
    const native = new Native(store, { roots: options.roots, guard: () => {} }); native.refreshLocal();
    assert.equal(store.collections().activeCounts.codex, 1); assert.equal(store.instances().length, 1); assert.equal(store.instances()[0].file, current);
    assert.equal(fs.readFileSync(old, 'utf8'), raw);
});
