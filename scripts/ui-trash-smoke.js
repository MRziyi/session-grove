import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { codexSample } from '../src/demo.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-ui-trash-')),
    files = new Map();
let locked = false;
const dav = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const key = req.url,
        send = (s, b = '') => {
            res.writeHead(s);
            res.end(b);
        };
    if (req.method === 'LOCK') {
        if (locked && !req.headers.if) return send(423);
        locked = true;
        res.writeHead(200, { 'Lock-Token': '<opaquelocktoken:fixture>' });
        return res.end();
    }
    if (req.method === 'UNLOCK') {
        locked = false;
        return send(204);
    }
    if (
        !['GET', 'HEAD', 'PROPFIND'].includes(req.method) &&
        locked &&
        !req.headers.if?.includes('(<opaquelocktoken:fixture>)')
    )
        return send(423);
    if (req.method === 'MKCOL') return send(201);
    if (req.method === 'PUT') {
        if (req.headers['if-none-match'] === '*' && files.has(key)) return send(412);
        files.set(key, Buffer.concat(chunks));
        return send(201);
    }
    if (req.method === 'DELETE') {
        for (const k of files.keys())
            if (k === key || (key.endsWith('/') && k.startsWith(key))) files.delete(k);
        return send(204);
    }
    if (req.method === 'PROPFIND')
        return send(
            207,
            '<d:multistatus xmlns:d="DAV:">' +
                [...files.keys()]
                    .filter((k) => k.startsWith(key) && !k.slice(key.length).includes('/'))
                    .map((k) => '<d:response><d:href>' + k + '</d:href></d:response>')
                    .join('') +
                '</d:multistatus>',
        );
    return files.has(key) ? send(200, files.get(key)) : send(404);
});
dav.listen(0, '127.0.0.1');
await once(dav, 'listening');
fs.writeFileSync(
    path.join(root, 'webdav.json'),
    JSON.stringify({
        url: 'http://127.0.0.1:' + dav.address().port + '/dav',
        verified: true,
        encryptionReady: true,
        encrypted: false,
    }),
    { mode: 0o600 },
);
fs.writeFileSync(path.join(root, 'sync-key.txt'), '\n', { mode: 0o600 });
const app = createApp({
    root,
    roots: { codex: path.join(root, 'native/codex'), claude: path.join(root, 'native/claude') },
    guard: () => {},
    demo: true,
});
const project = app.store.project('Kept work'),
    parent = app.store.branch(
        project.id,
        'Failed path',
        'codex',
        codexSample(root, [
            ['Shared prefix', 'Keep'],
            ['Discarded suffix', 'Wrong result'],
        ]),
    );
const child = app.store.fork(parent.id, {
    name: 'Kept path',
    end: app.store.detail(parent.id).checkpoints[0].end,
});
const archive = app.store.branch(
    project.id,
    'Previous archive',
    'codex',
    codexSample(root, [['Old reference', 'Keep this']]),
);
app.store.edit(archive.id, { archived: true });
app.native.setActive(parent.id, root, true);
app.native.apply([parent.id]);
await app.autoSync.flush('both', true);
app.autoSync.cloud.saveDirectory();
app.store.local('localUpdateStarted', false);
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const base = 'http://127.0.0.1:' + app.server.address().port,
    debug = process.argv[2] || 'http://127.0.0.1:9250',
    page = await (await fetch(debug + '/json/new?' + base, { method: 'PUT' })).json(),
    ws = new WebSocket(page.webSocketDebuggerUrl);
await once(ws, 'open');
let serial = 0;
const pending = new Map(),
    errors = [];
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(m.error) : p.resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown')
        errors.push(
            m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text,
        );
};
const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
    });
const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (r.exceptionDetails)
        throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
};
async function wait(expression) {
    for (let i = 0; i < 400; i++) {
        if (await evaluate(expression)) return;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Timed out: ' + expression);
}
try {
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', {
        width: 1512,
        height: 982,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await wait('document.querySelector("[data-scope=trash]")');
    await evaluate('document.querySelector("#settings").click()');
    await wait('document.querySelector("[name=trashRetentionDays]")');
    assert.equal(await evaluate('document.querySelector("[name=trashRetentionDays]").value'), '30');
    await evaluate(
        'document.querySelector("[name=trashRetentionDays]").value="7";document.querySelector("[name=trashRetentionDays]").dispatchEvent(new Event("change"))',
    );
    await wait('document.querySelector("[name=trashRetentionDays]").value==="7"');
    await evaluate('document.querySelector("#dialog-close").click()');
    await evaluate(`document.querySelector('[data-scope="${project.id}"]').click()`);
    await wait('document.querySelector("[data-open]")');
    await evaluate('document.querySelector("[data-open]").click()');
    await wait('document.querySelectorAll(".graph-node").length===3');
    await evaluate(
        '[...document.querySelectorAll(".graph-node")].find(e=>e.textContent.includes("Pending 2.1")).click();document.querySelector("#archive-path").click()',
    );
    await wait('document.querySelector("#dialog").open');
    assert.ok(
        await evaluate('document.querySelector("#dialog-content").textContent.includes("7 days")'),
    );
    await evaluate('document.querySelector("#dialog-form").requestSubmit()');
    await wait('!document.querySelector("#dialog").open');
    await evaluate('document.querySelector("[data-scope=trash]").click()');
    await wait('document.querySelector("[data-trash-restore]")');
    assert.ok(
        await evaluate(
            'document.querySelector("#session-list").textContent.includes("Waiting for Sync")',
        ),
    );
    assert.ok(app.store.get('branch', archive.id).archived);
    assert.equal(app.store.treeGraph(parent.id, 'in-use').paths.length, 1);
    await evaluate('document.querySelector("[data-trash-native]").click()');
    await wait('!document.querySelector("[data-trash-native]")');
    await evaluate('document.querySelector("#sync").click()');
    await wait(
        'document.querySelector("#session-list").textContent.includes("Cloud space reclaimed")',
    );
    assert.ok(
        !app.store.db.prepare("SELECT 1 FROM objects WHERE body LIKE '%Discarded suffix%'").get(),
    );
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/trash-ui.png', Buffer.from(shot.data, 'base64'));
    await evaluate('document.querySelector("[data-trash-restore]").click()');
    await wait('document.querySelector("#list-title").textContent==="Projects"');
    assert.ok(
        app.store
            .all('branch')
            .some(
                (b) => b.name === 'Failed path' && b.id !== parent.id && !app.store.isTrashed(b.id),
            ),
    );
    assert.ok(!app.store.instances().some((i) => i.applied));
    await evaluate('document.querySelector("[data-scope=archived]").click()');
    await wait('document.querySelector("[data-select]")');
    await evaluate('document.querySelector("[data-select]").click()');
    assert.ok(
        await evaluate('document.querySelector("#archive-items").textContent.includes("Trash")'),
    );
    assert.equal(app.store.isTrashed(archive.id), false);
    assert.deepEqual(errors, []);
    console.log(
        'Trash UI passed: retention setting, explicit path discard, native cleanup, real sync/reclamation, recovery to Projects without activation, and unchanged previous archives.',
    );
} finally {
    await fetch(debug + '/json/close/' + page.id);
    ws.close();
    app.server.closeAllConnections();
    await new Promise((r) => app.close(r));
    dav.close();
    await once(dav, 'close');
    fs.rmSync(root, { recursive: true, force: true });
}
