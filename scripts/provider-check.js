// Live-provider check. All remote test writes are confined to a newly created
// self-check-* child of the configured dedicated application directory.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Cloud } from '../src/cloud.js';
import { AutoSync } from '../src/auto-sync.js';
import { Native } from '../src/native.js';
import { WebDAV } from '../src/sync.js';
import { codexSample, codexTurn, claudeSample } from '../src/demo.js';
const configFile = process.argv[2] || path.join(os.homedir(), '.session-grove/webdav.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const passphrase = fs.readFileSync(path.join(path.dirname(configFile), 'sync-key.txt'), 'utf8').trim();
const base = new URL(config.url);
assert.equal(base.protocol, 'https:'); assert.ok(base.pathname.split('/').filter(Boolean).length >= 2, 'Use a dedicated folder below the DAV root.');
base.pathname = base.pathname.replace(/\/?$/, '/');
const authorization = 'Basic ' + Buffer.from(config.username + ':' + config.password).toString('base64');
const remote = async (method, url) => {
    assert.ok(url.startsWith(base.href), 'Refusing operations outside the dedicated folder.');
    return fetch(url, { method, headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(30000) });
};
const report = { version: '0.5.0', startedAt: new Date().toISOString(), checks: {}, cleaned: false };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-provider-')), stores = [];
const folder = 'self-check-' + Date.now() + '-' + randomBytes(4).toString('hex');
const target = new URL(folder + '/', base).href;
let created = false, auto;
const events = [], originalRequest = WebDAV.prototype.request;
WebDAV.prototype.request = function(method, key, ...args) { events.push({ method, layer: String(key || '').split('/')[0] }); return originalRequest.call(this, method, key, ...args); };
try {
    const parent = await remote('MKCOL', base.href); assert.ok([201, 405].includes(parent.status), `Dedicated directory: HTTP ${parent.status}`);
    const result = await remote('MKCOL', target); assert.equal(result.status, 201, 'Test directory must be newly created.'); created = true;
    const testConfig = { ...config, url: target };
    const device = name => { const store = new Store(path.join(root, name)); stores.push(store); return { store, cloud: new Cloud(store, () => testConfig) }; };
    const a = device('a'), b = device('b'), workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
    const project = a.store.project('Isolated provider verification');
    const codex = a.store.branch(project.id, 'Sample Codex', 'codex', codexSample(workspace, [['Sample context', 'Sample reply'], ['Sample second turn', 'Done']]));
    const claude = a.store.branch(project.id, 'Sample Claude', 'claude', claudeSample(workspace, [['Sample context', 'Sample reply']]));
    await a.cloud.publish([codex.id, claude.id], passphrase); report.checks.upload = true;
    events.length = 0; await b.cloud.catalog(passphrase);
    assert.equal(b.store.all('branch').length, 0); assert.ok(!events.some(e => e.method === 'GET' && ['projects', 'trees', 'objects'].includes(e.layer))); report.checks.catalogOnly = true;
    events.length = 0; await b.cloud.project(project.id, passphrase);
    assert.equal(b.cloud.items().length, 2); assert.ok(!events.some(e => e.method === 'GET' && ['trees', 'objects'].includes(e.layer))); report.checks.indexOnly = true;
    await b.cloud.hydrate(codex.id, passphrase); assert.equal(b.store.all('branch').length, 1); assert.equal(b.store.treeGraph(codex.id).chatCount, 4); report.checks.lazyContext = true;
    const graph = b.store.treeGraph(codex.id);
    b.store.organize(codex.id, { version: graph.version, pathId: codex.id, action: 'rename', nodeId: graph.nodes[0].id, name: 'Verified context' });
    await b.cloud.publish([codex.id], passphrase);
    await a.cloud.catalog(passphrase); await a.cloud.project(project.id, passphrase); await a.cloud.hydrate(codex.id, passphrase);
    assert.equal(a.store.treeGraph(codex.id).nodes[0].name, 'Verified context'); report.checks.crossDeviceOrganization = true;
    await b.cloud.hydrate(claude.id, passphrase);
    const native = new Native(b.store, { roots: { codex: path.join(root, 'native-codex'), claude: path.join(root, 'native-claude') }, guard: () => {} });
    for (const branch of [codex, claude]) native.setActive(branch.id, workspace, true);
    assert.equal(native.apply().applied, 2); report.checks.isolatedMaterialization = true;
    const file = b.store.instances().find(i => i.branchId === codex.id).file;
    fs.appendFileSync(file, codexTurn('New sample turn', 'New sample answer').map(v => JSON.stringify(v) + '\n').join('')); native.collect();
    auto = new AutoSync(b.store, () => testConfig); clearInterval(auto.interval); auto.unlock(passphrase);
    events.length = 0; await auto.flush('pull'); await auto.flush('queued');
    assert.equal(events.filter(e => e.method === 'PUT').length, 0); assert.equal(auto.status().dirty, true); report.checks.pendingStaysLocal = true;
    await auto.flush('both', true); assert.equal(auto.status().dirty, false); report.checks.manualSync = true;
    events.length = 0; await auto.flush('both', true); assert.equal(events.filter(e => e.method === 'PUT').length, 0); report.checks.noOpSync = true;
    native.setActive(codex.id, null, false); native.apply([codex.id]); b.store.edit(codex.id, { archived: true });
    auto.schedule([codex.id]); await auto.flush('queued');
    await a.cloud.catalog(passphrase); await a.cloud.project(project.id, passphrase); await a.cloud.hydrate(codex.id, passphrase);
    assert.equal(a.store.get('branch', codex.id).archived, true); report.checks.archiveSync = true;
    b.store.edit(codex.id, { archived: false }); auto.schedule([codex.id]); await auto.flush('queued');
    native.setActive(codex.id, workspace, true); native.apply([codex.id]); assert.equal(b.store.treeGraph(codex.id).chatCount, 6); report.checks.restore = true;
} catch (e) {
    report.failure = { type: e.name, code: e.code || 'CHECK_FAILED' };
    console.error(`Provider verification failed: ${e.name}${e.code ? ' (' + e.code + ')' : ''}. No credentials were printed.`);
    process.exitCode = 1;
} finally {
    auto?.close(); stores.forEach(s => s.close()); fs.rmSync(root, { recursive: true, force: true });
    if (created) {
        try { const deleted = await remote('DELETE', target); assert.ok([200, 202, 204].includes(deleted.status)); report.cleaned = true; }
        catch { report.cleanupRequired = folder; process.exitCode = 1; }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(path.dirname(configFile), 'provider-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report));
}
