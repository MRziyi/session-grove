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
await wait('document.querySelectorAll(".session-row").length === 1');
assert.equal(await evaluate('document.documentElement.lang'), 'en');
assert.equal(await evaluate('[...document.querySelectorAll("[data-scope]")].find(e=>e.dataset.scope==="active:codex").querySelector(".count").textContent'), '2');
assert.equal(await evaluate('document.querySelector("#list-count").textContent'), '2 sessions');
assert.equal(await evaluate('document.querySelector(".row-meta").textContent'), '2 branches');
assert.equal(await evaluate('document.querySelector("#session-list").textContent.includes("Ungrouped")'), true);
fs.mkdirSync('test-results', { recursive: true });
const screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('test-results/' + name + '.png', Buffer.from(result.data, 'base64')); };
await screenshot('v3-active-list');
await evaluate('document.querySelector("#language").click()');
assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN');
await call('Page.reload');
await wait('document.querySelectorAll(".session-row").length === 1');
assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN');
await evaluate('document.querySelector("#language").click()');
await evaluate('{ const e=document.querySelector("#search");e.value="not in any session 123";e.dispatchEvent(new Event("input")); }');
await wait('document.querySelectorAll(".session-row").length === 0');
await evaluate('{ const e=document.querySelector("#search");e.value="Intro question 9";e.dispatchEvent(new Event("input")); }');
await wait('document.querySelectorAll(".session-row").length === 1');
await evaluate('document.querySelector("[data-open]").click()');
await wait('document.querySelectorAll(".graph-node").length === 3');
assert.equal(await evaluate('document.querySelectorAll("[data-chat]").length'), 24);
assert.ok(await evaluate('document.querySelector("#transcripts").textContent.includes("Intro question")'));
await screenshot('v3-pending-tree');
const select = async positions => evaluate(`for(const i of ${JSON.stringify(positions)})document.querySelectorAll("[data-chat]")[i].click()`);
const combine = async name => {
    await evaluate('document.querySelector("#combine").click()');
    await wait('document.querySelector("#dialog").open');
    await evaluate(`document.querySelector("[name=name]").value=${JSON.stringify(name)};document.querySelector("#dialog-form").requestSubmit()`);
    await wait('!document.querySelector("#dialog").open');
    await wait('!document.querySelector("#combine")');
};
await select([0, 1]); await combine('Setup context');
assert.ok(await evaluate('[...document.querySelectorAll(".node-title")].some(e=>e.textContent==="Setup context")'));
await evaluate('document.querySelector(".graph-node.dimmed").click()');
await wait('document.querySelector("#transcripts").textContent.includes("Method question")');
assert.ok(await evaluate('document.querySelector("#transcripts").textContent.includes("Setup context")'));
await select([1]); await evaluate('document.querySelector("#dissolve").click()');
await wait('!document.querySelector("#dissolve")');
await select([0, 1, 2]); await combine('Set up writing style');
await select(Array.from({length:10},(_,i)=>i+4)); await combine('Explore method alternatives');
await select(Array.from({length:10},(_,i)=>i+14)); await combine('Plan the evaluation');
await screenshot('v3-organized-tree');
await evaluate('document.querySelector("#file-tree").click()');
await wait('document.querySelector("#dialog").open');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && !document.querySelector("#file-tree")');
await evaluate('document.querySelector("#back").click()');
await wait('!document.querySelector("#list-page").hidden');
assert.ok(await evaluate('document.querySelector(".list-group h2").textContent.includes("Chrono")'));
await evaluate('document.querySelector("[data-select]").click()');
assert.ok(await evaluate('!!document.querySelector("#deactivate-items") && !document.querySelector("#move-items")'));
await evaluate('document.querySelector("#deactivate-items").click()');
await wait('document.querySelectorAll(".session-row").length === 0');
await evaluate('[...document.querySelectorAll("[data-scope]")].find(e=>e.textContent.includes("Chrono")).click()');
await wait('document.querySelectorAll(".session-row").length >= 3');
await screenshot('v3-project-list');
await evaluate('[...document.querySelectorAll("[data-open]")].find(e=>e.textContent.includes("Introduction experiments")||e.textContent.includes("Method alternatives")).click()');
await wait('!document.querySelector("#detail-page").hidden');
await evaluate('document.querySelector(".graph-node.selected").click()');
await wait('document.querySelector("#toggle-active")');
assert.equal(await evaluate('document.querySelector("#toggle-active").textContent'), 'Activate');
await evaluate('document.querySelector("#toggle-active").click()');
await wait('document.querySelector("[name=cwd]")');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && document.querySelector("#toggle-active")?.textContent === "Deactivate"');
await evaluate('document.querySelector("#archive-tree").click()');
await wait('document.querySelector("#dialog").open');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && !!document.querySelector("#restore-session")');
await evaluate('document.querySelector("[data-scope=archived]").click()');
await wait('document.querySelectorAll(".session-row").length >= 1');
await screenshot('v3-archived-list');
await evaluate('[...document.querySelectorAll("[data-scope]")].find(e=>e.dataset.scope==="active:claude").click()');
await wait('document.querySelectorAll(".session-row").length === 1');
await evaluate('document.querySelector("[data-select]").click();document.querySelector("#archive-items").click()');
await wait('document.querySelector("#dialog").open');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && document.querySelectorAll(".session-row").length === 0');
await evaluate('document.querySelector("[data-scope=archived]").click()');
await wait('[...document.querySelectorAll(".session-row")].some(e=>e.textContent.includes("unrelated notes"))');
await evaluate('[...document.querySelectorAll(".session-row")].find(e=>e.textContent.includes("unrelated notes")).querySelector("[data-select]").click();document.querySelector("#restore-items").click()');
await wait('document.querySelector("#destination")');
await evaluate('document.querySelector("#destination").value="new";document.querySelector("#destination").dispatchEvent(new Event("change"));document.querySelector("[name=projectName]").value="Recovered notes";document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && [...document.querySelectorAll("[data-scope]")].some(e=>e.textContent.includes("Recovered notes"))');
assert.equal(await evaluate('[...document.querySelectorAll("[data-scope]")].find(e=>e.dataset.scope==="active:claude").querySelector(".count").textContent'), '0');

await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
assert.ok(await evaluate('document.body.scrollWidth <= 390'));
await screenshot('v3-mobile');
assert.deepEqual(errors, []);
console.log('Browser smoke passed: navigation/counts, language persistence, full-text search, branch paths, shared edits, Combine/Dissolve, move, scoped deactivate, activate, Archive, desktop/mobile.');
await call('Page.close'); ws.close();
