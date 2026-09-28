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
import { codexSample, codexTurn } from '../src/demo.js';
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
    const b = app.store.branch(null, 'First branch', 'codex', codexSample(cwd, [['Context', 'Ready']]));
    const moved = await call('/projects', { name: 'HTTP project', itemIds: [b.id] });
    assert.ok(moved.projectId);
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
    const tree = a.treeGraph(branch.id);
    a.organize(branch.id, { version: tree.version, pathId: branch.id, chatIds: tree.paths[0].messages.map(m => m.id), action: 'combine', name: 'Encrypted logical node' });
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
    assert.equal(b.treeGraph(branch.id).nodes[0].name, 'Encrypted logical node');
    assert.equal((await sync(b, config, key, 'pull')).pulled, 0);
    await assert.rejects(sync(b, config, 'a-different-password', 'pull'), /解密/);
    a.fork(branch.id, { name: 'Child', end: a.detail(branch.id).checkpoints[0].end });
    assert.equal((await sync(a, config, key, 'push')).uploaded, 0);
    await sync(b, config, key, 'pull');
    assert.equal(b.all('branch').length, 2);
});
test('workspace HTTP actions archive atomically, restore without activation, reject empty projects, and persist layout conflict choices', async t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-actions-'))), cwd = path.join(root, 'work'); fs.mkdirSync(cwd);
    let busy = false;
    const app = createApp({ root: path.join(root, 'data'), roots: { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') }, guard: () => { if (busy) throw new Error('native busy'); } });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    t.after(async () => { app.server.close(); await once(app.server, 'close'); fs.rmSync(root, { force: true, recursive: true }); });
    const base = `http://127.0.0.1:${app.server.address().port}`, boot = await (await fetch(base + '/api/bootstrap')).json();
    const request = async (path, data) => { const r = await fetch(base + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Grove-Token': boot.token }, body: JSON.stringify(data) }); return { status: r.status, data: await r.json() }; };
    assert.equal((await request('/projects', { name: 'Empty' })).status, 400);
    assert.equal((await request('/branches', { name: 'Blank', agent: 'codex' })).status, 400);
    assert.equal(app.store.all('project').length, 0);
    const a = app.store.branch(null, 'Main', 'codex', codexSample(cwd, [['Start', 'Ready'], ['Continue', 'Done']]));
    const child = app.store.fork(a.id, { name: 'Child', end: app.store.detail(a.id).checkpoints[0].end });
    const moved = await request('/move', { itemIds: [child.id], projectName: 'Chrono' }); assert.equal(moved.status, 200);
    const projectId = moved.data.projectId;
    assert.equal((await request('/manage', { action: 'activate', branchIds: [a.id], cwd })).status, 200);
    app.autoSync.queue.clear(); app.store.local('uploadQueue', []);
    fs.appendFileSync(app.store.instances()[0].file, codexTurn('Still chatting', 'New pending work').map(v => JSON.stringify(v) + '\n').join(''));
    assert.equal((await request('/collect', {})).status, 200);
    assert.equal(app.autoSync.queue.size, 0, 'native capture must not enqueue uploads');
    const pendingGraph = app.store.treeGraph(a.id);
    assert.equal((await request('/trees/' + a.id, { version: pendingGraph.version, pathId: a.id, chatIds: [pendingGraph.paths.find(p => p.branchId === a.id).messages.at(-1).id], action: 'combine', name: 'A finished step' })).status, 200);
    assert.ok(app.autoSync.queue.has(a.id), 'organizing must enqueue the changed tree');
    busy = true;
    assert.equal((await request('/manage', { action: 'archive', projectId })).status, 400);
    assert.equal(app.store.get('project', projectId).archived, undefined);
    assert.equal(app.store.get('branch', a.id).archived, false);
    assert.equal(app.store.instances()[0].desired, true); assert.equal(app.store.instances()[0].applied, true);
    busy = false;
    assert.equal((await request('/manage', { action: 'archive', projectId })).status, 200);
    assert.ok(app.store.all('branch').every(b => b.archived)); assert.equal(app.store.get('project', projectId).archived, true);
    assert.equal(app.store.collections().activeCounts.codex, 0);
    assert.equal(app.store.listing('archived').itemCount, 1);
    assert.equal((await request('/manage', { action: 'restore', projectId })).status, 200);
    assert.ok(app.store.all('branch').every(b => !b.archived)); assert.equal(app.store.collections().activeCounts.codex, 0);
    const g = app.store.treeGraph(a.id), body = { version: g.version, pathId: a.id, chatIds: [g.paths[0].messages[0].id], action: 'combine', name: 'Setup' };
    assert.equal((await request('/trees/' + a.id, body)).status, 200);
    assert.equal((await request('/trees/' + a.id, body)).status, 409);
    const remote = new Store(path.join(root, 'remote'));
    t.after(() => remote.close());
    const copy = (from, to) => to.merge(from.exportGraph(), Object.fromEntries(from.db.prepare('SELECT * FROM objects').all().map(v => [v.hash, v.body])));
    copy(app.store, remote);
    for (const [store, name] of [[app.store, 'Local'], [remote, 'Remote']]) {
        const tree = store.treeGraph(a.id);
        store.organize(a.id, { ...body, version: tree.version, name });
    }
    copy(remote, app.store);
    assert.equal(app.store.local('conflicts')[0].kind, 'layout');
    assert.equal((await request('/conflicts/resolve', { index: 0, choice: 'local' })).status, 200);
    assert.equal(copy(app.store, remote).conflicts, 0);
    assert.equal(copy(remote, app.store).conflicts, 0);
    assert.equal(remote.treeGraph(a.id).nodes[0].name, 'Local');
    const unfiled = app.store.branch(null, 'Loose archive', 'claude');
    app.store.edit(unfiled.id, { archived: true });
    assert.equal((await request('/manage', { action: 'restore', itemIds: [unfiled.id] })).status, 400);
    assert.equal(app.store.get('branch', unfiled.id).archived, true);
    const count = app.store.all('project').length;
    assert.equal((await request('/manage', { action: 'restore', itemIds: [unfiled.id], projectName: 'Recovered notes' })).status, 200);
    assert.equal(app.store.all('project').length, count + 1);
    const restored = app.store.get('branch', unfiled.id);
    assert.equal(restored.archived, false); assert.ok(restored.projectId);
    assert.equal(app.store.collections().activeCounts.claude, 0);

});
