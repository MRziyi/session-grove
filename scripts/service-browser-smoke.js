import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const debug = process.argv[2] || 'http://127.0.0.1:9231', root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-reconnect-'));
let child, ws;
async function start(port = 0) {
    child = spawn(process.execPath, ['bin/session-grove.js', '--demo', '--data-dir', root, '--port', String(port)], { stdio: 'ignore' });
    for (let n = 0; n < 200 && !fs.existsSync(path.join(root, 'server.json')); n++) await new Promise(r => setTimeout(r, 25));
    return JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
}
try {
    const first = await start(), base = 'http://127.0.0.1:' + first.port;
    const page = await (await fetch(debug + '/json/new?' + base, { method: 'PUT' })).json(); ws = new WebSocket(page.webSocketDebuggerUrl); await once(ws, 'open');
    let serial = 0; const pending = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); } };
    const call = (method, params) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
    async function wait(expression) { for (let n = 0; n < 300; n++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timed out: ' + expression); }
    await wait('document.querySelectorAll(".session-row").length > 0');
    const exit = once(child, 'exit'); await fetch(base + '/api/service/stop', { method: 'POST', headers: { 'X-Grove-Token': first.token } }); await exit;
    await wait('document.querySelector("#cloud-status").textContent === "Service disconnected"');
    assert.equal(await evaluate('document.querySelector("#collect").disabled'), true);
    const second = await start(first.port); assert.notEqual(first.token, second.token);
    await wait('document.querySelector("#cloud-status").textContent !== "Service disconnected" && !document.querySelector("#collect").disabled');
    console.log('Service browser passed: explicit offline state, disabled writes, and automatic reconnection with a new server token.');
} finally { ws?.close(); if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } fs.rmSync(root, { recursive: true, force: true }); }
