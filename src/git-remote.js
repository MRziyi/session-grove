import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assert } from './util.js';

export function gitRemote(value, { allowLocal = false } = {}) {
    assert(typeof value === 'string' && value.length < 2048, 'Enter a Git SSH remote.');
    assert(/^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9_./-]+\.git$/.test(value) || allowLocal && path.isAbsolute(value), 'Use git@host:owner/repository.git.');
    assert(!value.includes('..'), 'Invalid Git remote.');
    return value;
}

// Dedicated application checkout: never run Git in a user's source repository.
export class GitRemote {
    constructor(directory, url, onProgress = () => {}) {
        this.directory = directory; this.url = url; this.onProgress = onProgress;
        this.controller = new AbortController();
    }
    async run(args, { accepted = [0], progress = false } = {}) {
        this.controller.signal.throwIfAborted();
        return new Promise((resolve, reject) => {
            const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.quotePath=false', '-c', 'core.pager=cat', ...args], {
                cwd: this.directory, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15', GIT_CONFIG_NOSYSTEM: '1' },
                stdio: ['ignore', 'pipe', 'pipe'], signal: this.controller.signal,
            });
            let stdout = '', stderr = '', progressBuffer = '', settled = false, phase = '', phaseStarted = Date.now();
            const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60 * 1000); timer.unref();
            child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 32 * 1024 * 1024) child.kill(); });
            child.stderr.on('data', chunk => {
                stderr = (stderr + chunk).slice(-16384);
                if (progress) {
                    progressBuffer += chunk.toString();
                    const lines = progressBuffer.split(/[\r\n]/); progressBuffer = lines.pop();
                    for (const line of lines) {
                    const match = line.match(/(Receiving objects|Writing objects|Resolving deltas|Counting objects|Compressing objects):\s+(\d+)%\s+\((\d+)\/(\d+)\)/);
                    if (match) {
                        if (phase !== match[1]) { phase = match[1]; phaseStarted = Date.now(); }
                        const completed = Number(match[3]), total = Number(match[4]), elapsed = (Date.now() - phaseStarted) / 1000;
                        const speed = line.match(/([\d.]+) (bytes|[KMG]iB)\/s/), unit = {bytes:1,KiB:1024,MiB:1048576,GiB:1073741824};
                        this.onProgress({ phase, completed, total, etaSeconds: completed && elapsed >= 1 ? Math.ceil(elapsed / completed * (total - completed)) : null, rateBytesPerSecond: speed ? Number(speed[1]) * unit[speed[2]] : null });
                    }
                  }
                }
            });
            child.on('error', e => { settled = true; clearTimeout(timer); reject(e); });
            child.on('close', code => { clearTimeout(timer); if (settled) return; if (accepted.includes(code)) resolve({ stdout: stdout.trim(), code }); else reject(Object.assign(new Error('Git ' + args[0] + ' failed: ' + (stderr.trim() || 'process interrupted')), { gitExitCode: code })); });
        });
    }
    async init() {
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        if (!fs.existsSync(path.join(this.directory, '.git'))) await this.run(['init', '-b', 'main']);
        await this.run(['config', 'user.name', 'Session Grove']);
        await this.run(['config', 'user.email', 'grove@localhost']);
        await this.run(['config', 'core.autocrlf', 'false']);
        await this.run(['config', 'remote.origin.url', this.url]);
    }
    async fetch() {
        // Exit 2 means there is no main branch, not a connection/authentication failure.
        const remote = await this.run(['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], { accepted: [0, 2] });
        if (remote.code === 2) {
            const refs = await this.run(['ls-remote', 'origin']);
            assert(!refs.stdout, 'Data repository must be empty or use a Grove main branch.');
            const previous = await this.run(['rev-parse', '--verify', 'refs/remotes/origin/main'], { accepted: [0, 128] });
            assert(previous.code !== 0, 'Remote main disappeared. Reconnect using a new data repository.');
            this.head = null; return;
        }
        await this.run(['fetch', '--progress', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { progress: true });
        const marker = await this.run(['show', 'refs/remotes/origin/main:grove.json']);
        const format = JSON.parse(marker.stdout);
        assert(format.format === 'session-grove-git' && format.schema === 1, 'This repository is not a Grove data repository.');
        const files = await this.run(['ls-tree', '-r', 'refs/remotes/origin/main']);
        assert(files.stdout.split('\n').every(line => !line || /^100644 blob [a-f0-9]+\t(?:grove\.json|trash\.json|trees\/[a-f0-9]{64}\/(?:index\.json|graph\.json|records\/[0-9]{6}\.jsonl))$/.test(line)), 'Unexpected file or link in Git data repository.');
        await this.run(['reset', '--hard', 'refs/remotes/origin/main']);
        // Only the dedicated application cache is cleaned, never native/source files.
        await this.run(['clean', '-fd']);
        this.head = (await this.run(['rev-parse', 'HEAD'])).stdout;
    }
    async commitAndPush() {
        await this.run(['add', '--all']);
        const diff = await this.run(['diff', '--cached', '--quiet'], { accepted: [0, 1] });
        if (diff.code) await this.run(['commit', '-m', 'Update Grove sessions']);
        // Normal fast-forward push is our concurrency check. Never force-push.
        await this.run(['push', '--progress', 'origin', 'HEAD:refs/heads/main'], { progress: true });
        this.head = (await this.run(['rev-parse', 'HEAD'])).stdout;
    }
}
