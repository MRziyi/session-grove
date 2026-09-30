import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { Cloud } from '../src/cloud.js';
import { Native } from '../src/native.js';
import { stageTrash, restoreTrash, expireTrash, cleanupLocal, isTrashed } from '../src/trash.js';
import { collectTrash, resumeTrashCleanup, transferCachePath } from '../src/cloud-trash.js';
import { codexSample, claudeSample, codexTurn } from '../src/demo.js';
import { hash } from '../src/util.js';
import { bodyRefs } from '../src/retention.js';
import { savePreferences } from '../src/preferences.js';
async function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-trash-test-')),
        files = new Map();
    let locked = false,
        failDelete = false;
    const server = http.createServer(async (req, res) => {
        const key = decodeURIComponent(req.url),
            chunks = [];
        for await (const c of req) chunks.push(c);
        const send = (n, b = '') => {
            res.writeHead(n);
            res.end(b);
        };
        if (req.method === 'LOCK') {
            if (locked && !req.headers.if) return send(423);
            locked = true;
            res.writeHead(200, { 'Lock-Token': '<opaquelocktoken:root>' });
            return res.end();
        }
        if (req.method === 'UNLOCK') {
            locked = false;
            return send(204);
        }
        if (
            !['GET', 'HEAD', 'PROPFIND'].includes(req.method) &&
            locked &&
            !req.headers.if?.includes('(<opaquelocktoken:root>)')
        )
            return send(423);
        if (req.method === 'MKCOL') return send(201);
        if (req.method === 'PUT') {
            if (req.headers['if-none-match'] === '*' && files.has(key)) return send(412);
            files.set(key, Buffer.concat(chunks));
            return send(201);
        }
        if (req.method === 'DELETE') {
            if (failDelete && !key.includes('migration.json') && !key.includes('trash-lock-probe'))
                return send(500);
            for (const k of files.keys())
                if (k === key || (key.endsWith('/') && k.startsWith(key))) files.delete(k);
            return send(204);
        }
        if (req.method === 'PROPFIND')
            return send(
                207,
                '<d:multistatus xmlns:d="DAV:">' +
                    [...files.keys()]
                        .filter((k) => k.startsWith(key) && !k.slice(key.length).includes('/'))
                        .map((k) => '<d:response><d:href>' + k + '</d:href></d:response>')
                        .join('') +
                    '</d:multistatus>',
            );
        return files.has(key) ? send(200, req.method === 'HEAD' ? '' : files.get(key)) : send(404);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const stores = [],
        config = {
            url: 'http://127.0.0.1:' + server.address().port + '/Session-Grove/',
            username: 'fixture',
            password: 'fixture',
        },
        pass = 'synthetic-retention-pass';
    const device = (name) => {
        const store = new Store(path.join(root, name));
        stores.push(store);
        return { store, cloud: new Cloud(store, () => config) };
    };
    t.after(async () => {
        for (const s of stores) s.close();
        server.close();
        await once(server, 'close');
        fs.rmSync(root, { recursive: true, force: true });
    });
    return { root, files, device, pass, config, failDelete: (v) => (failDelete = v) };
}

test('cleanup reuses verified local records without downloading old cloud packs', async t => {
    const e = await setup(t), a = e.device('local-reuse');
    const keep = a.store.branch(null, 'Keep', 'codex', codexSample('/work', [['Question', 'Answer']]));
    const remove = a.store.branch(null, 'Remove', 'claude', claudeSample('/work', [['Discard', 'Done']]));
    await a.cloud.publish([keep.id, remove.id], e.pass);
    const dav = a.cloud.connection.dav, base = dav.base, get = dav.get; let oldObjectGets = 0;
    dav.get = function(key, ...args) { if (this.base === base && key.startsWith('objects/')) oldObjectGets++; return get.call(this, key, ...args); };
    stageTrash(a.store, [remove.id], [remove.id]);
    await collectTrash(a.cloud, e.pass);
    assert.equal(oldObjectGets, 0);
    const b = e.device('local-reuse-reader'); await b.cloud.catalog(e.pass);
    for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    await b.cloud.hydrate(keep.id, e.pass);
    assert.equal(b.store.raw(b.store.get('branch', keep.id).head), a.store.raw(keep.head));
});

test('Trash discards only a suffix, fences old clients, reclaims old objects and blocks stale-device resurrection', async (t) => {
    const e = await setup(t),
        a = e.device('a'),
        b = e.device('offline');
    const parent = a.store.branch(
        null,
        'Discard this ending',
        'codex',
        codexSample(e.root, [
            ['Shared context', 'Keep it'],
            ['Discard unique question', 'Discard unique response'],
        ]),
    );
    const fork = a.store.fork(parent.id, {
        name: 'Kept path',
        end: a.store.detail(parent.id).checkpoints[0].end,
    });
    await a.cloud.publish([parent.id], e.pass);
    await b.cloud.catalog(e.pass);
    for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    await b.cloud.hydrate(parent.id, e.pass);
    const original = a.store.raw(fork.head),
        oldKeys = [...e.files.keys()].filter((k) => /\/(objects|trees|heads|projects)\//.test(k));
    const entry = stageTrash(a.store, [parent.id]);
    cleanupLocal(a.store);
    assert.equal(a.store.treeGraph(parent.id, 'in-use').paths.length, 1);
    assert.equal(a.store.raw(fork.head), original);
    const result = await collectTrash(a.cloud, e.pass);
    assert.equal(result.cleaned, true);
    assert.ok(oldKeys.every((k) => !e.files.has(k)));
    const vault = JSON.parse([...e.files.entries()].find(([k]) => k.endsWith('/vault.json'))[1]);
    assert.equal(vault.schema, 3);
    assert.equal(a.store.all('branch').find((v) => v.id === parent.id).synthetic, true);
    assert.ok(
        !a.store.db
            .prepare("SELECT 1 FROM objects WHERE body LIKE '%Discard unique response%'")
            .get(),
    );
    await b.cloud.catalog(e.pass);
    assert.equal(isTrashed(b.store, parent.id), true);
    assert.equal(b.store.collections().items[0].sessions.length, 1);
    assert.ok(!b.store.exportGraph().branches.some((v) => v.id === parent.id && !v.synthetic));
    for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    await b.cloud.hydrate(parent.id, e.pass);
    cleanupLocal(b.store);
    assert.equal(b.store.raw(b.store.get('branch', fork.id).head), original);
    assert.ok(
        !b.store.db
            .prepare("SELECT 1 FROM objects WHERE body LIKE '%Discard unique response%'")
            .get(),
    );
    const restored = restoreTrash(a.store, entry.id);
    assert.equal(restored.branchIds.length, 1);
    assert.notEqual(restored.branchIds[0], parent.id);
    assert.match(
        a.store.raw(a.store.get('branch', restored.branchIds[0]).head),
        /Discard unique response/,
    );
    assert.equal(a.store.instances().length, 0);
});

test('whole-tree Trash keeps a local recovery copy only until its configurable expiry', async (t) => {
    const e = await setup(t),
        a = e.device('local');
    savePreferences(a.store, { trashRetentionDays: 7 });
    const b = a.store.branch(
        null,
        'Failed',
        'codex',
        codexSample(e.root, [['Discard me', 'Failed']]),
    );
    const entry = stageTrash(a.store, [b.id], [b.id]);
    cleanupLocal(a.store);
    assert.equal(a.store.collections().items.length, 0);
    assert.equal(a.store.exportGraph().branches.length, 0);
    assert.equal(a.store.db.prepare('SELECT count(*) n FROM objects').get().n, 0);
    assert.ok(fs.existsSync(path.join(a.store.root, 'trash', entry.id + '.json.gz')));
    expireTrash(a.store, Date.parse(entry.expiresAt) + 1);
    assert.ok(!fs.existsSync(path.join(a.store.root, 'trash', entry.id + '.json.gz')));
    assert.throws(() => restoreTrash(a.store, entry.id), /expired/);
});

test('cleanup retries after publication without deleting the new generation or losing live data', async (t) => {
    const e = await setup(t),
        a = e.device('retry'),
        keep = a.store.branch(null, 'Keep', 'codex', codexSample(e.root, [['Keep', 'Yes']])),
        drop = a.store.branch(null, 'Drop', 'codex', codexSample(e.root, [['Drop', 'No']]));
    await a.cloud.publish([keep.id, drop.id], e.pass);
    stageTrash(a.store, [drop.id], [drop.id]);
    e.failDelete(true);
    await assert.rejects(collectTrash(a.cloud, e.pass));
    assert.ok(fs.existsSync(path.join(a.store.root, 'trash-cleanup.json')));
    e.failDelete(false);
    await resumeTrashCleanup(a.cloud, e.pass);
    assert.ok(!fs.existsSync(path.join(a.store.root, 'trash-cleanup.json')));
    const other = e.device('after');
    await other.cloud.catalog(e.pass);
    for (const p of other.cloud.summaries()) await other.cloud.project(p.id, e.pass);
    assert.equal(other.cloud.items().length, 1);
    await other.cloud.hydrate(keep.id, e.pass);
    assert.equal(other.store.raw(other.store.get('branch', keep.id).head), a.store.raw(keep.head));
});

test('Claude fork retains native metadata after a trashed parent checkpoint while discarding its conversation suffix', async (t) => {
    const e = await setup(t),
        a = e.device('claude');
    const rows = claudeSample(e.root, [
        ['Shared Claude context', 'Ready'],
        ['Discard Claude suffix', 'Bad answer'],
    ])
        .trim()
        .split('\n')
        .map(JSON.parse);
    rows.push({
        type: 'atis-latch',
        sessionId: rows[0].sessionId,
        atis: 'required-native-metadata',
    });
    const parent = a.store.branch(
            null,
            'Parent',
            'claude',
            rows.map((r) => JSON.stringify(r) + '\n').join(''),
        ),
        child = a.store.fork(parent.id, {
            name: 'Keep fork',
            end: a.store.detail(parent.id).checkpoints[0].end,
        });
    await a.cloud.publish([parent.id], e.pass);
    stageTrash(a.store, [parent.id]);
    cleanupLocal(a.store);
    await collectTrash(a.cloud, e.pass);
    assert.ok(!a.store.db.prepare("SELECT 1 FROM objects WHERE body LIKE '%Bad answer%'").get());
    assert.ok(
        a.store.db
            .prepare("SELECT 1 FROM objects WHERE body LIKE '%required-native-metadata%'")
            .get(),
    );
    const native = new Native(a.store, {
        roots: { codex: path.join(e.root, 'codex'), claude: path.join(e.root, 'claude-native') },
        guard: () => {},
    });
    native.setActive(child.id, e.root, true);
    native.apply([child.id]);
    const file = a.store.instances().find((i) => i.branchId === child.id).file;
    assert.match(fs.readFileSync(file, 'utf8'), /required-native-metadata/);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Bad answer/);
});

test('an offline divergent edit is kept locally for recovery but cannot resurrect its deleted identity', async (t) => {
    const e = await setup(t),
        a = e.device('delete'),
        b = e.device('offline-edit');
    const s = a.store.branch(
        null,
        'Old identity',
        'codex',
        codexSample(e.root, [['Original', 'Done']]),
    );
    await a.cloud.publish([s.id], e.pass);
    await b.cloud.catalog(e.pass);
    for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    await b.cloud.hydrate(s.id, e.pass);
    b.store.ingest(
        s.id,
        b.store.raw(s.head) +
            codexTurn('Unsynced new work', 'Must survive locally')
                .map((v) => JSON.stringify(v) + '\n')
                .join(''),
        s.head,
        {},
    );
    stageTrash(a.store, [s.id], [s.id]);
    await collectTrash(a.cloud, e.pass);
    await b.cloud.catalog(e.pass);
    cleanupLocal(b.store);
    assert.equal(b.store.collections().items.length, 0);
    const rescue = b.store.local('trashEntries').find((e) => e.rescueFor);
    assert.ok(rescue);
    assert.equal((b.store.local('trashPending') || []).length, 0);
    assert.equal(b.cloud.dirtyIds().length, 0);
    const restored = restoreTrash(b.store, rescue.id);
    assert.match(
        b.store.raw(b.store.get('branch', restored.branchIds[0]).head),
        /Unsynced new work/,
    );
    assert.notEqual(restored.branchIds[0], s.id);
});

test('legacy archives are kept unless explicitly selected for Trash, and shared layout survives', async (t) => {
    const e = await setup(t),
        a = e.device('archives');
    const keep = a.store.branch(
        null,
        'Previous archive',
        'codex',
        codexSample(e.root, [['Historical reference', 'Kept']]),
    );
    a.store.edit(keep.id, { archived: true });
    const drop = a.store.branch(null, 'Junk', 'codex', codexSample(e.root, [['Junk', 'Discard']]));
    await a.cloud.publish([keep.id, drop.id], e.pass);
    stageTrash(a.store, [drop.id], [drop.id]);
    await collectTrash(a.cloud, e.pass);
    assert.ok(a.store.get('branch', keep.id).archived);
    assert.match(a.store.raw(keep.head), /Historical reference/);
    const other = e.device('archive-reader');
    await other.cloud.catalog(e.pass);
    for (const p of other.cloud.summaries()) await other.cloud.project(p.id, e.pass);
    assert.ok(other.cloud.items().some((i) => i.id === keep.id));
});

test('failed native cleanup preserves a changed copy and successful cleanup removes only its target', async (t) => {
    const e = await setup(t),
        a = e.device('native');
    const { removeTrashNativeCopies } = await import('../src/trash-native.js');
    const b = a.store.branch(null, 'Discard', 'codex', codexSample(e.root, [['Discard', 'No']]));
    const roots = {
            codex: path.join(e.root, 'native-code'),
            claude: path.join(e.root, 'native-claude'),
        },
        native = new Native(a.store, { roots, guard: () => {} });
    native.setActive(b.id, e.root, true);
    native.apply([b.id]);
    const original = a.store.instances()[0],
        bytes = fs.readFileSync(original.file);
    stageTrash(a.store, [b.id], [b.id]);
    cleanupLocal(a.store);
    fs.appendFileSync(original.file, '\n');
    const blocked = removeTrashNativeCopies(a.store, native, [b.id]);
    assert.equal(blocked.removed, 0);
    assert.equal(blocked.blocked.length, 1);
    assert.ok(fs.existsSync(original.file));
    fs.writeFileSync(original.file, bytes);
    const result = removeTrashNativeCopies(a.store, native, [b.id]);
    assert.equal(result.removed, 1);
    assert.ok(!fs.existsSync(original.file));
    assert.equal(native.refreshLocal().discovered, 0);
});

test('protocol mutation checks reject DAV errors wrapped in HTTP 207 while allowing missing optional properties', async () => {
    const { davSucceeded, assertDavListing } = await import('../src/sync.js');
    const r = { status: 207, ok: true };
    assert.equal(davSucceeded(r, '<d:status>HTTP/1.1 423 Locked</d:status>'), false);
    assert.equal(davSucceeded(r, '<d:status>HTTP/1.1 204 No Content</d:status>'), true);
    assert.throws(
        () => assertDavListing('<d:response><d:status>HTTP/1.1 423 Locked</d:status></d:response>'),
        /423/,
    );
    assert.doesNotThrow(() =>
        assertDavListing(
            '<d:response><d:propstat><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>',
        ),
    );
});

test('finished native journals do not retain duplicate transcript snapshots; unfinished journals remain recoverable', async (t) => {
    const e = await setup(t),
        a = e.device('journals'),
        b = a.store.branch(null, 'Trash', 'codex', codexSample(e.root, [['Remove', 'Done']]));
    const folder = path.join(a.store.root, 'operations');
    fs.mkdirSync(folder);
    const name = '00000000-0000-4000-8000-000000000001.json',
        failed = '00000000-0000-4000-8000-000000000002.json';
    const data = {
        files: [
            {
                path: '/synthetic/session.jsonl',
                content: Buffer.from('transcript-secret').toString('base64'),
                afterHash: 'hash',
            },
        ],
        instancesBefore: [{ baseline: 'transcript-secret' }],
    };
    fs.writeFileSync(path.join(folder, name), JSON.stringify({ ...data, status: 'complete' }));
    fs.writeFileSync(path.join(folder, failed), JSON.stringify({ ...data, status: 'failed' }));
    stageTrash(a.store, [b.id], [b.id]);
    cleanupLocal(a.store);
    const done = JSON.parse(fs.readFileSync(path.join(folder, name)));
    assert.ok(done.backupsPruned);
    assert.equal(done.files[0].content, undefined);
    assert.equal(done.instancesBefore, undefined);
    assert.ok(JSON.parse(fs.readFileSync(path.join(folder, failed))).files[0].content);
});

test('a cached cloud directory cannot make a locally trashed path reappear before Sync', async (t) => {
    const e = await setup(t),
        a = e.device('cached-view'),
        b = a.store.branch(
            null,
            'Cached original',
            'codex',
            codexSample(e.root, [['Cached', 'Discard']]),
        );
    await a.cloud.publish([b.id], e.pass);
    a.cloud.saveDirectory();
    assert.equal(a.cloud.listing('projects').itemCount, 1);
    stageTrash(a.store, [b.id], [b.id]);
    cleanupLocal(a.store);
    assert.equal(a.cloud.listing('projects').itemCount, 0);
    assert.equal(a.cloud.decorate(a.store.snapshot()).items.length, 0);
});

test('already published background archives are not silently discarded by a different Trash operation', async (t) => {
    const e = await setup(t),
        a = e.device('legacy-background');
    const old = a.store.branch(
        null,
        'Legacy archived automation',
        'codex',
        codexSample(e.root, [['Historical automation', 'Previously kept']]),
    );
    a.store.edit(old.id, { archived: true });
    a.store.put('branch', {
        ...a.store.get('branch', old.id),
        background: 'scheduled',
        backgroundManaged: true,
        excluded: 'scheduled',
    });
    a.store.local('preserveRemoteForRetention', [old.id]);
    a.store.invalidate();
    await a.cloud.publish([old.id], e.pass);
    a.store.local('preserveRemoteForRetention', []);
    a.store.invalidate();
    // Simulate the old cloud metadata, which predates the new upload policy.
    const drop = a.store.branch(null, 'Discard', 'codex', codexSample(e.root, [['Discard', 'No']]));
    await a.cloud.publish([drop.id], e.pass);
    stageTrash(a.store, [drop.id], [drop.id]);
    await collectTrash(a.cloud, e.pass);
    const other = e.device('legacy-reader');
    await other.cloud.catalog(e.pass);
    for (const p of other.cloud.summaries()) await other.cloud.project(p.id, e.pass);
    assert.ok(other.cloud.items().some((i) => i.id === old.id));
    await other.cloud.hydrate(old.id, e.pass);
    assert.match(other.store.raw(other.store.get('branch', old.id).head), /Previously kept/);
});

test('cleanup recovery follows a newer completed generation without retaining stale indexes', async (t) => {
    const e = await setup(t),
        a = e.device('first-gc'),
        b = e.device('second-gc');
    const keep = a.store.branch(
            null,
            'Keep',
            'codex',
            codexSample(e.root, [['Keep final', 'Yes']]),
        ),
        one = a.store.branch(null, 'Drop one', 'codex', codexSample(e.root, [['Drop one', 'No']])),
        two = a.store.branch(null, 'Drop two', 'codex', codexSample(e.root, [['Drop two', 'No']]));
    await a.cloud.publish([keep.id, one.id, two.id], e.pass);
    stageTrash(a.store, [one.id], [one.id]);
    e.failDelete(true);
    await assert.rejects(collectTrash(a.cloud, e.pass));
    e.failDelete(false);
    await b.cloud.catalog(e.pass);
    for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    await b.cloud.hydrate(two.id, e.pass);
    stageTrash(b.store, [two.id], [two.id]);
    await collectTrash(b.cloud, e.pass);
    await resumeTrashCleanup(a.cloud, e.pass);
    await a.cloud.catalog(e.pass);
    for (const p of a.cloud.summaries()) await a.cloud.project(p.id, e.pass);
    assert.deepEqual(
        a.cloud.items().map((i) => i.id),
        [keep.id],
    );
    assert.ok(!fs.existsSync(path.join(a.store.root, 'trash-cleanup.json')));
    assert.ok(!a.store.db.prepare("SELECT 1 FROM objects WHERE body LIKE '%Drop two%'").get());
});

test('an unchanged older cache is purged without creating another recovery copy', async (t) => {
    const e = await setup(t),
        a = e.device('newer-source'),
        b = e.device('older-cache'),
        s = a.store.branch(null, 'Session', 'codex', codexSample(e.root, [['Initial', 'Done']]));
    await a.cloud.publish([s.id], e.pass);
    await b.cloud.catalog(e.pass);
    for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    await b.cloud.hydrate(s.id, e.pass);
    assert.equal(b.cloud.dirtyIds().length, 0);
    a.store.ingest(
        s.id,
        a.store.raw(s.head) +
            codexTurn('Newer failed turn', 'Discard')
                .map((v) => JSON.stringify(v) + '\n')
                .join(''),
        s.head,
        {},
    );
    stageTrash(a.store, [s.id], [s.id]);
    await collectTrash(a.cloud, e.pass);
    await b.cloud.catalog(e.pass);
    cleanupLocal(b.store);
    assert.equal((b.store.local('trashEntries') || []).length, 0);
    assert.equal(b.store.db.prepare('SELECT count(*) n FROM objects').get().n, 0);
});

test('shared logical labels remain intact when their parent path is discarded and a recovered path keeps its labels', async (t) => {
    const e = await setup(t),
        a = e.device('labels'),
        parent = a.store.branch(
            null,
            'Parent',
            'codex',
            codexSample(e.root, [
                ['Shared', 'Ready'],
                ['Bad suffix', 'Discard'],
            ]),
        );
    a.store.commitPending(parent.id, {
        name: 'Shared setup',
        revisionId: parent.head,
        expectedStart: 0,
        end: a.store.detail(parent.id).checkpoints[0].end,
    });
    const child = a.store.fork(parent.id, {
        name: 'Kept',
        end: a.store.detail(parent.id).checkpoints[0].end,
    });
    const before = a.store.treeGraph(parent.id);
    assert.ok(before.nodes.some((n) => n.name === 'Shared setup'));
    const entry = stageTrash(a.store, [parent.id]);
    cleanupLocal(a.store);
    assert.ok(a.store.treeGraph(child.id).nodes.some((n) => n.name === 'Shared setup'));
    const restored = restoreTrash(a.store, entry.id);
    assert.ok(
        a.store.treeGraph(restored.branchIds[0]).nodes.some((n) => n.name === 'Shared setup'),
    );
});

test('the collection lease renews while retained context is being prepared', async () => {
    const { withVaultLock } = await import('../src/dav-lock.js');
    let locks = 0;
    const dav = {
        base: 'https://fixture.invalid/Session-Grove/session-grove-v1/',
        collectionLockVerified: true,
        request: async (method) => {
            if (method === 'LOCK') locks++;
            return new Response('', { status: 200, headers: { 'Lock-Token': '<opaquelocktoken:test>', Timeout: 'Second-120' } });
        },
        readResponse: async (r) => Buffer.from(await r.arrayBuffer()),
    };
    await withVaultLock(dav, async (check) => { await new Promise(r => setTimeout(r, 80)); check(); }, { renewMs: 20 });
    assert.ok(locks >= 3);
    assert.equal(dav.lockContext, undefined);
});

test('expired local recovery files are removed on service startup even if local updates are disabled', async t => {
    const e = await setup(t), a = e.device('expiry-startup');
    const b = a.store.branch(null, 'Expired', 'codex', codexSample(e.root, [['Expired', 'Discard']]));
    const entry = stageTrash(a.store, [b.id], [b.id]);
    a.store.local('trashEntries', [{ ...entry, expiresAt: new Date(Date.now() - 1000).toISOString() }]);
    savePreferences(a.store, { localUpdateEnabled: false });
    const { createApp } = await import('../src/server.js');
    const app = createApp({ root: a.store.root, roots: { codex: path.join(e.root, 'empty-codex'), claude: path.join(e.root, 'empty-claude') }, guard: () => {} });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    assert.ok(!fs.existsSync(path.join(a.store.root, 'trash', entry.id + '.json.gz')));
    assert.ok(app.store.local('trashEntries')[0].expired);
    await new Promise(resolve => app.close(resolve));
});

test('cleanup resumes verified cloud records after interruption with one combined progress total', async t => {
    const e = await setup(t), a = e.device('resume-source'), b = e.device('resume-target');
    const keep = a.store.branch(null, 'Keep one', 'codex', codexSample('/work', [['First', 'Answer one']]));
    const other = a.store.branch(null, 'Keep two', 'codex', codexSample('/work', [['Second', 'Answer two']]));
    const remove = a.store.branch(null, 'Discard', 'codex', codexSample('/work', [['Discard', 'Done']]));
    await a.cloud.publish([keep.id, other.id, remove.id], e.pass);
    await b.cloud.catalog(e.pass); for (const p of b.cloud.summaries()) await b.cloud.project(p.id, e.pass);
    await b.cloud.hydrate(remove.id, e.pass); stageTrash(b.store, [remove.id], [remove.id]);
    const original = b.cloud.connection.dav, originalBase = original.base, get = original.get; let attempts = 0;
    original.get = function(key, ...args) { if (this.base === originalBase && key.startsWith('objects/') && ++attempts === 2) throw Error('Interrupted test transfer'); return get.call(this, key, ...args); };
    await assert.rejects(collectTrash(b.cloud, e.pass), /Interrupted/);
    const cachePath = transferCachePath(b.cloud); assert.ok(fs.existsSync(path.join(cachePath, 'grove.sqlite')));
    const retry = new Cloud(b.store, () => e.config), connection = await retry.connect(e.pass), retryGet = connection.dav.get; let oldReads = 0;
    connection.dav.get = function(key, ...args) { if (this.base === originalBase && key.startsWith('objects/')) oldReads++; return retryGet.call(this, key, ...args); };
    const progress = []; const result = await collectTrash(retry, e.pass, { onProgress: value => progress.push(value) });
    assert.ok(result.rebuilt); assert.equal(oldReads, 1, 'already-verified first session must not be downloaded again');
    assert.ok(b.store.local('lastTransferCache').reused > 0);
    assert.ok(progress.every(p => p.total === progress[0].total));
    assert.ok(progress.every((p, i) => i === 0 || p.completed >= progress[i - 1].completed));
    assert.equal(progress.at(-1).completed, progress.at(-1).total);
    assert.equal(fs.existsSync(cachePath), false, 'successful cleanup removes its temporary durable cache');
    assert.equal(retry.items().length, 2);
});
