// Requires a fresh Chrome profile started with --remote-debugging-port=9228.
import fs from 'node:fs';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:7421';
const page = await (await fetch('http://127.0.0.1:9228/json/new?' + base, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await once(ws, 'open');
let next = 0;
const pending = new Map(), errors = [];
ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown')
        errors.push(m.params.exceptionDetails.text);
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
};
const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
        if (await evaluate(expression))
            return;
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Timed out: ' + expression);
};
await call('Runtime.enable');
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 1, mobile: false });
await evaluate('localStorage.removeItem("grove-language")');
await call('Page.reload');
await wait('document.documentElement.lang === "en" && document.querySelectorAll(".collection-item").length >= 2');
assert.equal(await evaluate('document.documentElement.lang'), 'en');
assert.ok(await evaluate('document.querySelector("#active-list").getBoundingClientRect().top < document.querySelector("#projects").getBoundingClientRect().top'));
assert.equal(await evaluate('document.querySelector("#inspector").hidden'), true);
await evaluate('document.querySelector("#language").value="zh"; document.querySelector("#language").dispatchEvent(new Event("change"))');
assert.equal(await evaluate('document.querySelector("#local-home").textContent.includes("本机会话总览")'), true);
await call('Page.reload');
await wait('document.querySelectorAll(".collection-item").length >= 2');
assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN');
await evaluate('document.querySelector("#language").value="en"; document.querySelector("#language").dispatchEvent(new Event("change"))');
fs.mkdirSync('test-results', { recursive: true });
const screenshot = async (name) => { const result = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('test-results/' + name + '.png', Buffer.from(result.data, 'base64')); };
await screenshot('local-active');
await evaluate('[...document.querySelectorAll("[data-open-item]")].find(e=>e.textContent.includes("Shared context")).click()');
await wait('document.querySelector("#commit-pending")');
assert.ok(await evaluate('document.querySelector(".detail-head .meta").textContent.includes("20 messages")'));
await evaluate('document.querySelector("#commit-pending").click()');
await wait('document.querySelector("#commit-end")');
await evaluate('document.querySelector("[name=name]").value="Finished the introduction"; const select=document.querySelector("#commit-end"); select.value=[...select.options].find(o=>o.textContent.includes("First 10 messages")).value;select.dispatchEvent(new Event("change"))');
assert.ok(await evaluate('document.querySelector("#pending-remainder").textContent.includes("10 messages will remain")'));
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && document.querySelector(".detail-head .meta")?.textContent.includes("10 messages")');
await screenshot('pending-split');
await evaluate('document.querySelector("#commit-pending").click()');
await wait('document.querySelector("#commit-end")');
await evaluate('document.querySelector("[name=name]").value="Design experiments";const s=document.querySelector("#commit-end");s.value=s.options[s.options.length-1].value;document.querySelector("#dialog-form").requestSubmit()');
await wait('document.querySelector(".detail-head h2")?.textContent === "Design experiments"');
assert.ok(await evaluate('[...document.querySelectorAll(".card-title")].some(e=>e.textContent === "Finished the introduction")'));
await evaluate('document.querySelector("#move-item").click()');
await wait('document.querySelector("[name=projectId]")');
await evaluate('document.querySelector("[name=group]").value="Research"; document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && document.querySelector("#project-name")?.textContent === "Chrono"');
assert.ok(await evaluate('document.querySelector("#graph-world").textContent.includes("Research")'));
assert.equal(await evaluate('document.querySelectorAll(".logical-node").length'), 0);
await screenshot('project-collection');
await evaluate('[...document.querySelectorAll("[data-open-item]")].find(e=>e.textContent.includes("Shared context")).click()');
await wait('document.querySelectorAll(".logical-node").length >= 4');
await screenshot('logical-tree');
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
assert.ok(await evaluate('document.body.scrollWidth <= 390'));
await screenshot('mobile');
assert.deepEqual(errors, []);
console.log('Browser smoke passed: default English, persistent Chinese, Active-first layout, 20→10+10 Pending commits, move tree, project groups, desktop/mobile.');
await call('Page.close');
ws.close();
