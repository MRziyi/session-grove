// Offline compatibility smoke: runs the installed Codex against an isolated home.
// Never copies authentication or config, and never submits a model turn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { codexSample, codexTurn } from '../src/demo.js';
const executable = process.argv[2] || 'codex';
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-codex-smoke-')));
const nativeHome = path.join(root, 'native'), cwd = path.join(root, 'project');
fs.mkdirSync(nativeHome);
fs.mkdirSync(cwd);
function connect() {
    const child = spawn(executable, ['app-server', '--stdio'], { env: { PATH: process.env.PATH, CODEX_HOME: nativeHome }, stdio: ['pipe', 'pipe', 'pipe'] });
    let n = 0, buffer = '', stderr = '';
    const pending = new Map();
    child.stderr.on('data', c => stderr = (stderr + c.toString()).slice(-3000));
    child.stdout.on('data', c => { buffer += c; let index; while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
            const m = JSON.parse(line), p = pending.get(m.id);
            if (p) {
                clearTimeout(p.timer);
                pending.delete(m.id);
                m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
            }
        }
        catch { }
    } });
    child.on('error', e => { for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(e);
    } pending.clear(); });
    child.on('exit', () => { for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Codex exited: ' + stderr));
    } pending.clear(); });
    const request = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n, timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout: ' + method + ' ' + stderr)); }, 15000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
    const init = async () => { await request('initialize', { clientInfo: { name: 'session_grove_smoke', version: '0.1.0' } }); child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'); };
    const close = async () => { if (child.exitCode === null) {
        child.kill();
        await once(child, 'exit');
    } };
    return { request, init, close };
}
const store = new Store(path.join(root, 'library'));
let client;
try {
    client = connect();
    await client.init();
    await client.request('thread/list', { limit: 10 });
    await client.close();
    const native = new Native(store, { roots: { codex: nativeHome, claude: path.join(root, 'claude') }, guard: () => { } });
    const p = store.project('Native verification'), raw = codexSample(cwd, [['Remember the marker grove-42.', 'The marker is grove-42.']]);
    const parent = store.branch(p.id, 'Root context', 'codex', raw), fork = store.fork(parent.id, { name: 'Native fork', end: store.detail(parent.id).checkpoints[0].end });
    native.setActive(fork.id, cwd, true);
    native.apply();
    const instance = store.instances()[0];
    client = connect();
    await client.init();
    const list = await client.request('thread/list', { limit: 100 });
    assert.ok(list.data.some(t => t.id === instance.nativeId), 'Codex did not list the materialized thread');
    const read = await client.request('thread/read', { threadId: instance.nativeId, includeTurns: true });
    assert.ok(JSON.stringify(read).includes('grove-42'), 'Codex did not read the inherited messages');
    const resumed = await client.request('thread/resume', { threadId: instance.nativeId, cwd, approvalPolicy: 'on-request', sandbox: 'read-only' });
    assert.equal(resumed.thread.id, instance.nativeId);
    await client.close();
    native.collect();
    native.setActive(fork.id, null, false);
    native.apply();
    client = connect();
    await client.init();
    const hidden = await client.request('thread/list', { limit: 100 });
    assert.ok(!hidden.data.some(t => t.id === instance.nativeId), 'Deactivated thread is still in the default list');
    await client.close();
    native.setActive(fork.id, cwd, true);
    native.apply();
    client = connect();
    await client.init();
    const restored = await client.request('thread/read', { threadId: instance.nativeId, includeTurns: true });
    assert.ok(JSON.stringify(restored).includes('grove-42'));
    await client.close();
    const payload = codexSample(cwd, [['Original context marker', 'Original answer']]).trim().split('\n').map(JSON.parse);
    payload[0].payload.history_mode = 'legacy';
    payload.push({ type: 'world_state', payload: { full: true, state: { permissions: {} } } }, { type: 'compacted', payload: { message: 'Summary marker', replacement_history: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Summary marker' }] }] } }, ...codexTurn('After compaction marker', 'Done'));
    const compact = store.branch(p.id, 'Compaction verification', 'codex', payload.map(v => JSON.stringify(v) + '\n').join(''));
    for (const enabled of [true, false, true]) {
        const current = store.get('branch', compact.id), event = store.parsed(current.head, 'codex').context.compactions[0];
        store.setCompaction(compact.id, { eventId: event.id, enabled, head: current.head });
        native.setActive(compact.id, cwd, true); native.apply([compact.id]);
        const live = store.instances().find(i => i.branchId === compact.id && i.applied);
        const output = fs.readFileSync(live.file, 'utf8');
        assert.equal(output.includes('"type":"compacted"'), enabled);
        assert.ok(output.includes('Original context marker')); assert.ok(output.includes('"type":"world_state"'));
        client = connect(); await client.init();
        const readContext = await client.request('thread/read', { threadId: live.nativeId, includeTurns: true });
        assert.ok(JSON.stringify(readContext).includes('After compaction marker'));
        const resumedContext = await client.request('thread/resume', { threadId: live.nativeId, cwd, approvalPolicy: 'on-request', sandbox: 'read-only' });
        assert.equal(resumedContext.thread.id, live.nativeId); await client.close(); native.collect();
    }
    const report = { version: execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim(), list: true, read: true, resume: true, deactivate: true, reactivate: true, compactionEnabledReadResume: true, compactionDisabledReadResume: true, modelTurnsSubmitted: 0 };
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/codex-compatibility.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
}
finally {
    await client?.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
}
