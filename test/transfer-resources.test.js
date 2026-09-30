import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Cloud } from '../src/cloud.js';
import { copyRecords, copySummaries } from '../src/record-packs.js';
import { codexSample } from '../src/demo.js';
import { hash } from '../src/util.js';
import { seal } from '../src/sync.js';
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-transfer-'));
    const a = new Store(path.join(root, 'a')), b = new Store(path.join(root, 'b'));
    t.after(() => { a.close(); b.close(); fs.rmSync(root, { recursive: true, force: true }); });
    return { a, b };
}
test('local reuse copies only requested verified records and rejects corruption', t => {
    const { a, b } = fixture(t), raw = '{"value":"keep"}', h = hash(raw), other = '{"value":"private"}';
    a.insertObject.run(h, raw); a.insertObject.run(hash(other), other);
    assert.equal(copyRecords(a, b, [h, hash('absent')]), 1);
    assert.equal(b.objectStatement.get(h).body, raw);
    assert.equal(b.objectStatement.get(hash(other)), undefined);
    assert.equal(copyRecords(a, b, [h]), 0);
    a.db.prepare('UPDATE objects SET body=? WHERE hash=?').run('corrupt', h);
    b.db.prepare('DELETE FROM objects WHERE hash=?').run(h);
    assert.throws(() => copyRecords(a, b, [h]), /integrity/);
    assert.equal(b.objectStatement.get(h), undefined);
});
test('summary reuse is pinned to the exact revision and supported summary version', t => {
    const { a, b } = fixture(t), branch = a.branch(null, 'Session', 'codex', codexSample('/work', [['Question', 'Answer']]));
    a.summary(branch.head, branch.agent);
    const graph = a.exportGraph(); copySummaries(a, b, graph);
    assert.equal(b.summaryRead.get(branch.head, branch.agent).body, a.summaryRead.get(branch.head, branch.agent).body);
    b.db.exec('DELETE FROM summaries');
    const altered = structuredClone(graph); altered.revisions[0].refs.reverse();
    copySummaries(a, b, altered); assert.equal(b.summaryRead.get(branch.head, branch.agent), undefined);
});
test('manifest cache avoids duplicate GETs, isolates callers, and clears on lock', async t => {
    const { a } = fixture(t), cloud = new Cloud(a, () => ({})); let calls = 0;
    const value = { schema: 3, branches: [], projects: [], revisions: [] }, ref = hash(JSON.stringify(value));
    cloud.connection = { dav: { base: 'synthetic/', get: async () => { calls++; return seal(value, null); } }, key: null };
    const first = await cloud.manifest(ref); first.branches.push({ id: 'caller-mutation' });
    assert.deepEqual(await cloud.manifest(ref), value); assert.equal(calls, 1);
    assert.ok(cloud.manifestBytes <= 16 * 1024 * 1024);
    cloud.lock(); assert.equal(cloud.manifestBytes, 0); assert.equal(cloud.manifests.size, 0);
});
test('catalog parallel reads preserve device order and never publish a partial failed batch', async t => {
    const { a } = fixture(t), cloud = new Cloud(a, () => ({})), vault = Buffer.from('fixture');
    const names = ['slow.bin', 'fast.bin']; let fail = false;
    cloud.cacheKey = 'cloud:parallel-test';
    cloud.connection = { vaultBytes: vault, rootDav: { get: async () => vault }, key: null, dav: {
        list: async () => names,
        request: async (method, key) => { if (key.includes('slow')) await new Promise(r => setTimeout(r, 15)); return new Response(seal({ schema: fail && key.includes('slow') ? 0 : 5, projects: [], deviceId: key }, null)); },
        readResponse: async r => Buffer.from(await r.arrayBuffer())
    } };
    cloud.connect = async () => cloud.connection;
    await cloud.catalog('fixture');
    assert.deepEqual(Object.keys(cloud.cache().heads), names);
    const before = JSON.stringify(cloud.cache().heads); fail = true;
    await assert.rejects(cloud.catalog('fixture'), /Unsupported/);
    assert.equal(JSON.stringify(cloud.cache().heads), before);
});

test('one shared pack fills later sessions without caching unrelated discarded records', async t => {
    const { a, b } = fixture(t), { downloadRecords } = await import('../src/record-packs.js');
    const values = ['first kept record', 'second kept record', 'discarded record'];
    const refs = values.map(hash), value = { schema: 'grove-record-pack-1', objects: Object.fromEntries(refs.map((h, i) => [h, values[i]])) };
    const pack = { ref: hash(JSON.stringify(value)), refs }, remaining = new Set(refs.slice(0, 2)); let requests = 0;
    const dav = { get: async () => { requests++; return seal(value, null); } };
    const graph = index => ({ revisions: [{ id: 'revision-' + index, refs: [refs[index]] }], packs: [pack] });
    await downloadRecords(a, dav, null, graph(0), () => {}, () => {}, { cache: b, globalMissing: remaining });
    await downloadRecords(a, dav, null, graph(1), () => {}, () => {}, { cache: b, globalMissing: remaining });
    assert.equal(requests, 1); assert.equal(remaining.size, 0);
    for (const store of [a, b]) { assert.ok(store.objectStatement.get(refs[0])); assert.ok(store.objectStatement.get(refs[1])); assert.equal(store.objectStatement.get(refs[2]), undefined); }
});
test('an occupied cloud lock reports a retryable busy state, not unsupported WebDAV', async () => {
    const { withVaultLock } = await import('../src/dav-lock.js');
    const dav = { request: async () => new Response('', { status: 423 }), readResponse: async () => Buffer.alloc(0) };
    await assert.rejects(withVaultLock(dav, () => assert.fail('must not mutate a locked vault')), e => e.code === 'WEBDAV_BACKOFF' && e.retryAfterMs === 120000 && /busy/.test(e.message));
});
