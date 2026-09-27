// Requires a fresh Chrome profile started with --remote-debugging-port=9228.
import fs from 'node:fs';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const page = await (await fetch('http://127.0.0.1:9228/json/new?http://127.0.0.1:7421', { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await once(ws, 'open');
let next = 0;
const pending = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
} if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails.text); };
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails)
    throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const wait = async (expression) => { for (let i = 0; i < 100; i++) {
    if (await evaluate(expression))
        return;
    await new Promise(r => setTimeout(r, 100));
} throw new Error('Timed out: ' + expression); };
await call('Runtime.enable');
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 1, mobile: false });
await wait('document.querySelectorAll(".branch-card").length > 0');
assert.equal(await evaluate('document.querySelector("#project-name").textContent'), 'Chrono');
await evaluate('document.querySelector("#fork-branch").click()');
await wait('document.querySelector("#dialog").open');
await evaluate('document.querySelector("[name=name]").value="Browser verification";document.querySelector("#dialog-form").requestSubmit()');
await wait('document.querySelector(".detail-head h2")?.textContent === "Browser verification"');
assert.equal(await evaluate('document.querySelector("#active-count").textContent'), '0');
await evaluate('document.querySelector("#activate-branch").click()');
await wait('document.querySelector("[name=cwd]")');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open');
await evaluate('document.querySelector("#review-active").click()');
await wait('document.querySelector("#dialog-title").textContent === "应用 Active 清单"');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open');
assert.equal(await evaluate('document.querySelector("#pending-count").textContent'), '0');
await evaluate('document.querySelector("#archive-branch").click();document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open');
await evaluate('document.querySelector("#review-active").click()');
await wait('document.querySelector("#dialog-title").textContent === "应用 Active 清单"');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open');
await evaluate('document.querySelector(".branch-card").click()');
await wait('document.querySelector(".detail-head h2")?.textContent !== "Browser verification"');
fs.mkdirSync('test-results', { recursive: true });
const shot = await call('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('test-results/workspace.png', Buffer.from(shot.data, 'base64'));
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
assert.ok(await evaluate('document.body.scrollWidth <= 390'));
const mobile = await call('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('test-results/mobile.png', Buffer.from(mobile.data, 'base64'));
assert.deepEqual(errors, []);
console.log('Browser smoke passed: fork, explicit Active, apply, archive, desktop/mobile layout.');
await call('Page.close');
ws.close();
