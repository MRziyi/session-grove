// The official file-only SDK handles branch selection, compaction, queued
// messages, synthetic attachment messages and native UUID remapping. No query()
// or agent subprocess is used here.
import { workerData } from 'node:worker_threads';

const { port } = workerData;
port.on('message', async ({ raw, action, options, signal }) => {
    const done = new Int32Array(signal);
    try {
        const {getSessionMessages,forkSession}=await import('@anthropic-ai/claude-agent-sdk');
        const rows = raw.split('\n').filter(line => line.trim()).map(JSON.parse);
        const sessionId = rows.find(r => r.sessionId)?.sessionId;
        let forked;
        const sessionStore = { load: async () => rows, append: async (_key, entries) => { forked = entries; } };
        const value = action === 'fork'
            ? (await forkSession(sessionId, { ...options, sessionStore }), forked)
            : await getSessionMessages(sessionId, { sessionStore });
        port.postMessage({ value });
    } catch (e) { port.postMessage({ error: e.message }); }
    finally { Atomics.store(done, 0, 1); Atomics.notify(done, 0); }
});
