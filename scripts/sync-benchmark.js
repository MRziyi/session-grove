// Repeatable synthetic DAV benchmark; --source may point at a pre-change checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const source = path.resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const { Store } = await import(pathToFileURL(path.join(source, 'src/store.js')));
const { Cloud } = await import(pathToFileURL(path.join(source, 'src/cloud.js')));
const { stageTrash } = await import(pathToFileURL(path.join(source, 'src/trash.js')));
const { collectTrash } = await import(pathToFileURL(path.join(source, 'src/cloud-trash.js')));
const { codexSample } = await import(pathToFileURL(path.join(source, 'src/demo.js')));
const { seal, unseal } = await import(pathToFileURL(path.join(source, 'src/sync.js')));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sync-bench-'));
const files = new Map(), network = { requests: 0, sent: 0, received: 0, objectGets: 0 }, phases = [];
const latency = Number(process.env.BENCH_LATENCY_MS || 8);
let locked = false;
const server = http.createServer(async (req, res) => {
    network.requests++; const chunks = [];
    for await (const c of req) { chunks.push(c); network.sent += c.length; }
    await new Promise(r => setTimeout(r, latency));
    const key = req.url, body = files.get(key), etag = body && '"' + createHash('sha256').update(body).digest('hex') + '"';
    const send = (status, value = '') => { network.received += Buffer.byteLength(value); res.writeHead(status, etag ? { ETag: etag } : {}); res.end(value); };
    if (req.method === 'LOCK') { if (locked && !req.headers.if) return send(423); locked = true; res.writeHead(200, { 'Lock-Token': '<opaquelocktoken:benchmark>' }); return res.end(); }
    if (req.method === 'UNLOCK') { locked = false; return send(204); }
    if (locked && !['GET', 'HEAD', 'PROPFIND'].includes(req.method) && !req.headers.if) return send(423);
    if (req.method === 'MKCOL') return send(201);
    if (req.method === 'PUT') { if (req.headers['if-none-match'] === '*' && body) return send(412); files.set(key, Buffer.concat(chunks)); return send(201); }
    if (req.method === 'DELETE') { for (const k of files.keys()) if (k === key || key.endsWith('/') && k.startsWith(key)) files.delete(k); return send(204); }
    if (req.method === 'PROPFIND') return send(207, '<d:multistatus xmlns:d="DAV:">' + [...files.keys()].filter(k => k.startsWith(key) && !k.slice(key.length).includes('/')).map(k => '<d:response><d:href>' + k + '</d:href></d:response>').join('') + '</d:multistatus>');
    if (req.method === 'GET' && key.includes('/objects/')) network.objectGets++;
    if (!body) return send(404);
    if (req.headers['if-none-match'] === etag) return send(304);
    return send(200, req.method === 'HEAD' ? '' : body);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const config = { url: 'http://127.0.0.1:' + server.address().port + '/benchmark' }, pass = 'synthetic-benchmark-pass';
const store = new Store(path.join(root, 'source')), remote = new Store(path.join(root, 'reader'));
const cloud = new Cloud(store, () => config), reader = new Cloud(remote, () => config);
const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
async function measure(name, fn) {
    global.gc?.(); await new Promise(r => setTimeout(r, 15)); lag.reset();
    const before = { ...network }, cpu = process.cpuUsage(), start = performance.now(); let peak = process.memoryUsage();
    const sample = () => { const m = process.memoryUsage(); for (const k of ['rss', 'heapUsed', 'external']) peak[k] = Math.max(peak[k], m[k]); };
    const timer = setInterval(sample, 5);
    try { await fn(); sample(); await new Promise(r => setImmediate(r)); }
    finally { clearInterval(timer); }
    phases.push({ name, wallMs: Math.round(performance.now() - start), cpuMs: Math.round(Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b) / 1000), peakRssMiB: Math.round(peak.rss / 1048576), peakHeapMiB: Math.round(peak.heapUsed / 1048576), eventLoopMaxMs: Math.round(lag.max / 1e6), ...Object.fromEntries(Object.keys(network).map(k => [k, network[k] - before[k]])) });
}
try {
    const ids = [];
    await measure('seed', () => {
        for (let i = 0; i < 24; i++) {
            const pairs = Array.from({ length: 24 }, (_, j) => ['Question ' + i + '/' + j, Array.from({ length: 100 }, (_, k) => createHash('sha256').update(i + ':' + j + ':' + k).digest('hex')).join('\n')]);
            ids.push(store.branch(null, 'Session ' + i, 'codex', codexSample('/benchmark', pairs)).id);
        }
    });
    await measure('cold fingerprints', () => cloud.dirtyIds());
    await measure('initial publish', () => cloud.publish(ids, pass));
    await measure('metadata-only publish', async () => { store.edit(ids[1], { name: 'Renamed' }); await cloud.publish([ids[1]], pass); });
    if (process.env.BENCH_LEGACY === '1') {
        // Equivalent old-format cloud data: one HTTP object per record, no packs.
        const { dav, key } = cloud.connection, prefix = new URL(dav.base).pathname;
        const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
        for (const row of store.db.prepare('SELECT hash,body FROM objects').iterate()) files.set(prefix + 'objects/' + row.hash + '.bin', seal(row.body, key));
        for (const name of [...files.keys()].filter(k => k.startsWith(prefix + 'heads/'))) {
            const head = unseal(files.get(name), key);
            for (const p of head.projects) {
                const index = unseal(files.get(prefix + 'projects/' + p.index + '.bin'), key);
                for (const item of index.items) {
                    const graph = unseal(files.get(prefix + 'trees/' + item.ref + '.bin'), key); delete graph.packs;
                    item.ref = digest(graph); files.set(prefix + 'trees/' + item.ref + '.bin', seal(graph, key));
                }
                p.index = digest(index); files.set(prefix + 'projects/' + p.index + '.bin', seal(index, key));
            }
            files.set(name, seal(head, key));
        }
    }
    await measure('cached trash cleanup', async () => { stageTrash(store, [ids[0]], [ids[0]]); await collectTrash(cloud, pass); });
    await measure('fresh-device round trip', async () => { await reader.catalog(pass); for (const p of reader.summaries()) await reader.project(p.id, pass); await reader.hydrate(ids[1], pass); });
    assert.equal(remote.get('branch', ids[1]).name, 'Renamed');
    assert.equal(remote.raw(remote.get('branch', ids[1]).head), store.raw(store.get('branch', ids[1]).head));
    assert.equal(reader.items().some(i => i.id === ids[0]), false);
    console.log(JSON.stringify({ sessions: 24, turnsPerSession: 24, legacyObjects: process.env.BENCH_LEGACY === '1', latencyMs: latency, phases, peakRssKiB: process.resourceUsage().maxRSS }));
} finally { lag.disable(); store.close(); remote.close(); server.close(); await once(server, 'close'); fs.rmSync(root, { recursive: true, force: true }); }
