import fs from 'node:fs';
import path from 'node:path';

export async function controlService(root, action) {
    let info;
    try { info = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8')); }
    catch (e) {
        if (e.code !== 'ENOENT') throw e;
        if (fs.existsSync(path.join(root, 'server.lock'))) throw new Error('An older server owns this library. Stop that PID once, then start the updated server.');
        console.log('Session Grove is stopped.'); return;
    }
    const base = `http://127.0.0.1:${info.port}`;
    let state;
    try { state = await fetch(base + '/api/service', { signal: AbortSignal.timeout(60000) }).then(r => r.json()); }
    catch { throw new Error('Server is unavailable; saved PID ' + info.pid + '. No process was killed.'); }
    if (state.pid !== info.pid || state.instance !== info.instance) throw new Error('Server identity changed. No process was killed.');
    if (action === 'status') { console.log(`Session Grove is running (PID ${info.pid})\n${base}\nLibrary: ${root}`); return; }
    const response = await fetch(base + '/api/service/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Grove-Token': info.token }, body: '{}', signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Server rejected stop: ' + response.status);
    console.log('Stopping Session Grove; outstanding work has up to 10 seconds to finish.');
}
