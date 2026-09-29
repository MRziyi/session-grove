#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { seedDemo } from '../src/demo.js';
import { controlService } from '../src/service.js';
const args = process.argv.slice(2);
if (args.includes('--help')) {
    console.log(`Session Grove\n\nnode bin/session-grove.js [status|stop] [--demo] [--port 7421] [--data-dir PATH]\n  --codex-home PATH   Codex native store (default CODEX_HOME or ~/.codex)\n  --claude-home PATH  Claude native store (default CLAUDE_CONFIG_DIR or ~/.claude)\n  --sync-key-file PATH  Optional private file for unattended sync unlock\n\n--demo uses isolated sample sessions and never reads personal session directories.`);
    process.exit(0);
}
const value = (key, fallback) => {
    const i = args.indexOf(key);
    if (i === -1)
        return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error(`${key} requires a value`);
    return args[i + 1];
};
const demo = args.includes('--demo');
const root = path.resolve(value('--data-dir', demo ? '.grove/demo' : path.join(os.homedir(), '.session-grove')));
if (['status', 'stop'].includes(args[0])) {
    await controlService(root, args[0]);
    process.exit(0);
}
if (args.includes('--background')) {
    fs.mkdirSync(path.join(root,'logs'),{recursive:true,mode:0o700});
    const output=fs.openSync(path.join(root,'logs','server.log'),'a',0o600);
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),...args.filter(a=>a!=='--background')],{detached:true,stdio:['ignore',output,output]});
    child.unref();fs.closeSync(output);
    let ready=false;
    for(let n=0;n<300;n++){try{const info=JSON.parse(fs.readFileSync(path.join(root,'server.json'),'utf8'));if(info.pid===child.pid){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}
    if(!ready)throw new Error('Background start failed; see '+path.join(root,'logs','server.log'));
    await controlService(root,'status');process.exit(0);
}
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const lock = path.join(root, 'server.lock');
const infoFile = path.join(root, 'server.json');
try {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    try {
        process.kill(pid, 0);
        throw new Error('此资料库已有服务运行');
    }
    catch (e) {
        if (e.code !== 'ESRCH')
            throw e;
    }
    fs.rmSync(lock);
}
catch (e) {
    if (e.code !== 'ENOENT')
        throw e;
}
fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
const roots = demo ? { codex: path.join(root, 'native/codex'), claude: path.join(root, 'native/claude') } : { codex: path.resolve(value('--codex-home', process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))), claude: path.resolve(value('--claude-home', process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'))) };
const app = createApp({ root, roots, demo, guard: demo ? () => { } : undefined });
if (demo) {
    seedDemo(app.store, roots);
    app.native.refreshLocal();
}
const keyFile = value('--sync-key-file', null);
if (keyFile) {
    const file = path.resolve(keyFile);
    if (fs.statSync(file).mode & 0o077) throw new Error('Sync key file must have owner-only permissions.');
    app.autoSync.unlock(fs.readFileSync(file, 'utf8').replace(/\r?\n$/, ''));
}
const port = Number(value('--port', '7421'));
if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid port');
app.server.listen(port, '127.0.0.1', () => {
    fs.writeFileSync(infoFile, JSON.stringify({ pid: process.pid, port: app.server.address().port, instance: app.instance, token: app.token }), { mode: 0o600 });
    console.log(`Session Grove${demo ? ' · isolated demo' : ''}\nhttp://127.0.0.1:${app.server.address().port}\nLibrary: ${root}`);
});
app.server.on('error', e => { console.error(e.message); process.exitCode = 1; app.close(); });
process.on('exit', () => {
    try {
        if (fs.readFileSync(lock, 'utf8') === String(process.pid)) {
            fs.rmSync(lock);
            fs.rmSync(infoFile, { force: true });
        }
    }
    catch { }
});
let stopping = false;
function shutdown() {
    if (stopping) return;
    stopping = true;
    console.log('Stopping Session Grove…');
    app.quiesce();
    // Native writes are synchronous and journalled. Cloud publication and settings
    // migration retain recovery state if a stalled network exceeds this deadline.
    setTimeout(() => { console.error('Shutdown deadline reached; recovery state retained.'); process.exit(0); }, 10000).unref();
    Promise.allSettled([app.settings.pending, app.autoSync.pending]).then(() => app.close(() => process.exit(0)));
}
app.onStop = shutdown;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
