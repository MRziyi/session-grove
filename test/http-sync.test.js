import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { sync } from '../src/sync.js';
import { codexSample } from '../src/demo.js';
test('HTTP protects local API and implements project to activation lifecycle', async (t) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-http-'))), cwd = path.join(root, 'work');
    fs.mkdirSync(cwd);
    const app = createApp({ root: path.join(root, 'data'), roots: { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') }, guard: () => { } });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    t.after(async () => { app.server.close(); await once(app.server, 'close'); fs.rmSync(root, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const boot = await (await fetch(base + '/api/bootstrap')).json();
    assert.equal(boot.projects.length, 0);
    assert.equal((await fetch(base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/api/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => http.get(base + '/api/bootstrap', { headers: { Host: 'evil.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject));
    assert.equal(hostStatus, 403);
    const call = async (route, body, method = 'POST') => { const r = await fetch(base + '/api' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Grove-Token': boot.token }, body: JSON.stringify(body) }); const result = await r.json(); assert.ok(r.ok, JSON.stringify(result)); return result; };
    const project = await call('/projects', { name: 'HTTP project' }), b = await call('/branches', { projectId: project.id, name: 'First branch', agent: 'codex' });
    await call('/branches/' + b.id + '/active', { cwd, desired: true });
    assert.equal((await call('/apply', {})).applied, 1);
    await call('/branches/' + b.id, { archived: true }, 'PATCH');
    assert.equal((await call('/apply', {})).applied, 1);
    assert.equal(app.store.instances()[0].applied, false);
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('encrypted WebDAV push/pull is idempotent, preserves no Active state, rejects wrong key', async (t) => {
    const files = new Map();
    let puts = 0;
    const server = http.createServer(async (req, res) => {
        const key = decodeURIComponent(req.url);
        const chunks = [];
        for await (const c of req)
            chunks.push(c);
        if (req.method === 'MKCOL') {
            res.writeHead(201);
            return res.end();
        }
        if (req.method === 'PUT') {
            if (req.headers['if-none-match'] === '*' && files.has(key)) {
                res.writeHead(412);
                return res.end();
            }
            files.set(key, Buffer.concat(chunks));
            puts++;
            res.writeHead(201);
            return res.end();
        }
        if (req.method === 'PROPFIND') {
            res.writeHead(207, { 'Content-Type': 'application/xml' });
            return res.end(`<D:multistatus xmlns:D="DAV:">${[...files.keys()].filter(k => k.includes('/commits/')).map(k => `<D:response><D:href>${k}</D:href></D:response>`).join('')}</D:multistatus>`);
        }
        if (files.has(key)) {
            res.writeHead(200);
            return res.end(req.method === 'HEAD' ? undefined : files.get(key));
        }
        res.writeHead(404);
        res.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sync-'))), a = new Store(path.join(root, 'a')), b = new Store(path.join(root, 'b'));
    t.after(async () => { a.close(); b.close(); server.close(); await once(server, 'close'); fs.rmSync(root, { recursive: true, force: true }); });
    const config = { url: `http://127.0.0.1:${server.address().port}/dav`, username: 'u', password: 'p' }, key = 'correct-horse-context';
    const project = a.project('Chrono'), branch = a.branch(project.id, 'Main', 'codex', codexSample('/work', [['private text', 'private answer']]));
    const first = await sync(a, config, key, 'push');
    assert.ok(first.uploaded > 0);
    for (const [name, body] of files)
        if (name.endsWith('.bin'))
            assert.ok(!body.toString().includes('private text'));
    const count = puts;
    await sync(a, config, key, 'push');
    assert.equal(puts, count);
    assert.equal((await sync(b, config, key, 'pull')).pulled, 1);
    assert.equal(b.raw(b.get('branch', branch.id).head), a.raw(branch.head));
    assert.equal(b.instances().length, 0);
    assert.equal((await sync(b, config, key, 'pull')).pulled, 0);
    await assert.rejects(sync(b, config, 'a-different-password', 'pull'), /解密/);
    a.fork(branch.id, { name: 'Child', end: a.detail(branch.id).checkpoints[0].end });
    assert.equal((await sync(a, config, key, 'push')).uploaded, 0);
    await sync(b, config, key, 'pull');
    assert.equal(b.all('branch').length, 2);
});
