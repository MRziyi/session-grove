#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createApp } from '../src/server.js';
import { seedDemo } from '../src/demo.js';
const args = process.argv.slice(2);
if (args.includes('--help')) {
    console.log(`Session Grove\n\nnode bin/session-grove.js [--demo] [--port 7421] [--data-dir PATH]\n  --codex-home PATH   Codex native store (default CODEX_HOME or ~/.codex)\n  --claude-home PATH  Claude native store (default CLAUDE_CONFIG_DIR or ~/.claude)\n  --sync-key-file PATH  Optional private file for unattended sync unlock\n\n--demo uses isolated sample sessions and never reads personal session directories.`);
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
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const lock = path.join(root, 'server.lock');
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
    console.log(`Session Grove${demo ? ' · isolated demo' : ''}\nhttp://127.0.0.1:${app.server.address().port}\nLibrary: ${root}`);
    if (app.autoSync.passphrase !== null) app.autoSync.flush('pull').then(() => app.autoSync.flush('queued')).catch(() => {});
});
app.server.on('error', e => { console.error(e.message); process.exitCode = 1; app.server.close(); });
process.on('exit', () => {
    try {
        if (fs.readFileSync(lock, 'utf8') === String(process.pid))
            fs.rmSync(lock);
    }
    catch { }
});
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => { await app.settings.pending; await app.autoSync.pending?.catch(() => {}); app.server.close(() => process.exit(0)); });
