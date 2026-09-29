// Synthetic live-provider check, restricted to one newly created child folder.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Cloud } from '../src/cloud.js';
import { stageTrash, restoreTrash, cleanupLocal } from '../src/trash.js';
import { collectTrash } from '../src/cloud-trash.js';
import { codexSample } from '../src/demo.js';
import { VERSION } from '../src/version.js';
const config = JSON.parse(
        fs.readFileSync(
            process.argv[2] || path.join(os.homedir(), '.session-grove/webdav.json'),
            'utf8',
        ),
    ),
    base = new URL(config.url);
assert(
    base.protocol === 'https:' && base.pathname.endsWith('/Session-Grove/'),
    'Use the dedicated Session-Grove folder.',
);
const folder = 'self-check-trash-' + Date.now() + '-' + randomBytes(4).toString('hex'),
    target = new URL(folder + '/', base).href,
    auth = 'Basic ' + Buffer.from(config.username + ':' + config.password).toString('base64'),
    remote = async (method) => {
        const r = await fetch(target, {
            method,
            headers: { Authorization: auth },
            signal: AbortSignal.timeout(30000),
        });
        await r.arrayBuffer();
        return r;
    };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-trash-provider-')),
    a = new Store(path.join(root, 'a')),
    b = new Store(path.join(root, 'offline')),
    connection = { ...config, url: target },
    cloudA = new Cloud(a, () => connection),
    cloudB = new Cloud(b, () => connection),
    pass = 'synthetic-trash-check-key',
    report = { version: VERSION, checks: {}, cleaned: false };
let created = false;
const start = performance.now();
try {
    assert.equal((await remote('MKCOL')).status, 201);
    created = true;
    const parent = a.branch(
            null,
            'Synthetic discarded path',
            'codex',
            codexSample(root, [
                ['Shared prefix', 'Keep'],
                ['Unique discarded suffix', 'Remove'],
            ]),
        ),
        child = a.fork(parent.id, {
            name: 'Synthetic kept path',
            end: a.detail(parent.id).checkpoints[0].end,
        });
    await cloudA.publish([parent.id], pass);
    await cloudB.catalog(pass);
    for (const p of cloudB.summaries()) await cloudB.project(p.id, pass);
    await cloudB.hydrate(parent.id, pass);
    report.checks.uploadAndDownload = true;
    const raw = a.raw(child.head),
        entry = stageTrash(a, [parent.id]);
    cleanupLocal(a);
    await collectTrash(cloudA, pass);
    report.checks.collectionLockAndCleanup = true;
    assert.equal(a.raw(child.head), raw);
    report.checks.sharedPrefixPreserved = true;
    await cloudB.catalog(pass);
    for (const p of cloudB.summaries()) await cloudB.project(p.id, pass);
    await cloudB.hydrate(parent.id, pass);
    cleanupLocal(b);
    assert.equal(b.collections().items[0].sessions.length, 1);
    assert.equal(b.raw(b.get('branch', child.id).head), raw);
    report.checks.offlineDeviceReconciled = true;
    assert.ok(
        !b.db.prepare("SELECT 1 FROM objects WHERE body LIKE '%Unique discarded suffix%'").get(),
    );
    report.checks.remoteCachePurged = true;
    const restored = restoreTrash(a, entry.id);
    await cloudA.publish(restored.branchIds, pass);
    report.checks.localRecoveryRepublished = true;
} catch (e) {
    report.error = [config.password, config.username, pass]
        .filter(Boolean)
        .reduce((s, v) => s.split(v).join('[redacted]'), e.message);
    process.exitCode = 1;
} finally {
    a.close();
    b.close();
    fs.rmSync(root, { recursive: true, force: true });
    if (created) {
        try {
            assert.ok((await remote('DELETE')).ok);
            report.cleaned = true;
        } catch {
            report.cleanupRequired = folder;
            process.exitCode = 1;
        }
    }
    report.wallMs = Math.round(performance.now() - start);
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/trash-provider.json', JSON.stringify(report, null, 2), {
        mode: 0o600,
    });
    console.log(JSON.stringify(report));
}
