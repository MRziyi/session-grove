import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { Cloud } from '../src/cloud.js';
import { AutoSync } from '../src/auto-sync.js';
import { codexSample, codexTurn } from '../src/demo.js';
import { hash } from '../src/util.js';
async function setup(t) {
    const files = new Map(), requests = []; let failHead = false;
    const server = http.createServer(async (req, res) => {
        const key = decodeURIComponent(req.url), chunks = []; requests.push([req.method, key]);
        for await (const c of req) chunks.push(c);
        if (req.method === 'MKCOL') { res.writeHead(201); return res.end(); }
        if (req.method === 'PUT') {
            if (failHead && key.includes('/heads/')) { res.writeHead(503); return res.end(); }
            if (req.headers['if-none-match'] === '*' && files.has(key)) { res.writeHead(412); return res.end(); }
            files.set(key, Buffer.concat(chunks)); res.writeHead(201); return res.end();
        }
        if (req.method === 'PROPFIND') { res.writeHead(207); return res.end(`<D:multistatus xmlns:D="DAV:">${[...files.keys()].filter(k => k.startsWith(key)).map(k => `<D:response><D:href>${k}</D:href></D:response>`).join('')}</D:multistatus>`); }
        if (files.has(key)) {
            const etag = '"' + hash(files.get(key)) + '"';
            if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
            res.writeHead(200, { ETag: etag }); return res.end(req.method === 'HEAD' ? undefined : files.get(key));
        }
        res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-catalog-'))), stores = [];
    t.after(async () => { stores.forEach(s => s.close()); server.close(); await once(server, 'close'); fs.rmSync(root, { force: true, recursive: true }); });
    const config = { url: `http://127.0.0.1:${server.address().port}/dav` }, pass = 'isolated-test-passphrase';
    const device = name => { const store = new Store(path.join(root, name)); stores.push(store); return { store, cloud: new Cloud(store, () => config) }; };
    return { device, config, pass, files, requests, failPublication: value => failHead = value };
}
function branch(store, projectId, title, secret = title) { return store.branch(projectId, title, 'codex', codexSample('/work', [[secret, 'Ready']])); }
function append(store, b, text) { const current = store.get('branch', b.id); return store.ingest(b.id, store.raw(current.head) + codexTurn(text, 'Done').map(v => JSON.stringify(v) + '\n').join(''), current.head, {}); }
function organize(store, b, title) { const g = store.treeGraph(b.id); store.organize(b.id, { version: g.version, pathId: b.id, chatIds: [g.paths[0].messages.at(-1).id], action: 'combine', name: title }); }
test('directory → project index → one tree fetches transcripts strictly on demand and encrypts all layers', async t => {
    const env = await setup(t), { pass, requests, files } = env, a = env.device('a'), b = env.device('b');
    const p = a.store.project('Paper'), q = a.store.project('Unopened');
    const first = branch(a.store, p.id, 'First', 'first private text'), second = branch(a.store, p.id, 'Second', 'second private text'), third = branch(a.store, q.id, 'Third', 'third private text');
    await a.cloud.publish([first.id, second.id, third.id], pass);
    for (const [key, bytes] of files) if (key.endsWith('.bin')) assert.ok(!bytes.toString().includes('private text') && !bytes.toString().includes('Paper'));
    requests.length = 0; await b.cloud.catalog(pass);
    assert.equal(b.store.all('branch').length, 0); assert.equal(b.cloud.summaries().length, 2);
    assert.ok(!requests.some(([m, p]) => m === 'GET' && /\/(objects|trees|projects)\//.test(p)));
    requests.length = 0; await b.cloud.project(p.id, pass);
    assert.equal(b.cloud.listing(p.id).items.length, 2); assert.equal(b.store.all('branch').length, 0);
    assert.ok(!requests.some(([m, p]) => m === 'GET' && /\/(objects|trees)\//.test(p)));
    await b.cloud.hydrate(first.id, pass);
    assert.deepEqual(b.store.all('branch').map(b => b.id), [first.id]); assert.equal(b.store.instances().length, 0);
    assert.deepEqual(b.cloud.dirtyIds(), []);
    assert.equal(b.cloud.items().find(i => i.id === second.id).cloudState, 'cloud');
    assert.equal(b.cloud.items().find(i => i.id === first.id).cloudState, 'cached');
    assert.equal(b.store.db.prepare('SELECT COUNT(*) AS n FROM objects WHERE body LIKE ?').get('%second private text%').n, 0);
});
test('Pending growth does not auto-upload; organization queues a snapshot, manual push includes remaining Pending, no-op push writes nothing', async t => {
    const env = await setup(t), { pass, config, requests } = env, a = env.device('a');
    const p = a.store.project('Paper'), b = branch(a.store, p.id, 'Main');
    const auto = new AutoSync(a.store, () => config); t.after(() => auto.close()); auto.unlock(pass);
    auto.schedule([b.id]); await auto.flush(); assert.equal(auto.status().dirty, false); assert.ok(auto.status().lastUpload);
    append(a.store, b, 'New unfinished organization'); requests.length = 0;
    await auto.flush('pull'); await auto.flush();
    assert.equal(auto.status().phase, 'local'); assert.equal(requests.filter(([m]) => m === 'PUT').length, 0);
    organize(a.store, b, 'Save one chat'); auto.schedule([b.id]); await auto.flush();
    assert.equal(auto.status().dirty, false); assert.ok(a.store.treeGraph(b.id).pendingCount > 0);
    append(a.store, b, 'More Pending'); await auto.flush('push'); assert.equal(auto.status().dirty, false);
    requests.length = 0; await auto.flush('push'); assert.equal(requests.filter(([m]) => m === 'PUT').length, 0);
});
test('publishing a cached tree preserves other cloud-only items without downloading them', async t => {
    const env = await setup(t), { pass, requests } = env, a = env.device('a'), b = env.device('b'), c = env.device('c');
    const p = a.store.project('Shared'), first = branch(a.store, p.id, 'First'), second = branch(a.store, p.id, 'Second');
    await a.cloud.publish([first.id, second.id], pass); await b.cloud.catalog(pass); await b.cloud.project(p.id, pass); await b.cloud.hydrate(first.id, pass);
    requests.length = 0; organize(b.store, first, 'Edited on B'); await b.cloud.publish([first.id], pass);
    assert.equal(b.store.all('branch').length, 1); assert.ok(!requests.some(([m, p]) => m === 'GET' && p.includes('/objects/')));
    await c.cloud.catalog(pass); assert.equal(c.cloud.summaries()[0].count, 2);
    await c.cloud.project(p.id, pass); assert.equal(c.cloud.items().length, 2);
    await c.cloud.hydrate(first.id, pass); assert.ok(c.store.treeGraph(first.id).nodes.some(n => n.name === 'Edited on B'));
});
test('publication failure leaves previous directory readable and retries without acknowledging unsent changes', async t => {
    const env = await setup(t), { pass } = env, a = env.device('a'), b = env.device('b');
    const p = a.store.project('P'), first = branch(a.store, p.id, 'First');
    await a.cloud.publish([first.id], pass); const uploaded = a.cloud.cache().lastUpload;
    append(a.store, first, 'Unpublished suffix'); env.failPublication(true);
    await assert.rejects(a.cloud.publish([first.id], pass), /503/);
    assert.equal(a.cloud.cache().lastUpload, uploaded); assert.deepEqual(a.cloud.dirtyIds(), [first.id]);
    await b.cloud.catalog(pass); await b.cloud.project(p.id, pass); await b.cloud.hydrate(first.id, pass);
    assert.equal(b.store.treeGraph(first.id).chatCount, 2);
    env.failPublication(false); await a.cloud.publish([first.id], pass);
    await b.cloud.catalog(pass); await b.cloud.project(p.id, pass);
    assert.equal(b.cloud.items()[0].cloudState, 'update'); await b.cloud.hydrate(first.id, pass);
    assert.equal(b.store.treeGraph(first.id).chatCount, 4);
});
test('a moved tree is removed from its old project index instead of resurrecting from an older device head', async t => {
    const env = await setup(t), { pass } = env, a = env.device('a'), b = env.device('b'), c = env.device('c');
    const p = a.store.project('Old'), item = branch(a.store, p.id, 'Moving');
    await a.cloud.publish([item.id], pass); await b.cloud.catalog(pass); await b.cloud.project(p.id, pass); await b.cloud.hydrate(item.id, pass);
    organize(b.store, item, 'An edit'); await b.cloud.publish([item.id], pass);
    const q = b.store.moveItems({ itemIds: [item.id], projectName: 'New' }); await b.cloud.publish([item.id], pass);
    await c.cloud.catalog(pass); await c.cloud.project(p.id, pass); await c.cloud.project(q.projectId, pass);
    assert.equal(c.cloud.listing(p.id).items.length, 0); assert.equal(c.cloud.listing(q.projectId).items.length, 1);
});
test('concurrent device heads retain independently added trees and expose their union in the small directory', async t => {
    const env = await setup(t), { pass } = env, a = env.device('a'), b = env.device('b'), c = env.device('c');
    const p = a.store.project('Shared'), original = branch(a.store, p.id, 'Original');
    await a.cloud.publish([original.id], pass); await b.cloud.catalog(pass); await b.cloud.project(p.id, pass); await b.cloud.hydrate(original.id, pass);
    const addedA = branch(a.store, p.id, 'Added A'), addedB = branch(b.store, p.id, 'Added B');
    await Promise.all([a.cloud.publish([addedA.id], pass), b.cloud.publish([addedB.id], pass)]);
    await c.cloud.catalog(pass); assert.equal(c.cloud.summaries()[0].count, 3);
    await c.cloud.project(p.id, pass); assert.equal(c.cloud.items().length, 3);
});
test('legacy manifests are indexed without raw downloads and remain reachable after publishing the new directory', async t => {
    const env = await setup(t), { pass, config, requests } = env, a = env.device('a'), b = env.device('b'), c = env.device('c');
    const { sync } = await import('../src/sync.js');
    const p = a.store.project('Legacy A'), q = a.store.project('Legacy B'), first = branch(a.store, p.id, 'First'), other = branch(a.store, q.id, 'Other');
    await sync(a.store, config, pass, 'push'); requests.length = 0;
    await b.cloud.catalog(pass); assert.equal(b.cloud.summaries().length, 2);
    assert.ok(!requests.some(([m, p]) => m === 'GET' && p.includes('/objects/')));
    await b.cloud.project(p.id, pass); await b.cloud.hydrate(first.id, pass);
    organize(b.store, first, 'Migrated'); await b.cloud.publish([first.id], pass);
    await c.cloud.catalog(pass); assert.equal(c.cloud.summaries().length, 2);
    await c.cloud.project(q.id, pass); await c.cloud.hydrate(other.id, pass);
    assert.equal(c.store.treeGraph(other.id).chatCount, 2);
});
test('remote archives update cached list projections without fetching bodies or flagging a local upload', async t => {
    const env = await setup(t), { pass, requests } = env, a = env.device('a'), b = env.device('b');
    const p = a.store.project('Archive'), item = branch(a.store, p.id, 'History');
    await a.cloud.publish([item.id], pass); await b.cloud.catalog(pass); await b.cloud.project(p.id, pass); await b.cloud.hydrate(item.id, pass);
    a.store.edit(item.id, { archived: true }); await a.cloud.publish([item.id], pass); requests.length = 0;
    await b.cloud.catalog(pass); await b.cloud.project(p.id, pass);
    assert.equal(b.cloud.listing(p.id).itemCount, 0); assert.equal(b.cloud.listing('archived').itemCount, 1);
    assert.deepEqual(b.cloud.dirtyIds(), []); assert.ok(!requests.some(([m, p]) => m === 'GET' && /\/(trees|objects)\//.test(p)));
});
