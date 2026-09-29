import { hash, assert, mapConcurrent } from './util.js';
import { sealAsync, unseal } from './sync.js';
const digest = v => hash(JSON.stringify(v));
const validHash = h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h);
export async function uploadPacks(store, dav, key, refs, cache, save, progress) {
    const wanted = new Set(refs), singles = new Set(cache.uploadedObjects || []);
    const reused = (cache.packs || []).filter(p => p.refs.every(h => wanted.has(h)));
    const covered = new Set([...singles, ...reused.flatMap(p => p.refs)]);
    const pending = refs.filter(h => !covered.has(h)).sort(), packs = [...reused];
    let completed = 0, batch = {}, bytes = 0, transferredBytes = 0, failure = null, sinceSave = 0;
    const total = pending.length, started = Date.now(), inFlight = new Set();
    const send = async value => {
        const ref = digest(value), descriptor = { ref, refs: Object.keys(value.objects), bytes: Buffer.byteLength(JSON.stringify(value)) };
        let sealed = await sealAsync(value, key); descriptor.wireBytes = sealed.length; value = null;
        await dav.put('objects/' + ref + '.bin', sealed, true); sealed = null;
        const received = await dav.get('objects/' + ref + '.bin', descriptor.wireBytes);
        assert(received && digest(unseal(received, key)) === ref, 'Uploaded record pack failed read-back verification.');
        cache.packs ||= []; if (!cache.packs.some(p => p.ref === ref)) cache.packs.push(descriptor);
        packs.push(descriptor); completed += descriptor.refs.length; transferredBytes += descriptor.bytes;
        if (++sinceSave >= 4) { save(); sinceSave = 0; }
        progress(completed, total, started, { bytes: transferredBytes, requestsSaved: Math.max(0, completed - packs.length) });
    };
    const stage = async () => {
        if (!Object.keys(batch).length) return;
        const value = { schema: 'grove-record-pack-1', objects: batch }; batch = {}; bytes = 0;
        const work = send(value).catch(e => { failure ||= e; }).finally(() => inFlight.delete(work));
        inFlight.add(work);
        // Keep all four slots useful: a large pack must not hold a wave barrier
        // while the other three slots sit idle.
        if (inFlight.size >= 4) await Promise.race(inFlight);
        if (failure) throw failure;
    };
    try {
        for (const h of pending) {
            if (failure) throw failure;
            const body = store.objectStatement.get(h)?.body; assert(typeof body === 'string', 'Missing local transcript.');
            const size = Buffer.byteLength(body);
            if (bytes && (bytes + size > 2 * 1024 * 1024 || Object.keys(batch).length >= 256)) await stage();
            batch[h] = body; bytes += size;
        }
        await stage(); await Promise.all(inFlight); if (failure) throw failure;
    } finally { await Promise.all(inFlight); save(); }
    return { packs, uploaded: pending.length };
}
export async function downloadRecords(store, dav, key, graph, progress, onKnown = () => {}) {
    const refs = [...new Set(graph.revisions.flatMap(r => r.refs))], wanted = new Set(refs);
    const exists = store.db.prepare('SELECT 1 FROM objects WHERE hash=?');
    const missing = new Set(refs.filter(h => !exists.get(h))), packed = new Set();
    let completed = 0, buffer = {}, bytes = 0; const total = missing.size, started = Date.now();
    const checkpoint = () => { if (!Object.keys(buffer).length) return; store.transaction(() => { for (const [h, body] of Object.entries(buffer)) store.insertObject.run(h, body); }); buffer = {}; bytes = 0; };
    const accept = (h, body) => { assert(validHash(h) && typeof body === 'string' && hash(body) === h, 'Transcript integrity check failed.'); if (!missing.delete(h)) return; buffer[h] = body; bytes += Buffer.byteLength(body); completed++; if (bytes >= 4 * 1024 * 1024 || Object.keys(buffer).length >= 128) checkpoint(); progress(completed, total, started); };
    try {
        const packs = (graph.packs || []).filter(p => p.refs?.some(h => missing.has(h)));
        await mapConcurrent(packs, async p => {
            assert(validHash(p.ref) && Array.isArray(p.refs) && p.refs.every(h => validHash(h) && wanted.has(h)), 'Invalid record pack descriptor.');
            const blob = await dav.get('objects/' + p.ref + '.bin', p.wireBytes || p.bytes); assert(blob, 'Cloud record pack is missing.');
            const value = unseal(blob, key); assert(digest(value) === p.ref && value.schema === 'grove-record-pack-1' && value.objects && !Array.isArray(value.objects), 'Record pack integrity check failed.');
            assert(JSON.stringify(Object.keys(value.objects).sort()) === JSON.stringify([...p.refs].sort()), 'Record pack membership differs.');
            for (const h of p.refs) { accept(h, value.objects[h]); packed.add(h); }
            onKnown(p);
        });
        await mapConcurrent([...missing], async h => { assert(validHash(h), 'Invalid transcript reference.'); const blob = await dav.get('objects/' + h + '.bin'); assert(blob, 'Cloud transcript is incomplete.'); accept(h, unseal(blob, key)); });
    } finally { checkpoint(); }
    return { records: total, packed: packed.size };
}
