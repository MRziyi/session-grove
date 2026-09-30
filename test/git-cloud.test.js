import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.js';
import { GitCloud } from '../src/git-cloud.js';
import { GitRemote, gitRemote } from '../src/git-remote.js';
import { AutoSync } from '../src/auto-sync.js';
import { codexSample, codexTurn } from '../src/demo.js';
import { bodyRefs } from '../src/retention.js';
import { stageTrash } from '../src/trash.js';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-git-test-'));
    const url = path.join(root, 'remote.git'); execFileSync('git', ['init', '--bare', '-b', 'main', url]);
    const config = { provider: 'git', url, allowLocal: true }, devices = [];
    const device = name => { const store = new Store(path.join(root, name)); const auto = new AutoSync(store, () => config, null, { provider: 'git' }); const d = { store, auto, cloud: auto.cloud }; devices.push(d); return d; };
    t.after(() => { devices.forEach(d => { d.auto.close(); d.store.close(); }); fs.rmSync(root, { recursive: true, force: true }); });
    return { root, url, device };
}
const branch = (d, name = 'Sample') => d.store.branch(null, name, 'codex', codexSample('/synthetic', [['Hello ' + name, 'Ready']]));
const push = async d => { d.auto.startTransfer('push'); return d.auto.syncJob; };
const pull = async d => { d.auto.startTransfer('pull'); return d.auto.syncJob; };

test('Git roundtrip, metadata-only rename and no-op Push preserve bodies and history', async t => {
    const e = fixture(t), a = e.device('a'), b = e.device('b'), session = branch(a);
    assert.equal(a.auto.status().unlocked, true);
    await push(a); const first = a.cloud.connection.remote.head;
    assert.deepEqual(a.cloud.dirtyIds(), []);
    await pull(b); assert.equal(b.store.all('branch').length, 1);
    await b.auto.openTree(session.id); assert.equal(b.store.raw(b.store.get('branch', session.id).head), a.store.raw(session.head));
    assert.deepEqual(b.cloud.dirtyIds(), []);
    a.store.edit(session.id, { name: 'Renamed' }); await push(a);
    const files = execFileSync('git', ['--git-dir', e.url, 'diff', '--name-only', first, 'main'], { encoding: 'utf8' });
    assert.ok(!files.includes('records/')); assert.match(files, /graph.json/);
    const second = a.cloud.connection.remote.head; const current = await pull(a); assert.equal(current.unchanged, true); assert.equal(a.auto.operation.summary.unchanged, true); await push(a); assert.equal(a.cloud.connection.remote.head, second);
    await pull(b); assert.equal(b.store.get('branch', session.id).name, 'Renamed');
});

test('sequential two-device work preserves both sessions and appended transcript', async t => {
    const e = fixture(t), a = e.device('a'), b = e.device('b'), one = branch(a, 'One'); await push(a);
    await pull(b); const two = branch(b, 'Two');
    const head = b.store.get('branch', one.id).head;
    b.store.ingest(one.id, b.store.raw(head) + codexTurn('Continue on B', 'Done').map(v => JSON.stringify(v) + '\n').join(''), head, {});
    await push(b); await pull(a);
    assert.equal(a.store.all('branch').length, 2);
    assert.match(a.store.raw(a.store.get('branch', one.id).head), /Continue on B/);
    assert.equal(a.store.get('branch', two.id).name, 'Two');
});

test('rename during Git upload is still dirty after commit acknowledgement', async t => {
    const e = fixture(t), a = e.device('a'), session = branch(a); await push(a);
    a.store.edit(session.id, { name: 'Snapshot' });
    const remote = a.cloud.connection.remote, original = remote.commitAndPush.bind(remote);
    remote.commitAndPush = async () => { a.store.edit(session.id, { name: 'Later edit' }); return original(); };
    await push(a); assert.ok(a.cloud.dirtyIds().includes(session.id));
    assert.equal(a.cloud.read(a.cloud.folder(session.id) + '/index.json').name, 'Snapshot');
    remote.commitAndPush = original; await push(a); assert.deepEqual(a.cloud.dirtyIds(), []);
});

test('Trash-only Push deletes current files, retains Git history, and propagates deletion', async t => {
    const e = fixture(t), a = e.device('a'), b = e.device('b'), session = branch(a); await push(a);
    const first = a.cloud.connection.remote.head; await pull(b); await b.auto.openTree(session.id);
    stageTrash(a.store, [session.id], [session.id]); await push(a);
    assert.equal(a.auto.trashPending(), false); assert.equal(a.cloud.items().length, 0);
    const file = a.cloud.folder(session.id) + '/graph.json';
    assert.ok(execFileSync('git', ['--git-dir', e.url, 'show', first + ':' + file]).length);
    await pull(b); assert.equal(b.cloud.items().length, 0); assert.equal(b.store.syncCollections().items.length, 0);
});

test('new edits and Trash staged during Push remain queued', async t => {
    const e = fixture(t), a = e.device('a'), one = branch(a, 'One'), two = branch(a, 'Two'); await push(a);
    a.store.edit(one.id, { name: 'One changed' }); const remote = a.cloud.connection.remote, original = remote.commitAndPush.bind(remote);
    remote.commitAndPush = async () => { stageTrash(a.store, [two.id], [two.id]); return original(); };
    await push(a); assert.equal(a.auto.trashPending(), true);
    remote.commitAndPush = original; await push(a); assert.equal(a.auto.trashPending(), false);
});

test('failed initial Push can retry without losing the local snapshot', async t => {
    const e = fixture(t), a = e.device('a'); branch(a);
    await a.cloud.connect(); const remote = a.cloud.connection.remote, run = remote.run.bind(remote); let fail = true;
    remote.run = (args, options) => args[0] === 'push' && fail ? Promise.reject(new Error('Synthetic outage')) : run(args, options);
    await assert.rejects(push(a), /outage/); fail = false; await push(a); assert.deepEqual(a.cloud.dirtyIds(), []);
});

test('Git rejects unsafe remotes and unrelated repository contents', async t => {
    for (const value of ['-x', 'file:///tmp/repo', 'git@github.com:a/../b.git', 'git@github.com:a/b.git;echo bad']) assert.throws(() => gitRemote(value));
    const e = fixture(t), a = e.device('a'); branch(a); await push(a);
    const remote = a.cloud.connection.remote;
    fs.symlinkSync('/tmp', path.join(remote.directory, 'unsafe')); await remote.run(['add', 'unsafe']); await remote.run(['commit', '-m', 'Synthetic unsafe file']); await remote.run(['push', 'origin', 'HEAD:main']);
    const b = e.device('b'); await assert.rejects(pull(b), /Unexpected file or link/);
});

test('migration excludes old Archive and Trash before the first commit', async t => {
    const e = fixture(t), a = e.device('source');
    const kept = branch(a, 'Keep'), archived = branch(a, 'Archive'), trashed = branch(a, 'Trash');
    a.store.edit(archived.id, { archived: true }); stageTrash(a.store, [trashed.id], [trashed.id]);
    const stage = path.join(e.root, 'migration');
    execFileSync(process.execPath, ['scripts/migrate-git.js', '--source', a.store.root, '--staging', stage, '--remote', 'git@example.invalid:owner/test.git', '--local-only', '--prepare'], { cwd: process.cwd() });
    const store = new Store(stage);
    try {
        const exported = store.exportGraph();
        assert.deepEqual(exported.branches.filter(b => !b.synthetic).map(b => b.id), [kept.id]);
        const text = bodyRefs(exported).map(h => store.objectStatement.get(h).body).join('\n');
        assert.match(text, /Hello Keep/); assert.doesNotMatch(text, /Hello Archive|Hello Trash/);
        assert.equal(JSON.parse(fs.readFileSync(path.join(stage, 'prepared.json'))).excludedArchivedBranches, 1);
        assert.equal(a.store.get('branch', archived.id).archived, true); // source untouched
    } finally { store.close(); }
});

test('pending semantic changes become the Git message and reset after Push', async t => {
    const e=fixture(t),a=e.device('a'),s=branch(a,'Before');await push(a);
    a.store.edit(s.id,{name:'After'});
    let changes=a.auto.pendingItems()[0].changes;
    assert.deepEqual(changes.map(c=>c.kind),['session-renamed']);
    const head=a.store.get('branch',s.id).head;
    a.store.ingest(s.id,a.store.raw(head)+codexTurn('More','Done').map(r=>JSON.stringify(r)+'\n').join(''),head,{});
    let graph=a.store.treeGraph(s.id);
    a.store.organize(s.id,{version:graph.version,pathId:s.id,chatIds:graph.paths[0].messages.slice(0,2).map(m=>m.id),action:'combine',name:'First node'});
    changes=a.auto.pendingItems()[0].changes;
    assert.ok(changes.some(c=>c.kind==='transcript-appended'&&c.count===6));assert.ok(changes.some(c=>c.kind==='node-added'));
    await push(a);
    const message=execFileSync('git',['--git-dir',e.url,'log','-1','--format=%B'],{encoding:'utf8'});
    assert.match(message,/After/);assert.match(message,/Session renamed: Before → After/);assert.match(message,/Transcript appended: 6 records/);assert.match(message,/First node/);
    assert.deepEqual(a.auto.pendingItems(),[]);
    graph=a.store.treeGraph(s.id);const node=graph.nodes.find(n=>n.name==='First node');
    a.store.organize(s.id,{version:graph.version,pathId:s.id,nodeId:node.id,action:'rename',name:'Better node'});
    assert.deepEqual(a.auto.pendingItems()[0].changes.map(c=>c.kind),['node-renamed']);
});
