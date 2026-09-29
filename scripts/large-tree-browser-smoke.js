// Read-only browser check of an explicitly chosen live library.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
const base = process.argv[2], debug = process.argv[3]; assert(base && debug, 'Usage: node scripts/large-tree-browser-smoke.js URL DEBUG_URL');
const boot = await fetch(base + '/api/bootstrap').then(r => r.json());
const item = [...boot.items].filter(i => i.projectId && !i.archived).sort((a, b) => b.sessionIds.length - a.sessionIds.length)[0];
assert(item, 'No project tree available.');
const page = await (await fetch(debug + '/json/new?' + base, { method: 'PUT' })).json(), ws = new WebSocket(page.webSocketDebuggerUrl);
await once(ws, 'open'); let serial = 0; const pending = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
async function wait(expression) { for (let n = 0; n < 600; n++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timed out'); }
try {
    await call('Runtime.enable'); await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 1, mobile: false });
    const selector = `[...document.querySelectorAll('[data-scope]')].find(e=>e.dataset.scope===${JSON.stringify(item.projectId)})`;
    await wait(selector); await evaluate(selector + '.click()');
    const open = `[...document.querySelectorAll('[data-open]')].find(e=>e.dataset.open===${JSON.stringify(item.id)})`;
    await wait(open); const start = performance.now(); await evaluate(open + '.click()'); await wait('document.querySelectorAll(".graph-node").length > 0 && document.querySelector("#main").getAttribute("aria-busy") !== "true"');
    const report = { totalPaths: item.sessionIds.length, openMs: Math.round(performance.now() - start), visibleNodes: await evaluate('document.querySelectorAll(".graph-node").length'), visiblePaths: await evaluate('document.querySelector("#branch-picker").options.length'), errors };
    await evaluate('document.querySelector("#zoom-in").click(); document.querySelector("#graph-reset").click(); document.querySelector("#graph-fit").click()');
    report.fitPercent = await evaluate('parseInt(document.querySelector("#zoom-label").textContent)');
    assert.ok(report.fitPercent > 0 && report.fitPercent <= 100);
    assert.ok(await evaluate('(()=>{const view=document.querySelector("#graph-scroll").getBoundingClientRect();return [...document.querySelectorAll(".graph-node")].every(n=>{const r=n.getBoundingClientRect();return r.left>=view.left-1&&r.right<=view.right+1&&r.top>=view.top-1&&r.bottom<=view.bottom+1})})()'));
    const screenshot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('test-results/large-tree.png', Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
    assert.deepEqual(errors, []); fs.writeFileSync('test-results/large-tree-browser.json', JSON.stringify(report, null, 2)); console.log(report);
} finally { ws.close(); }
