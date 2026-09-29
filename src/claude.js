import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { hash, assert } from './util.js';
let worker, port;
const cache = new Map();
let cacheBytes = 0;
function call(raw, action, options = {}) {
    if (!worker) {
        const channel = new MessageChannel(); port = channel.port1;
        worker = new Worker(new URL('./claude-worker.js', import.meta.url), { workerData: { port: channel.port2 }, transferList: [channel.port2], execArgv: [] });
        worker.on('error', () => {}); worker.unref(); port.unref();
    }
    const signal = new SharedArrayBuffer(4), state = new Int32Array(signal);
    port.postMessage({ raw, action, options, signal });
    if (Atomics.wait(state, 0, 0, 30000) === 'timed-out') {
        worker.terminate(); worker = null; port.close();
        throw new Error('Claude session parser timed out.');
    }
    const result = receiveMessageOnPort(port)?.message;
    assert(result && !result.error, result?.error || 'Claude session parser failed.');
    return result.value;
}
export function claudeMessages(raw) {
    const key = hash(raw);
    if (cache.has(key)) return cache.get(key).value;
    const value = call(raw, 'read');
    // Large transcripts remain owned by the Store's bounded parsing cache.
    const size = Buffer.byteLength(raw);
    while (cache.size && (cache.size >= 4 || cacheBytes + size > 16 * 1024 * 1024)) { const oldest = cache.keys().next().value; cacheBytes -= cache.get(oldest).size; cache.delete(oldest); }
    if (size <= 16 * 1024 * 1024) { cache.set(key, { value, size }); cacheBytes += size; }
    return value;
}
export function claudeFork(raw, title, upToMessageId) {
    return call(raw, 'fork', { title, ...(upToMessageId ? { upToMessageId } : {}) });
}
