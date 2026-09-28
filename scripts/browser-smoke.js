// Requires a fresh Chrome profile started with --remote-debugging-port=9228.
import fs from 'node:fs';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:7421';
const debuggerBase = process.argv[3] || 'http://127.0.0.1:9228';
const page = await (await fetch(debuggerBase + '/json/new?' + base, { method: 'PUT' })).json();
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
await evaluate('localStorage.removeItem("grove-language")'); await call('Page.reload');
await wait('document.querySelectorAll(".session-row").length === 1');
assert.equal(await evaluate('document.documentElement.lang'), 'en');
assert.equal(await evaluate('document.querySelectorAll(".banner-actions button").length'), 3);
assert.equal(await evaluate('!!document.querySelector("#upload") || !!document.querySelector(".banner #language")'), false);
fs.mkdirSync('test-results', { recursive: true });
const screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('test-results/' + name + '.png', Buffer.from(result.data, 'base64')); };
await screenshot('v6-active-list');
const language = async value => {
    await evaluate('document.querySelector("#settings").click()'); await wait('document.querySelector("#language")');
    await evaluate('document.querySelector("#language").closest(".select-control").querySelector(".select-trigger").click()');
    await evaluate(`[...document.querySelector("#language").closest(".select-control").querySelectorAll(".select-option")].find(e=>e.textContent===${JSON.stringify(value === 'zh' ? '中文' : 'English')}).click()`);
    await wait(`document.documentElement.lang === ${JSON.stringify(value === 'zh' ? 'zh-CN' : 'en')} && !!document.querySelector("#download-diagnostics")`);
    await new Promise(r => setTimeout(r, 100));
    await evaluate('document.querySelector("#dialog-close").click()');
};
await language('zh'); await call('Page.reload'); await wait('document.querySelectorAll(".session-row").length === 1');
assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN'); await language('en');
await evaluate('document.querySelector("[data-open]").click()'); await wait('document.querySelectorAll(".graph-node").length === 3');
assert.equal(await evaluate('document.querySelector("#detail-actions").children.length'), 0);
assert.equal(await evaluate('!!document.querySelector("#context-info")'), false);
assert.ok(await evaluate('document.querySelector(".graph-node").getBoundingClientRect().height <= 81'));
assert.ok(await evaluate('document.querySelector("#branch-picker").closest(".select-control").getBoundingClientRect().width <= 215'));
await evaluate('document.querySelector("#zoom-in").click()');
assert.equal(await evaluate('document.querySelector("#zoom-label").textContent'), '115%');
await evaluate('document.querySelector("#graph-scroll").dispatchEvent(new WheelEvent("wheel",{deltaX:5000,cancelable:true}))');
await wait('document.querySelector("#ribbons").childElementCount === 0');
await evaluate('document.querySelector("#graph-reset").click()');
assert.equal(await evaluate('document.querySelector("#zoom-label").textContent'), '100%');
const box = await evaluate('(()=>{const r=document.querySelector("#graph-scroll").getBoundingClientRect();return{x:r.right-10,y:r.bottom-20}})()');
const originalTransform = await evaluate('document.querySelector("#graph").style.transform');
await call('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x,y:box.y,button:'left',clickCount:1});
await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:box.x-70,y:box.y-40,button:'left',buttons:1});
await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x-70,y:box.y-40,button:'left',clickCount:1});
assert.notEqual(await evaluate('document.querySelector("#graph").style.transform'), originalTransform);
await evaluate('document.querySelector("#graph-reset").click()');

await evaluate('{ const picker=document.querySelector("#branch-picker");picker.value=[...picker.options].find(o=>o.text.includes("Introduction")).value;picker.dispatchEvent(new Event("change")); }');
const selectRange = async (start, end) => {
    await evaluate(`document.querySelectorAll("[data-chat]")[${start}].click()`);
    assert.equal(await evaluate('!!document.querySelector("#combine")'), false);
    await evaluate(`document.querySelectorAll("[data-chat]")[${end}].click()`);
    assert.equal(await evaluate('document.querySelectorAll(".chat.checked").length'), Math.abs(end - start) + 1);
};
await selectRange(4, 13);
await evaluate('document.querySelector("#combine").click()'); await wait('document.querySelector("[name=name]")');
await evaluate('document.querySelector("[name=name]").value="Draft the introduction";document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && !document.querySelector("#combine")');
await evaluate('document.querySelector(".graph-node").click()');
assert.equal(await evaluate('!!document.querySelector("#archive-path")'), false);
await evaluate('document.querySelector("#rename-node").click()'); await wait('document.querySelector("[name=name]")');
await evaluate('document.querySelector("[name=name]").value="Set up research context";document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && [...document.querySelectorAll(".node-title")].some(e=>e.textContent==="Set up research context")');
await screenshot('v6-workspace');
await evaluate('[...document.querySelectorAll(".graph-node:not(.dimmed)")].at(-1).click()');
await wait('document.querySelector("#archive-path")');
await evaluate('document.querySelector("#archive-path").click()'); await wait('document.querySelector("#dialog").open');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && document.querySelector("#branch-picker").options.length === 1');
assert.ok(await evaluate('document.querySelector("#transcripts").textContent.includes("Method question")'));
assert.ok(await evaluate('!document.querySelector("#transcripts").textContent.includes("Intro question")'));
await screenshot('v6-in-use');
// Keep a slow in-use response in flight, then navigate to Archived. It must never
// restore the previous path picker under the new navigation category.
await evaluate('document.querySelector("#back").click();window.originalFetch=window.fetch;window.fetch=async (...args)=>{const r=await window.originalFetch(...args);if(String(args[0]).includes("/trees/")&&String(args[0]).includes("view=in-use"))await new Promise(done=>setTimeout(done,700));return r;};document.querySelector("[data-open]").click();document.querySelector("[data-scope=archived]").click()');
assert.equal(await evaluate('document.querySelector("#detail-page").hidden'), true);
await new Promise(r=>setTimeout(r,1000));
assert.equal(await evaluate('document.querySelector("#detail-page").hidden'), true);
await evaluate('window.fetch=window.originalFetch');

await evaluate('document.querySelector("[data-scope=archived]").click()');
await wait('[...document.querySelectorAll("[data-open]")].some(e=>e.textContent.includes("Introduction"))');
await evaluate('[...document.querySelectorAll("[data-open]")].find(e=>e.textContent.includes("Introduction")).click()');
await wait('!document.querySelector("#detail-page").hidden');
assert.equal(await evaluate('document.querySelector("#branch-picker").options.length'), 1);
assert.ok(await evaluate('document.querySelector("#transcripts").textContent.includes("Establish the Chrono")'));
assert.ok(await evaluate('!document.querySelector("#transcripts").textContent.includes("Method question")'));
assert.equal(await evaluate('document.querySelectorAll("[data-chat]").length'), 0);
await screenshot('v6-archived-path');
await evaluate('[...document.querySelectorAll(".graph-node")].at(-1).click()');
assert.equal(await evaluate('!!document.querySelector("#rename-node") || !!document.querySelector("#fork")'), false);
await evaluate('document.querySelector("#restore-session").click()'); await wait('document.querySelector("#destination")');
await evaluate('document.querySelector("#dialog-form").requestSubmit()'); await wait('!document.querySelector("#dialog").open && document.querySelector("#detail-page").hidden');
await evaluate('[...document.querySelectorAll("[data-scope]")].find(e=>e.textContent.includes("Chrono")).click()');
await wait('document.querySelectorAll(".session-row").length >= 3');
await evaluate('[...document.querySelectorAll("[data-open]")].find(e=>e.textContent.includes("Introduction")||e.textContent.includes("Method alternatives")).click()');
await wait('!document.querySelector("#detail-page").hidden');
assert.equal(await evaluate('document.querySelector("#branch-picker").options.length'), 2);
await evaluate('{const p=document.querySelector("#branch-picker");p.value=[...p.options].find(o=>o.text.includes("Introduction")).value;p.dispatchEvent(new Event("change"));}');
await evaluate('[...document.querySelectorAll(".graph-node:not(.dimmed)")].at(-1).click()');
assert.equal(await evaluate('document.querySelector("#toggle-active").textContent'), 'Activate');
await evaluate('document.querySelector("#toggle-active").click()'); await wait('document.querySelector("#activation-budget")?.textContent.length > 0');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && document.querySelector("#toggle-active")?.textContent === "Deactivate"');
await evaluate('document.querySelector("#back").click()');
await evaluate('[...document.querySelectorAll("[data-open]")].find(e=>e.textContent.includes("Research context")).click()');
await wait('!document.querySelector("#detail-page").hidden');
await evaluate('{const p=document.querySelector("#branch-picker");p.value=[...p.options].find(o=>o.text.includes("Temporal representation")).value;p.dispatchEvent(new Event("change"));}');
await wait('document.querySelector(".compaction-edge button")');
assert.ok(await evaluate('document.querySelectorAll(".graph-node.context-muted").length > 0'));
await evaluate('document.querySelector(".compaction-edge button").click()');
await wait('document.querySelector(".compaction-edge button")?.getAttribute("aria-pressed") === "false"');
assert.equal(await evaluate('document.querySelectorAll(".graph-node.context-muted").length'), 0);
await evaluate('[...document.querySelectorAll(".graph-node:not(.dimmed)")].at(-1).click();document.querySelector("#toggle-active").click()');
await wait('document.querySelector("#activation-budget")?.textContent.length > 0');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && document.querySelector("#toggle-active")?.textContent === "Deactivate"');
await evaluate('document.querySelector(".compaction-edge button").click()');
await wait('document.querySelector("#apply-context")');
assert.ok(await evaluate('document.querySelectorAll(".graph-node.context-muted").length > 0'));
await screenshot('v6-compaction');
await evaluate('document.querySelector("#apply-context").click()');
await wait('document.querySelector("#activation-budget")?.textContent.length > 0');
await evaluate('document.querySelector("#dialog-form").requestSubmit()');
await wait('!document.querySelector("#dialog").open && !document.querySelector("#apply-context")');
await evaluate('document.querySelector("#settings").click()'); await wait('document.querySelector("#download-diagnostics")');
await screenshot('v6-settings'); await evaluate('document.querySelector("#dialog-close").click()');
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
assert.ok(await evaluate('document.body.scrollWidth <= 390'));
await screenshot('v6-mobile'); assert.deepEqual(errors, []);
console.log('Browser smoke passed: styled selectors, zoom/pan/reset, clipped ribbons, stale-view rejection, compaction toggle/apply, contiguous ranges, Pending rename, endpoint archive, isolated archived paths, restore, activation preflight, diagnostics entry, narrow layout.');
await call('Page.close'); ws.close();
