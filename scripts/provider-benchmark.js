// Real-provider benchmark. Config: {label,url,username,password,passphrase}.
// Uses a unique synthetic-only directory and removes it in finally. Never logs config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { WebDAV, davSucceeded } from '../src/sync.js';
import { withVaultLock } from '../src/dav-lock.js';
import { Store } from '../src/store.js';
import { Cloud } from '../src/cloud.js';
import { codexSample } from '../src/demo.js';
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const transport = [], responseInfo = new WeakMap();
const request = WebDAV.prototype.request, readResponse = WebDAV.prototype.readResponse;
WebDAV.prototype.request = async function(method, key, ...args) {
    const info = { method, kind: key?.split('/')[0] || 'collection' }; transport.push(info); if (transport.length > 8) transport.shift();
    const r = await request.call(this, method, key, ...args);
    Object.assign(info, { status: r.status, length: r.headers.get('content-length'), encoding: r.headers.get('content-encoding') }); responseInfo.set(r, info); return r;
};
WebDAV.prototype.readResponse = async function(r, ...args) { try { return await readResponse.call(this, r, ...args); } catch(e) { e.transport = responseInfo.get(r); throw e; } };
const folder = 'grove-benchmark-' + randomUUID();
const dav = new WebDAV(config); dav.base = config.url.replace(/\/$/, '') + '/' + folder + '/';
const result = { provider: config.label, at: new Date().toISOString(), phases: [], cleaned: false };
const synthetic = size => { const chunks = []; for (let i = 0; i < Math.ceil(size / 32); i++) chunks.push(createHash('sha256').update('grove-benchmark:' + i).digest()); return Buffer.concat(chunks).subarray(0, size); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-provider-'));
let store, created = false, phase = 'create isolated directory';
const errorText = e => String(e.message).replaceAll(config.password || '__none__', '[redacted]').replaceAll(config.passphrase || '__none__', '[redacted]').replaceAll(config.url, '[provider]');
async function measure(name, fn, client = dav) {
    phase = name;
    const before = { ...client.metrics }, cpu = process.cpuUsage(), start = performance.now();
    const extra = await fn();
    const row = { name, wallMs: Math.round(performance.now() - start), cpuMs: Math.round(Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b) / 1000), requests: client.metrics.requests - before.requests, sentBytes: client.metrics.bytesSent - before.bytesSent, receivedBytes: client.metrics.bytesReceived - before.bytesReceived, ...extra };
    result.phases.push(row); console.error(config.label + ': ' + name + ' ' + row.wallMs + 'ms');
}
try {
    await dav.mkdir(); created = true;
    if (!process.argv.includes('--cloud-only')) {
    const tiny = synthetic(1024);
    await measure('8 separate records', async () => { for (let i = 0; i < 8; i++) { await dav.put('small-' + i, tiny, true); assert.ok((await dav.get('small-' + i)).equals(tiny)); } });
    const packed = Buffer.concat(Array(8).fill(tiny));
    await measure('same records in one pack', async () => { await dav.put('packed', packed, true); assert.ok((await dav.get('packed')).equals(packed)); });
    const payload = synthetic(512 * 1024);
    await measure('512 KiB upload', () => dav.put('payload', payload, true));
    await measure('512 KiB download', async () => { const start = performance.now(), r = await dav.request('GET', 'payload'), headersMs = performance.now() - start; assert.ok(r.ok); const bodyStart = performance.now(), bytes = await dav.readResponse(r); assert.ok(bytes.equals(payload)); return { headersMs: Math.round(headersMs), bodyMs: Math.round(performance.now() - bodyStart) }; });
    try { await measure('collection lock compatibility', async () => { await withVaultLock(dav, async () => {}); result.collectionLock = true; }); }
    catch (e) { result.collectionLock = false; result.lockError = errorText(e); }
    }
    store = new Store(path.join(root, 'library'));
    const cloud = new Cloud(store, () => ({ ...config, url: dav.base }));
    const b = store.branch(null, 'Synthetic benchmark', 'codex', codexSample('/benchmark', Array.from({ length: 8 }, (_, i) => ['Test ' + i, synthetic(4096).toString('base64')])));
    phase = 'encrypted vault setup'; await cloud.connect(config.passphrase);
    await measure('encrypted session publish', () => cloud.publish([b.id], config.passphrase), cloud.connection.dav);
    store.edit(b.id, { name: 'Synthetic renamed' });
    await measure('metadata-only publish', () => cloud.publish([b.id], config.passphrase), cloud.connection.dav);
} catch (e) { result.error = errorText(e); result.errorPhase = phase; result.errorCode = e.cause?.code || e.code; result.transport = e.transport; result.recentRequests = transport.slice(); }
finally {
    store?.close(); fs.rmSync(root, { recursive: true, force: true });
    if (created) try { const r = await dav.request('DELETE', ''); const body = await dav.readResponse(r); assert.ok(davSucceeded(r, body)); result.cleaned = true; } catch (e) { result.cleanupError = errorText(e); result.testFolder = folder; }
    console.log(JSON.stringify(result));
}
