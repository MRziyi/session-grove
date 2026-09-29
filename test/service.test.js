import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';

test('CLI status and stop identify the server and close a live event stream', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-service-'));
    const cli = path.resolve('bin/session-grove.js');
    const child = spawn(process.execPath, [cli, '--demo', '--port', '0', '--data-dir', root], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let output = ''; child.stdout.on('data', c => output += c); child.stderr.resume();
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); fs.rmSync(root, { recursive: true, force: true }); });
    for (let tries = 0; tries < 200 && (!fs.existsSync(path.join(root, 'server.json')) || !output.includes('Session Grove')); tries++) await new Promise(r => setTimeout(r, 25));
    assert.match(output, /Session Grove/);
    const info = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
    assert.equal(fs.statSync(path.join(root, 'server.json')).mode & 0o077, 0);
    const base = 'http://127.0.0.1:' + info.port;
    const stream = await fetch(base + '/api/events', { headers: { 'X-Grove-Token': info.token } });
    const ended = stream.text();
    assert.match(execFileSync(process.execPath, [cli, 'status', '--data-dir', root], { encoding: 'utf8' }), /running/);
    assert.match(execFileSync(process.execPath, [cli, 'stop', '--data-dir', root], { encoding: 'utf8' }), /Stopping/);
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    const [code] = await exited; clearTimeout(timer); await ended;
    assert.equal(code, 0); assert.equal(fs.existsSync(path.join(root, 'server.lock')), false);
    assert.match(execFileSync(process.execPath, [cli, 'status', '--data-dir', root], { encoding: 'utf8' }), /stopped/);
});
