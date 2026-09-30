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
import { savePreferences } from '../src/preferences.js';
import { seal } from '../src/sync.js';
async function setup(t) {
    const files = new Map(), requests = []; let failHead = false, intercept = null;
    const server = http.createServer(async (req, res) => {
        const key = decodeURIComponent(req.url), chunks = []; requests.push([req.method, key]);
        for await (const c of req) chunks.push(c);
        if (intercept && await intercept(req, res)) return;
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
    return { device, config, pass, files, requests, failPublication: value => failHead = value, intercept: fn => { intercept = fn; } };
}
function branch(store, projectId, title, secret = title) { return store.branch(projectId, title, 'codex', codexSample('/work', [[secret, 'Ready']])); }
function append(store, b, text) { const current = store.get('branch', b.id); return store.ingest(b.id, store.raw(current.head) + codexTurn(text, 'Done').map(v => JSON.stringify(v) + '\n').join(''), current.head, {}); }
function organize(store, b, title) { const g = store.treeGraph(b.id); store.organize(b.id, { version: g.version, pathId: b.id, chatIds: [g.paths[0].messages.at(-1).id], action: 'combine', name: title }); }
test('failed cleanup requires manual retry and its reason survives checks and restart', async t => {
    const e = await setup(t), a = e.device('cleanup-failure'), auto = new AutoSync(a.store, () => e.config);
    t.after(() => auto.close());
    await assert.rejects(auto.exclusive(async () => { auto.progress({ phase: 'Uploading records', completed: 12, total: 100 }); throw Object.assign(new Error('Test write lock expired'), { requiresReview: true }); }), /lock expired/);
    assert.equal(auto.status().needsReview.cleanup, true); assert.equal(auto.status().nextRunAt, null); assert.equal(auto.retryTimer, undefined);
    await auto.exclusive(async () => ({ checked: true }));
    assert.match(auto.status().error, /lock expired/);
    assert.equal(auto.status().lastFailure.progress.phase, 'Uploading records');
    const restarted = new AutoSync(a.store, () => e.config); t.after(() => restarted.close());
    assert.equal(restarted.status().needsReview.cleanup, true); assert.match(restarted.status().error, /lock expired/);
});
test('rename during download remains dirty and is not acknowledged as cloud content', async t => {
    const e = await setup(t), a = e.device('rename-source'), b = e.device('rename-target');
    const session = branch(a.store, null, 'Original');
    await a.cloud.publish([session.id], e.pass);
    await b.cloud.catalog(e.pass); for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    await b.cloud.hydrate(session.id, e.pass);
    append(a.store, session, 'Remote continuation'); await a.cloud.publish([session.id], e.pass);
    await b.cloud.catalog(e.pass); for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    const { dav } = await b.cloud.connect(e.pass), get = dav.get.bind(dav);
    let edited = false;
    dav.get = async (...args) => { const value = await get(...args); if (!edited && args[0].startsWith('trees/')) { edited = true; b.store.edit(session.id, { name: 'Local rename' }); } return value; };
    await b.cloud.hydrate(session.id, e.pass);
    assert.equal(b.store.get('branch', session.id).name, 'Local rename');
    assert.ok(b.cloud.dirtyIds().includes(session.id));
    assert.ok(b.store.detail(session.id).messages.some(m => m.text === 'Remote continuation'));
    await b.cloud.publish([session.id], e.pass); assert.equal(b.cloud.dirtyIds().length, 0);
});
test('a successful background check cannot erase a failed manual sync result',async t=>{
 const e=await setup(t),a=e.device('a'),auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);const p=a.store.project('Failure');branch(a.store,p.id,'Data');const plan=await auto.prepareSync();
 a.cloud.publish=async()=>{throw Error('simulated transfer timeout');};auto.cloud.publish=a.cloud.publish;const job=auto.startSync(plan.id,true);await assert.rejects(auto.syncJob,/timeout/);
 await auto.exclusive(async()=>({checked:true}));const status=auto.status();assert.equal(status.operation.id,job.operationId);assert.equal(status.manualOperation.state,'error');assert.match(status.error,/timeout/);assert.equal(status.lastUpload,null);
});
test('moving another device’s imported tree publishes removal from its old project index',async t=>{
    const e=await setup(t),a=e.device('a'),b=e.device('b'),c=e.device('c'),old=a.store.project('Old'),item=branch(a.store,old.id,'Move');
    await a.cloud.publish([item.id],e.pass);await b.cloud.catalog(e.pass);await b.cloud.project(old.id,e.pass);await b.cloud.hydrate(item.id,e.pass);
    const target=b.store.project('New');b.store.moveTree(item.id,target.id);await b.cloud.publish([item.id],e.pass);
    await c.cloud.catalog(e.pass);await c.cloud.project(old.id,e.pass);assert.equal(c.cloud.listing(old.id).itemCount,0);assert.equal(c.cloud.summaries().find(p=>p.id===old.id).count,0);
    await c.cloud.project(target.id,e.pass);assert.equal(c.cloud.listing(target.id).itemCount,1);
});
test('large sync previews require confirmation and packed transfer reduces requests without losing records', async t => {
    const env=await setup(t),a=env.device('a'),b=env.device('b'),project=a.store.project('Large');
    const raw=codexSample('/work',Array.from({length:400},(_,i)=>['Question '+i,'Answer '+i])),branch=a.store.branch(project.id,'Large history','codex',raw);
    const auto=new AutoSync(a.store,()=>env.config);t.after(()=>auto.close());auto.unlock(env.pass);
    const plan=await auto.prepareSync();assert.equal(plan.large,true);assert.throws(()=>auto.startSync(plan.id),/Confirm/);
    env.requests.length=0;auto.startSync(plan.id,true);await auto.syncJob;
    const objectPuts=env.requests.filter(([m,p])=>m==='PUT'&&p.includes('/objects/')).length;assert.ok(objectPuts<20);assert.equal(auto.status().dirty,false);
    await b.cloud.catalog(env.pass);await b.cloud.project(project.id,env.pass);await b.cloud.hydrate(branch.id,env.pass);
    assert.equal(b.store.raw(b.store.get('branch',branch.id).head),raw);
    env.requests.length=0;const next=await auto.prepareSync();auto.startSync(next.id,true);await auto.syncJob;assert.equal(env.requests.some(([m])=>m==='PUT'),false);
});
test('interrupted downloads retain only verified objects and resume without publishing a partial session', async t => {
    const env = await setup(t), a = env.device('a'), b = env.device('b'), project = a.store.project('Resume download'), item = a.store.branch(project.id, 'History', 'codex', codexSample('/work', Array.from({length:100}, (_,i)=>['Question '+i, 'Answer '+i])));
    await a.cloud.publish([item.id], env.pass); await b.cloud.catalog(env.pass); await b.cloud.project(project.id, env.pass);
    const dav = b.cloud.connection.dav, original = dav.get.bind(dav); let count = 0, failedHash;
    dav.get = async key => {
        if (key.startsWith('objects/') && ++count === 3) { failedHash = key.slice(8, -4); return seal('tampered', b.cloud.connection.key); }
        return original(key);
    };
    await assert.rejects(b.cloud.hydrate(item.id, env.pass), /integrity/);
    assert.equal(b.store.all('branch').length, 0);
    assert.equal(b.store.objectStatement.get(failedHash), undefined);
    const saved = b.store.db.prepare('SELECT hash FROM objects').all().map(r => r.hash); assert.ok(saved.length > 0);
    dav.get = original; env.requests.length = 0; await b.cloud.hydrate(item.id, env.pass);
    assert.equal(b.store.raw(b.store.get('branch', item.id).head), a.store.raw(item.head));
    for (const h of saved) assert.equal(env.requests.some(([method, url]) => method === 'GET' && url.endsWith('/' + h + '.bin')), false);
});
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
    const auto = new AutoSync(a.store, () => config); t.after(() => auto.close()); savePreferences(a.store,{autoUploadEnabled:true}); auto.unlock(pass);
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
test('remote archives wait for an explicit pull before changing local list projections', async t => {
    const env = await setup(t), { pass, requests } = env, a = env.device('a'), b = env.device('b');
    const p = a.store.project('Archive'), item = branch(a.store, p.id, 'History');
    await a.cloud.publish([item.id], pass); await b.cloud.catalog(pass); await b.cloud.project(p.id, pass); await b.cloud.hydrate(item.id, pass);
    a.store.edit(item.id, { archived: true }); await a.cloud.publish([item.id], pass); requests.length = 0;
    await b.cloud.catalog(pass); await b.cloud.project(p.id, pass);
    assert.equal(b.cloud.listing(p.id).itemCount, 1); assert.equal(b.cloud.listing('archived').itemCount, 0);
    assert.deepEqual(b.cloud.dirtyIds(), []); assert.ok(!requests.some(([m, p]) => m === 'GET' && /\/(trees|objects)\//.test(p)));
});
test('cached page refreshes and repeated opens make no remote requests; fallback is fifteen minutes', async t => {
    const env = await setup(t), { pass, config, requests } = env, a = env.device('a');
    const project = a.store.project('Event sync'), item = branch(a.store, project.id, 'Main');
    const auto = new AutoSync(a.store, () => config); t.after(() => auto.close()); auto.unlock(pass);
    await auto.flush('both', true); assert.equal(auto.interval,null);assert.equal(auto.status().nextRunAt,null);
    requests.length = 0;
    for (let i = 0; i < 25; i++) { await auto.openProject(project.id); await auto.openTree(item.id); await auto.checkCatalog(); }
    assert.equal(requests.length, 0);
    await auto.openProject(project.id, '', { check: true }); await auto.openTree(item.id, { check: true }); assert.equal(requests.length, 0);
    const before = auto.cloud.cache().lastUpload;
    await auto.flush('both', true); assert.ok(requests.some(([method]) => method === 'PROPFIND')); assert.equal(requests.filter(([method]) => method === 'PUT').length, 0);
    assert.equal(auto.cloud.cache().lastUpload, before); assert.ok(auto.cloud.connection.dav.metrics.bytesReceived > 0);
});
test('opening a cached local project does not wait behind an unrelated cloud transfer', async t => {
    const env = await setup(t), a = env.device('a'), project = a.store.project('Local'), item = branch(a.store, project.id, 'Ready');
    const auto = new AutoSync(a.store, () => env.config); t.after(() => auto.close()); auto.unlock(env.pass);
    await auto.flush('both', true); let release;
    const busy = auto.exclusive(() => new Promise(resolve => { release = resolve; }));
    await new Promise(resolve => setImmediate(resolve)); let timer;
    try { await Promise.race([auto.openProject(project.id, '', { check: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Local project blocked on cloud')), 100); })]); }
    finally { clearTimeout(timer); release(); await busy; }
    assert.equal(a.store.listing(project.id).items[0].id, item.id);
});
test('failed automatic uploads back off instead of retrying on every local refresh', async t => {
    const env = await setup(t), { pass, config, requests } = env, a = env.device('a');
    const p = a.store.project('Retry'), item = branch(a.store, p.id, 'Main'), auto = new AutoSync(a.store, () => config);
    t.after(() => auto.close()); savePreferences(a.store,{autoUploadEnabled:true}); auto.unlock(pass); auto.schedule([item.id]); env.failPublication(true);
    await assert.rejects(auto.flush('queued'), /503/); requests.length = 0;
    await auto.flush('queued'); await auto.checkCatalog(); assert.equal(requests.length, 0);
    assert.ok(auto.status().retryAt > Date.now());
    await assert.rejects(auto.flush('both', true), /pause/); assert.equal(requests.length, 0);
});

test('Ungrouped is a shared lazy inbox, moves both ways, and never copies device Active',async t=>{
    const {INBOX_ID}=await import('../src/inbox.js');const e=await setup(t),a=e.device('inbox-a'),b=e.device('inbox-b');
    a.store.device={...a.store.device,name:'Studio',model:'Mac Studio',platform:'darwin',kind:'desktop'};
    const loose=branch(a.store,null,'Daily note','Keep this daily context'),other=branch(a.store,null,'Other note');
    await a.cloud.publish([loose.id,other.id],e.pass);e.requests.length=0;await b.cloud.catalog(e.pass);
    assert.equal(b.store.all('branch').length,0);assert.equal(b.cloud.decorate(b.store.snapshot()).projects.find(p=>p.id===INBOX_ID).count,2);
    assert.ok(!e.requests.some(([m,p])=>m==='GET'&&p.includes('/objects/')));
    await b.cloud.project(INBOX_ID,e.pass);assert.equal(b.cloud.listing(INBOX_ID).itemCount,2);assert.equal(b.store.all('branch').length,0);
    await b.cloud.hydrate(loose.id,e.pass);assert.equal(b.store.get('branch',loose.id).projectId,null);assert.equal(b.store.instances().length,0);assert.equal(b.cloud.dirtyIds().length,0);
    assert.equal(b.cloud.listing(INBOX_ID).items.find(i=>i.id===loose.id).origin.model,'Mac Studio');
    const project=b.store.project('Focused work');b.store.moveItems({itemIds:[loose.id],projectId:project.id});await b.cloud.publish([loose.id],e.pass);
    await a.cloud.catalog(e.pass);await a.cloud.project(project.id,e.pass);await a.cloud.project(INBOX_ID,e.pass);
    assert.equal(a.cloud.listing(project.id).itemCount,0);assert.equal(a.cloud.listing(INBOX_ID).itemCount,2);await a.cloud.hydrate(loose.id,e.pass);assert.equal(a.cloud.listing(project.id).itemCount,1);assert.equal(a.cloud.listing(INBOX_ID).itemCount,1);assert.equal(a.store.get('branch',loose.id).projectId,project.id);
    a.store.moveItems({itemIds:[loose.id],projectId:INBOX_ID});await a.cloud.publish([loose.id],e.pass);await b.cloud.catalog(e.pass);await b.cloud.project(INBOX_ID,e.pass);await b.cloud.hydrate(loose.id,e.pass);assert.equal(b.store.get('branch',loose.id).projectId,null);
    assert.equal(b.cloud.listing(INBOX_ID).itemCount,2);assert.equal(b.store.instances().length,0);
    a.store.edit(loose.id,{archived:true});await a.cloud.publish([loose.id],e.pass);await b.cloud.catalog(e.pass);await b.cloud.project(INBOX_ID,e.pass);await b.cloud.hydrate(loose.id,e.pass);assert.equal(b.cloud.listing(INBOX_ID).itemCount,1);assert.equal(b.cloud.listing('archived').itemCount,1);
    b.store.edit(loose.id,{archived:false});await b.cloud.publish([loose.id],e.pass);assert.equal(b.cloud.listing(INBOX_ID).itemCount,2);
});
test('cloud inbox removes an old standalone row when native ancestry folds it into another tree',async t=>{
    const {INBOX_ID}=await import('../src/inbox.js');const e=await setup(t),a=e.device('merge-inbox'),b=e.device('reader-inbox');const one=branch(a.store,null,'Parent'),two=branch(a.store,null,'Child');await a.cloud.publish([one.id,two.id],e.pass);
    a.store.put('branch',{...two,parentId:one.id,forkRevision:one.head,forkEnd:a.store.get('revision',one.head).refs.length});await a.cloud.publish([one.id],e.pass);
    await b.cloud.catalog(e.pass);await b.cloud.project(INBOX_ID,e.pass);assert.equal(b.cloud.listing(INBOX_ID).itemCount,1);
});
test('cloud cache writes remain durable after a cached object is edited in place',async t=>{
    const e=await setup(t),a=e.device('cache');a.store.local('cloud:test',{heads:{},ack:{}});const c=a.store.local('cloud:test');c.ack.example='updated';a.store.local('cloud:test',c);assert.equal(JSON.parse(a.store.db.prepare("SELECT body FROM local WHERE key='cloud:test'").get().body).ack.example,'updated');
    const before=a.store.cloudVersion;a.store.local('cloud:test',c);assert.equal(a.store.cloudVersion,before);
});

test('vault caches stay independent when settings migration reuses the old cache',async t=>{
 const e=await setup(t),a=e.device('independent-cache');a.store.local('cloud:old',{ack:{root:'before'}});a.store.local('cloud:new',a.store.local('cloud:old'));const next=a.store.local('cloud:new');next.ack.root='after';a.store.local('cloud:new',next);assert.equal(a.store.local('cloud:old').ack.root,'before');assert.equal(a.store.local('cloud:new').ack.root,'after');
});

test('upload timer starts only with dirty content, survives status reads, and stops after publication; pull never uploads',async t=>{
 const e=await setup(t),a=e.device('timer'),auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());savePreferences(a.store,{autoUploadEnabled:true}); auto.unlock(e.pass);
 assert.equal(auto.status().nextRunAt,null);assert.equal(auto.interval,null);
 const p=a.store.project('Timer'),b=branch(a.store,p.id,'Main');const deadline=auto.status().nextRunAt;assert.ok(deadline>Date.now());assert.equal(auto.interval._idleTimeout,15*60000);assert.equal(auto.status().nextRunAt,deadline);
 await auto.flush('push',true);assert.equal(auto.status().nextRunAt,null);assert.equal(auto.interval,null);
 append(a.store,b,'Local only');const uploadAt=auto.status().nextRunAt;assert.ok(uploadAt);e.requests.length=0;await auto.flush('pull',true);assert.equal(auto.status().nextRunAt,uploadAt);assert.equal(e.requests.filter(([m])=>m==='PUT').length,0);assert.equal(auto.status().dirty,true);
 const progress=[];auto.onOperation=op=>{if(op.progress)progress.push({...op.progress});};await auto.flush('push',true);
 assert.ok(progress.some(p=>p.phase==='Uploading records'&&p.total>0&&p.completed===p.total));assert.ok(progress.some(p=>p.phase==='Publishing cloud directory'));assert.equal(auto.status().nextRunAt,null);
 let eta;auto.cloud.onProgress=p=>eta=p;auto.cloud.report('Uploading records',40,100,Date.now()-10000);assert.ok(eta.etaSeconds>=15&&eta.etaSeconds<=16);
});

test('Sync keeps unopened trees cloud-only; opening caches once, remote changes require Sync',async t=>{
 const e=await setup(t),a=e.device('source'),b=e.device('reader');
 const p=a.store.project('On demand'),first=branch(a.store,p.id,'Read me'),other=branch(a.store,p.id,'Leave online');
 await a.cloud.publish([first.id,other.id],e.pass);
 const auto=new AutoSync(b.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);
 const plan=await auto.prepareSync();assert.deepEqual(plan.downloadIds,[]);assert.equal(auto.listing('projects').items.length,2);
 auto.startSync(plan.id,true);await auto.syncJob;assert.equal(b.store.all('branch').length,0);
 assert.ok(auto.listing('projects').items.every(i=>i.cloudState==='cloud'));
 await auto.openTree(first.id);assert.equal(auto.listing('projects').items.find(i=>i.id===first.id).cloudState,'cached');
 e.requests.length=0;for(let i=0;i<3;i++){await auto.openTree(first.id,{check:true});auto.listing('projects');auto.status();}assert.equal(e.requests.length,0);assert.equal(auto.status().nextRunAt,null);
 append(a.store,first,'Changed remotely');await a.cloud.publish([first.id],e.pass);const before=b.store.get('branch',first.id).head;
 e.requests.length=0;await auto.openTree(first.id,{check:true});assert.equal(e.requests.length,0);assert.equal(b.store.get('branch',first.id).head,before);
 const next=await auto.prepareSync();assert.deepEqual(next.downloadIds,[first.id]);auto.startSync(next.id,true);await auto.syncJob;
 assert.notEqual(b.store.get('branch',first.id).head,before);assert.equal(b.store.all('branch').length,1);assert.equal(auto.status().dirty,false);assert.equal(auto.status().nextRunAt,null);
});
test('local changes start one stable countdown; disabled auto Push and empty schedules stay idle',async t=>{
 const e=await setup(t),a=e.device('timer'),auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);
 auto.schedule([]);assert.equal(auto.status().nextRunAt,null);
 const b=branch(a.store,null,'New');auto.schedule([b.id]);const at=auto.status().nextRunAt;
 auto.schedule([b.id]);assert.equal(auto.status().nextRunAt,at);assert.equal(auto.timer,undefined);
 const {savePreferences}=await import('../src/preferences.js');savePreferences(a.store,{autoUploadEnabled:false});auto.configureTimer();auto.schedule([b.id]);
 assert.equal(auto.status().nextRunAt,null);e.requests.length=0;await auto.flush('queued');assert.equal(e.requests.length,0);
});

test('automatic Push checks concurrency without refreshing the browsing directory',async t=>{
 const e=await setup(t),a=e.device('writer'),b=e.device('other');
 const p=a.store.project('Work'),local=branch(a.store,p.id,'Local');await a.cloud.publish([local.id],e.pass);
 const auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);
 const plan=await auto.prepareSync();auto.startSync(plan.id,true);await auto.syncJob;
 const remote=branch(b.store,null,'New elsewhere');await b.cloud.publish([remote.id],e.pass);
 append(a.store,local,'Local edit');await auto.flush('push');
 assert.equal(auto.listing('projects').items.some(i=>i.id===remote.id),false);
 const next=await auto.prepareSync();assert.equal(auto.listing('projects').items.some(i=>i.id===remote.id),true);assert.equal(next.downloadIds.includes(remote.id),false);
});

test('showing background records is a view preference, not permission to upload all of them',async t=>{
 const e=await setup(t),a=e.device('background');const b=branch(a.store,null,'Scheduled');a.store.put('branch',{...b,background:'scheduled',excluded:'scheduled'});
 const {savePreferences}=await import('../src/preferences.js');assert.deepEqual(a.cloud.dirtyIds(),[]);
 savePreferences(a.store,{showScheduledSessions:true});assert.equal(a.store.collections().items.length,1);assert.deepEqual(a.cloud.dirtyIds(),[]);
 a.store.put('branch',{...a.store.get('branch',b.id),backgroundManaged:true,archived:true});assert.deepEqual(a.cloud.dirtyIds(),[]);
 savePreferences(a.store,{showScheduledSessions:false});assert.deepEqual(a.cloud.dirtyIds(),[]);
});

test('split transfers default to manual; Download never initializes or writes an empty remote vault', async t => {
 const e=await setup(t),a=e.device('manual'),auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);
 branch(a.store,null,'Local');a.store.local('syncStarted',true);
 assert.equal(auto.status().nextRunAt,null);await auto.fallback();assert.equal(e.requests.length,0);
 auto.startTransfer('pull');await auto.syncJob;
 assert.ok(e.requests.every(([method])=>method==='GET'||method==='PROPFIND'));assert.equal(e.files.size,0);
 assert.equal(auto.status().dirty,true);assert.equal(auto.status().nextRunAt,null);
});

test('Upload visibly downloads first and a failed download cannot publish', async t => {
 const e=await setup(t),a=e.device('order'),auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);branch(a.store,null,'Upload');
 const stages=[];auto.onOperation=op=>{if(op.state==='running')stages.push(op.step);};
 auto.startTransfer('push');await auto.syncJob;assert.ok(stages.indexOf('pull')>=0);assert.ok(stages.indexOf('push')>stages.indexOf('pull'));
 assert.equal(auto.status().dirty,false);
 a.store.edit(a.store.all('branch')[0].id,{name:'Changed'});e.requests.length=0;
 e.intercept((req,res)=>{if(req.method==='PROPFIND'){res.writeHead(500);res.end();return true;}return false;});
 auto.startTransfer('push');await assert.rejects(auto.syncJob);
 assert.ok(e.requests.every(([method])=>!['PUT','DELETE','MKCOL'].includes(method)));assert.ok(auto.status().lastFailure);
});

test('Download applies newer session and node changes but preserves a newer local session', async t => {
 const e=await setup(t),a=e.device('newer-a'),b=e.device('newer-b'),s=branch(a.store,null,'Original');
 await a.cloud.publish([s.id],e.pass);await b.cloud.catalog(e.pass);for(const p of b.cloud.summaries())await b.cloud.project(p.id,e.pass);await b.cloud.hydrate(s.id,e.pass);
 b.store.edit(s.id,{name:'Older local change'});
 a.store.edit(s.id,{name:'New cloud name'});organize(a.store,s,'New cloud node');await a.cloud.publish([s.id],e.pass);
 const auto=new AutoSync(b.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);e.requests.length=0;auto.startTransfer('pull');await auto.syncJob;
 assert.equal(b.store.get('branch',s.id).name,'New cloud name');assert.ok(b.store.treeGraph(s.id).nodes.some(n=>n.name==='New cloud node'));assert.ok(!auto.status().dirty);
 assert.ok(e.requests.every(([m])=>['GET','PROPFIND'].includes(m)));
 b.store.edit(s.id,{name:'Newest local name'});auto.startTransfer('pull');await auto.syncJob;
 assert.equal(b.store.get('branch',s.id).name,'Newest local name');assert.ok(auto.status().dirty);assert.equal(auto.pendingItems()[0].name,'Newest local name');
});

test('an edit while Download awaits a newer manifest survives even a remote clock ahead', async t => {
 const e=await setup(t),a=e.device('during-a'),b=e.device('during-b'),s=branch(a.store,null,'Original');
 await a.cloud.publish([s.id],e.pass);await b.cloud.catalog(e.pass);for(const p of b.cloud.summaries())await b.cloud.project(p.id,e.pass);await b.cloud.hydrate(s.id,e.pass);
 a.store.edit(s.id,{name:'Remote future'});a.store.put('branch',{...a.store.get('branch',s.id),metadataUpdatedAt:'2099-01-01T00:00:00.000Z'});await a.cloud.publish([s.id],e.pass);
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let held=false;
 e.intercept(async(req)=>{if(!held&&req.method==='GET'&&req.url.includes('/trees/')){held=true;entered.resolve();await release.promise;}return false;});
 const auto=new AutoSync(b.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);auto.startTransfer('pull');
 try{await entered.promise;b.store.edit(s.id,{name:'Typed while downloading'});}finally{release.resolve();}
 await auto.syncJob;assert.equal(b.store.get('branch',s.id).name,'Typed while downloading');assert.ok(auto.status().dirty);
});

test('upload acknowledges only its captured snapshot and protects bodies from concurrent Trash cleanup', async t => {
 const e=await setup(t),a=e.device('snapshot'),s=branch(a.store,null,'Before snapshot');
 const auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let held=false;
 e.intercept(async(req)=>{if(!held&&req.method==='PUT'&&req.url.includes('/objects/')){held=true;entered.resolve();await release.promise;}return false;});
 auto.startTransfer('push');try{await entered.promise;a.store.edit(s.id,{name:'After snapshot'});auto.schedule([s.id]);}finally{release.resolve();}
 await auto.syncJob;assert.ok(auto.cloud.dirtyIds().includes(s.id));assert.equal(auto.pendingItems()[0].name,'After snapshot');
 const reader=e.device('snapshot-reader');await reader.cloud.catalog(e.pass);for(const p of reader.cloud.summaries())await reader.cloud.project(p.id,e.pass);await reader.cloud.hydrate(s.id,e.pass);assert.equal(reader.store.get('branch',s.id).name,'Before snapshot');
});

test('Trash during an actual upload leaves deletion queued and does not remove snapshot records early', async t => {
 const {stageTrash,cleanupLocal}=await import('../src/trash.js');
 const e=await setup(t),a=e.device('trash-in-flight'),s=branch(a.store,null,'Discard while uploading'),auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let held=false;
 e.intercept(async(req)=>{if(!held&&req.method==='PUT'&&req.url.includes('/objects/')){held=true;entered.resolve();await release.promise;}return false;});
 auto.startTransfer('push');try{await entered.promise;stageTrash(a.store,[s.id],[s.id]);assert.equal(cleanupLocal(a.store).deferred,true);assert.ok(a.store.raw(s.head));}finally{release.resolve();}
 await auto.syncJob;
 assert.equal(a.store.local('trashPending').length,1);assert.equal(a.store.local('trashEntries')[0].state,'pending');assert.equal(auto.pendingItems()[0].action,'remove');assert.ok(auto.status().dirty);
});

test('equal modification times with divergent transcripts require an explicit choice', async t => {
 const e=await setup(t),a=e.device('tie-a'),b=e.device('tie-b'),s=branch(a.store,null,'Same time');
 await a.cloud.publish([s.id],e.pass);await b.cloud.catalog(e.pass);for(const p of b.cloud.summaries())await b.cloud.project(p.id,e.pass);await b.cloud.hydrate(s.id,e.pass);
 append(a.store,s,'Remote suffix');append(b.store,b.store.get('branch',s.id),'Local suffix');
 for(const device of [a,b])device.store.put('branch',{...device.store.get('branch',s.id),contentUpdatedAt:'2090-01-01T00:00:00.000Z',metadataUpdatedAt:'2090-01-01T00:00:00.000Z'});
 await a.cloud.publish([s.id],e.pass);await b.cloud.catalog(e.pass);for(const p of b.cloud.summaries())await b.cloud.project(p.id,e.pass);await b.cloud.hydrate(s.id,e.pass,{latest:true});
 assert.ok(b.store.raw(b.store.get('branch',s.id).head).includes('Local suffix'));assert.equal(b.store.local('conflicts')[0].kind,'session');assert.ok(b.cloud.dirtyIds().includes(s.id));
});

test('manual Download replaces an older transcript and leaves cloud-only sessions unmaterialized', async t => {
 const e=await setup(t),a=e.device('content-a'),b=e.device('content-b'),s=branch(a.store,null,'Cached');
 await a.cloud.publish([s.id],e.pass);await b.cloud.catalog(e.pass);for(const p of b.cloud.summaries())await b.cloud.project(p.id,e.pass);await b.cloud.hydrate(s.id,e.pass);
 const oldHead=b.store.get('branch',s.id).head;append(a.store,s,'Newer remote transcript');const unopened=branch(a.store,null,'Cloud only');await a.cloud.publish([s.id,unopened.id],e.pass);
 const auto=new AutoSync(b.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);e.requests.length=0;auto.startTransfer('pull');await auto.syncJob;
 assert.notEqual(b.store.get('branch',s.id).head,oldHead);assert.ok(b.store.raw(b.store.get('branch',s.id).head).includes('Newer remote transcript'));assert.equal(b.store.find('branch',unopened.id),undefined);
 assert.ok(auto.listing('00000000-0000-4000-8000-000000000001').items.some(i=>i.id===unopened.id));assert.ok(e.requests.every(([m])=>['GET','PROPFIND'].includes(m)));
});

test('old implicit upload preferences do not opt into the new automatic pipeline', async t => {
 const {preferences}=await import('../src/preferences.js'),e=await setup(t),a=e.device('opt-in');
 a.store.local('preferences',{autoUploadEnabled:true,autoUploadMinutes:1});assert.equal(preferences(a.store).autoUploadEnabled,false);
 savePreferences(a.store,{autoUploadEnabled:true});assert.equal(preferences(a.store).autoUploadEnabled,true);
 savePreferences(a.store,{autoUploadEnabled:false});assert.equal(preferences(a.store).autoUploadEnabled,false);
});

test('Push stays in Pull through shared-history preparation and publishes cleanup only once', async t => {
 const e=await setup(t),a=e.device('cleanup-stages'),directions=[];
 const auto=new AutoSync(a.store,()=>e.config,async(s,c,p,d)=>{directions.push(d);return {downloaded:1};});t.after(()=>auto.close());auto.unlock(e.pass);
 auto.cloud.cacheKey='cloud:cleanup-stage-test';
 auto.syncTrash=async options=>{assert.equal(auto.operation.step,'pull');assert.ok(!auto.operation.pullComplete);options.onProgress({completed:2,total:3});auto.cloud.report('Preparing shared history',2,3);assert.equal(auto.operation.step,'pull');options.onProgress({completed:3,total:3});options.onPrepared();assert.equal(auto.operation.step,'push');return {rebuilt:true,published:2,uploaded:10};};
 auto.cloud.publish=()=>{throw Error('A second publication must not occur');};auto.startTransfer('push');await auto.syncJob;
 assert.deepEqual(directions,['pull']);assert.equal(auto.operation.summary.published,2);assert.equal(auto.operation.state,'success');
});
