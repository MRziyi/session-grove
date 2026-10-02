import { spawn } from 'node:child_process';
import { once } from 'node:events';
export function connect(executable, nativeHome, {onNotification=()=>{}} = {}) {
    const child = spawn(executable, ['app-server', '--stdio'], { env: { PATH: process.env.PATH, ...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP}:{}), CODEX_HOME: nativeHome }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let n = 0, buffer = '', stderr = '';
    const pending = new Map();
    child.stderr.on('data', c => stderr = (stderr + c.toString()).slice(-3000));
    child.stdout.on('data', c => { buffer += c; let index; while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
            const m = JSON.parse(line), p = pending.get(m.id);
            if(m.method&&!Object.hasOwn(m,'id'))onNotification(m);
            if (p) {
                clearTimeout(p.timer);
                pending.delete(m.id);
                m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
            }
        }
        catch { }
    } });
    child.on('error', e => { for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(e);
    } pending.clear(); });
    child.on('exit', () => { for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Codex exited: ' + stderr));
    } pending.clear(); });
    const request = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n, timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout: ' + method + ' ' + stderr)); }, 15000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
    const init = async () => { await request('initialize', { clientInfo: { name: 'session_grove_smoke', version: '0.7.1' }, capabilities: { experimentalApi: true } }); child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'); };
    let closing;
    const close = () => closing ||= (async () => { if (child.exitCode === null && child.signalCode === null) {
        const exited=once(child, 'exit'); child.kill(); await exited;
    } })();
    return { request, init, close };
}
