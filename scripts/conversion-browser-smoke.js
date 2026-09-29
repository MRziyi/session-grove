import fs from 'node:fs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
const base = process.argv[2] || 'http://127.0.0.1:7425', debuggerBase = process.argv[3] || 'http://127.0.0.1:9231';
const page = await (await fetch(debuggerBase + '/json/new?' + base, { method: 'PUT' })).json(), ws = new WebSocket(page.webSocketDebuggerUrl);
await once(ws, 'open'); let serial = 0; const pending = new Map(), errors = [];
ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
async function wait(expression) { for (let n = 0; n < 200; n++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timed out: ' + expression); }
try {
    await call('Runtime.enable'); await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await wait('[...document.querySelectorAll("[data-scope]")].find(e=>e.dataset.scope==="active:claude")');
    await evaluate('localStorage.setItem("grove-language","zh")'); await call('Page.reload');
    await wait('[...document.querySelectorAll("[data-scope]")].find(e=>e.dataset.scope==="active:claude")');
    await evaluate('[...document.querySelectorAll("[data-scope]")].find(e=>e.dataset.scope==="active:claude").click()');
    await wait('document.querySelector("[data-open]")'); await evaluate('document.querySelector("[data-open]").click()');
    await wait('document.querySelector(".graph-node")'); await evaluate('[...document.querySelectorAll(".graph-node:not(.dimmed)")].at(-1).click()');
    await wait('document.querySelector("#convert-session")'); await evaluate('document.querySelector("#convert-session").click()');
    await wait('document.querySelector("[name=mode]")');
    assert.equal(await evaluate('document.querySelector("[name=mode]").value'), 'lean');
    await evaluate('document.querySelector("#dialog-submit").click()'); await wait('document.querySelector("#conversion-preview").textContent.includes("tokens")');
    assert.ok(await evaluate('document.querySelector("#conversion-preview").textContent.includes("只读输出")'));
    await evaluate('document.querySelector("[name=mode]").value="full";document.querySelector("[name=mode]").dispatchEvent(new Event("change"))');
    assert.equal(await evaluate('document.querySelector("#dialog-submit").textContent'), '预览上下文');
    await evaluate('document.querySelector("#dialog-submit").click()'); await wait('document.querySelector("#conversion-preview").textContent.includes("JSONL")');
    const screenshot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('test-results/conversion-preview.png', Buffer.from(screenshot.data, 'base64'));
    await evaluate('document.querySelector("#dialog-submit").click()'); await wait('!document.querySelector("#dialog").open');
    await evaluate('[...document.querySelectorAll("[data-scope]")].find(e=>e.dataset.scope==="active:codex").click()'); await wait('document.querySelector("#session-list").textContent.includes("codex (full)")');
    assert.deepEqual(errors, []); console.log('Conversion browser passed: Chinese UI, lean/full preview, invalidation, actual demo activation, target listing, no JS exceptions.');
} finally { ws.close(); }
