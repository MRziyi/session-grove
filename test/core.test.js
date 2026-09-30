import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { parse, renderNative } from '../src/transcript.js';
import { codexSample, codexTurn, claudeSample } from '../src/demo.js';
function setup(t) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-test-'))), store = new Store(path.join(root, 'library'));
    const roots = { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') }, cwd = path.join(root, 'work');
    fs.mkdirSync(cwd);
    Object.values(roots).forEach(r => fs.mkdirSync(r));
    const native = new Native(store, { roots, guard: () => { } }), p = store.project('Chrono');
    t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
    return { root, store, roots, cwd, native, p };
}
const extra = () => codexTurn('A new question', 'A new answer').map(x => JSON.stringify(x) + '\n').join('');
test('fork pins an exact checkpoint, deduplicates history, and does not activate', t => {
    const { store, p, cwd } = setup(t), raw = codexSample(cwd, [['Context', 'Ready'], ['Intro', 'Done']]);
    const b = store.branch(p.id, 'main', 'codex', raw), detail = store.detail(b.id), count = store.db.prepare('SELECT COUNT(*) AS n FROM objects').get().n;
    const child = store.fork(b.id, { name: 'Method', end: detail.checkpoints[0].end });
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM objects').get().n, count);
    assert.equal(store.detail(child.id).messages.length, 2);
    const frozen = store.raw(child.head);
    store.ingest(b.id, raw + extra(), b.head, { deviceName: 'A' });
    assert.equal(store.raw(child.head), frozen);
    assert.deepEqual(store.instances(), []);
    assert.throws(() => store.fork(b.id, { name: 'Broken', end: 2 }), /完成/);
});
test('same branch concurrent continuation preserves a separate branch', t => {
    const { store, p, cwd } = setup(t), raw = codexSample(cwd, [['Context', 'Ready']]);
    const b = store.branch(p.id, 'main', 'codex', raw);
    store.ingest(b.id, raw + extra(), b.head, { deviceName: 'A' });
    const other = store.ingest(b.id, raw + extra(), b.head, { deviceName: 'B' });
    assert.notEqual(other.id, b.id);
    assert.equal(other.conflict, true);
    assert.equal(other.parentId, b.id);
});
test('native round trip for both adapters preserves prose and captures only new suffix', t => {
    for (const agent of ['codex', 'claude']) {
        const { store, p, cwd, native, root } = setup(t);
        const old = '/Users/old/Chrono', raw = (agent === 'codex' ? codexSample : claudeSample)(old, [[`Keep literal ${old}`, 'Ready']]);
        const b = store.branch(p.id, 'main', agent, raw);
        native.setActive(b.id, cwd, true);
        assert.equal(native.plan().operations.length, 1);
        assert.equal(native.apply().applied, 1);
        let instance = store.instances()[0], output = fs.readFileSync(instance.file, 'utf8');
        assert.equal(parse(output, agent).cwd, cwd);
        assert.ok(output.includes(`Keep literal ${old}`));
        assert.notEqual(parse(output, agent).nativeId, parse(raw, agent).nativeId);
        assert.deepEqual(native.collect().updates, []);
        if (agent === 'codex') {
            fs.appendFileSync(instance.file, extra());
            native.collect();
            assert.equal(store.detail(b.id).messages.length, 4);
            assert.ok(store.raw(store.get('branch', b.id).head).startsWith(raw));
        }
        native.setActive(b.id, null, false);
        native.apply();
        instance = store.instances()[0];
        assert.equal(instance.applied, false);
        assert.ok(instance.file.startsWith(path.join(root, 'library', 'parked')));
        const saved = store.raw(store.get('branch', b.id).head);
        native.setActive(b.id, cwd, true);
        native.apply();
        assert.equal(store.raw(store.get('branch', b.id).head), saved);
        assert.equal(native.plan().operations.length, 0);
        assert.deepEqual(native.collect().updates, []);
    }
});
test('adoption is read only, then non-active sessions are parked on explicit apply', t => {
    const { store, native, roots, p, cwd } = setup(t), raw = claudeSample(cwd, [['Hello', 'Hi']]);
    const file = path.join(roots.claude, 'projects', 'test', 'sample.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw);
    const item = native.discover().sessions[0];
    native.import(item.key, p.id);
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    assert.equal(store.instances()[0].desired, false);
    native.apply();
    assert.equal(fs.existsSync(file), false);
    assert.equal(store.detail(store.all('branch')[0].id).messages.length, 2);
});
test('running processes block writes but not project operations', t => {
    const { store, roots, p, cwd } = setup(t), native = new Native(store, { roots, guard: () => { throw new Error('running'); } });
    const b = store.branch(p.id, 'main', 'codex', codexSample(cwd, [['Hello', 'Hi']]));
    native.setActive(b.id, cwd, true);
    assert.throws(() => native.apply(), /running/);
    assert.equal(store.instances()[0].applied, false);
    assert.equal(fs.readdirSync(roots.codex).length, 0);
});
test('unknown required Codex schema fails closed and rolls back DB', t => {
    const { store, native, roots, p, cwd } = setup(t);
    const db = new DatabaseSync(path.join(roots.codex, 'state_5.sqlite'));
    db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,cwd TEXT,archived INTEGER,new_required TEXT NOT NULL)');
    db.close();
    const b = store.branch(p.id, 'main', 'codex', codexSample(cwd, [['Hello', 'Hi']]));
    native.setActive(b.id, cwd, true);
    assert.throws(() => native.apply(), /new_required/);
    assert.equal(fs.existsSync(path.join(roots.codex, 'sessions')), false);
    assert.equal(store.instances()[0].applied, false);
});
test('Codex SQLite index and archive follow the explicit active set', t => {
    const { store, native, roots, p, cwd } = setup(t);
    const dbFile = path.join(roots.codex, 'state_5.sqlite'), db = new DatabaseSync(dbFile);
    db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT NOT NULL,cwd TEXT NOT NULL,title TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,archived_at INTEGER)');
    db.close();
    const b = store.branch(p.id, 'main', 'codex', codexSample(cwd, [['Hello', 'Hi']]));
    native.setActive(b.id, cwd, true);
    native.apply();
    const read = () => { const db = new DatabaseSync(dbFile, { readOnly: true }); const r = db.prepare('SELECT * FROM threads').all(); db.close(); return r; };
    assert.equal(read()[0].archived, 0);
    assert.equal(read()[0].cwd, cwd);
    native.setActive(b.id, null, false);
    native.apply();
    assert.equal(read()[0].archived, 1);
    native.setActive(b.id, cwd, true);
    native.apply();
    assert.equal(read()[0].archived, 0);
    assert.equal(read().length, 1);
});
test('partial JSON and unfinished tool calls cannot be materialized', () => {
    assert.throws(() => renderNative('{', 'codex', 'x', '/tmp', 'x'), /损坏/);
    const raw = codexSample('/tmp', [['hi', 'hey']]) + JSON.stringify({ type: 'response_item', payload: { type: 'function_call', call_id: 'pending' } }) + '\n';
    assert.equal(parse(raw, 'codex').complete, false);
    assert.throws(() => renderNative(raw, 'codex', 'x', '/tmp', 'x'), /等待/);
});
test('sync fast-forward, divergence and content verification', t => {
    const a = setup(t), b = setup(t);
    const branch = a.store.branch(a.p.id, 'main', 'codex', codexSample(a.cwd, [['Hello', 'Hi']]));
    const transfer = (from, to) => to.merge(from.exportGraph(), Object.fromEntries(from.db.prepare('SELECT * FROM objects').all().map(r => [r.hash, r.body])));
    transfer(a.store, b.store);
    assert.equal(b.store.get('branch', branch.id).head, branch.head);
    assert.equal(b.store.instances().length, 0);
    a.store.ingest(branch.id, a.store.raw(branch.head) + extra(), branch.head, { deviceName: 'A' });
    transfer(a.store, b.store);
    const shared = a.store.get('branch', branch.id);
    a.store.ingest(branch.id, a.store.raw(shared.head) + extra(), shared.head, { deviceName: 'A' });
    b.store.ingest(branch.id, b.store.raw(shared.head) + extra(), shared.head, { deviceName: 'B' });
    assert.equal(transfer(a.store, b.store).forks, 1);
    assert.equal(transfer(a.store, b.store).forks, 0);
    assert.throws(() => b.store.merge(a.store.exportGraph(), { ['0'.repeat(64)]: 'bad' }), /校验/);
});
test('recovery journal restores a interrupted file operation', t => {
    const { store, native, roots } = setup(t), file = path.join(roots.claude, 'history.jsonl'), jobId = '12345678-1234-1234-1234-123456789abc';
    fs.writeFileSync(file, 'broken');
    fs.writeFileSync(path.join(native.jobs, jobId + '.json'), JSON.stringify({ id: jobId, status: 'applying', instancesBefore: [], files: [{ path: file, content: Buffer.from('original').toString('base64') }] }));
    assert.equal(native.plan().pendingRecovery.length, 1);
    native.recover(jobId);
    assert.equal(fs.readFileSync(file, 'utf8'), 'original');
    assert.equal(native.plan().pendingRecovery.length, 0);
});
test('mid-apply filesystem failure rolls back written logs and leaves unrelated index intact', t => {
    const { store, native, roots, p, cwd } = setup(t), index = path.join(roots.codex, 'session_index.jsonl');
    const original = '{"id":"unmanaged","thread_name":"Leave me alone"}\n';
    fs.writeFileSync(index, original);
    const b = store.branch(p.id, 'main', 'codex', codexSample(cwd, [['Hello', 'Hi']]));
    native.setActive(b.id, cwd, true);
    const destination = native.plan().operations[0].file, rename = fs.renameSync;
    let injected = false;
    fs.renameSync = (from, to) => { if (to === index && !injected) {
        injected = true;
        throw new Error('simulated disk failure');
    } return rename(from, to); };
    try {
        assert.throws(() => native.apply(), /simulated disk failure/);
    }
    finally {
        fs.renameSync = rename;
    }
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.readFileSync(index, 'utf8'), original);
    assert.equal(store.instances()[0].applied, false);
    assert.equal(native.plan().pendingRecovery.length, 0);
});
test('Claude legacy picker index follows explicit activation and deactivation', t => {
    const { store, native, roots, p, cwd } = setup(t), raw = claudeSample(cwd, [['Hello', 'Hi']]);
    const nativeId = parse(raw, 'claude').nativeId, dir = path.join(roots.claude, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, nativeId + '.jsonl'), index = path.join(dir, 'sessions-index.json');
    fs.writeFileSync(file, raw);
    fs.writeFileSync(index, JSON.stringify({ version: 1, entries: [{ sessionId: nativeId, fullPath: file }, { sessionId: 'unrelated' }] }));
    const item = native.discover().sessions[0], b = native.import(item.key, p.id);
    native.apply();
    assert.deepEqual(JSON.parse(fs.readFileSync(index)).entries, [{ sessionId: 'unrelated' }]);
    native.setActive(b.id, cwd, true);
    native.apply();
    assert.equal(JSON.parse(fs.readFileSync(index)).entries.find(e => e.sessionId === nativeId).fullPath, store.instances()[0].file);
});
test('Claude companion files are captured losslessly; native-style forks start without companion history', t => {
    const { store, native, roots, p, cwd } = setup(t), raw = claudeSample(cwd, [['Hello', 'Hi']]), nativeId = parse(raw, 'claude').nativeId;
    const dir = path.join(roots.claude, 'projects', 'example');
    fs.mkdirSync(path.join(dir, nativeId, 'subagents'), { recursive: true });
    const file = path.join(dir, nativeId + '.jsonl');
    fs.writeFileSync(file, raw);
    fs.writeFileSync(path.join(dir, nativeId, 'subagents', 'notes.bin'), Buffer.from([0, 255, 42]));
    const b = native.import(native.discover().sessions[0].key, p.id);
    assert.equal(store.get('revision', b.head).source.auxiliary.length, 1);
    native.apply();
    assert.equal(fs.readFileSync(store.instances()[0].file, 'utf8'), raw);
    const child = store.fork(b.id, { name: 'child', end: store.detail(b.id).checkpoints[0].end });
    native.setActive(b.id, cwd, true);
    native.setActive(child.id, cwd, true);
    assert.equal(native.apply().applied, 2);
    const fork = store.instances().find(i => i.branchId === child.id);
    assert.equal(fs.existsSync(path.join(path.dirname(fork.file), fork.nativeId, 'subagents', 'notes.bin')), false);
    const restored = store.instances().find(i => i.branchId === b.id && i.applied);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(restored.file), restored.nativeId, 'subagents', 'notes.bin')), Buffer.from([0, 255, 42]));
});

test('completing a previously partial JSON record rebuilds line references correctly',t=>{
 const {store,cwd}=setup(t),raw=codexSample(cwd,[['Question','Answer']]),partial=raw.slice(0,-12),b=store.branch(null,'Partial','codex',partial);store.ingest(b.id,raw,b.head,{});const current=store.get('branch',b.id);assert.equal(store.raw(current.head),raw);assert.equal(store.get('revision',current.head).refs.length,raw.trim().split('\n').length);
});

test('Claude checkpoint activation inherits native session metadata and preserves historical working directories', t => {
    const { store, native, cwd } = setup(t);
    const rows = claudeSample(cwd, [['First', 'Done'], ['Later', 'Finished']]).trim().split('\n').map(JSON.parse);
    rows[1].cwd = path.join(cwd, 'historical-subdirectory');
    rows.push({ type: 'atis-latch', sessionId: rows[0].sessionId, atis: 'metadata-after-checkpoint' });
    const b = store.branch(null, 'Original', 'claude', rows.map(r => JSON.stringify(r) + '\n').join(''));
    const child = store.fork(b.id, { name: 'Checkpoint fork', end: store.detail(b.id).checkpoints[0].end });
    native.setActive(child.id, cwd, true); native.apply([child.id]);
    const instance = store.instances().find(i => i.branchId === child.id), output = parse(fs.readFileSync(instance.file, 'utf8'), 'claude');
    assert.equal(output.messages.length, 2);
    assert.equal(output.records.find(r => r.value?.type === 'atis-latch').value.atis, 'metadata-after-checkpoint');
    assert.equal(output.records.find(r => r.value?.type === 'assistant').value.cwd, rows[1].cwd);
});

test('a continued Claude fork preserves the actual native UUID chain and shared graph prefix', t => {
    const {store,native,cwd}=setup(t),parent=store.branch(null,'Parent','claude',claudeSample(cwd,[['Original question','Original reply']]));
    const fork=store.fork(parent.id,{name:'Fork',end:store.detail(parent.id).checkpoints[0].end});native.setActive(fork.id,cwd,true);native.apply([fork.id]);
    const instance=store.instances().find(i=>i.branchId===fork.id),rows=fs.readFileSync(instance.file,'utf8').trim().split('\n').map(JSON.parse),last=rows.findLast(r=>r.type==='assistant'),userId=randomUUID();
    const added=[{type:'user',uuid:userId,parentUuid:last.uuid,sessionId:instance.nativeId,cwd,message:{role:'user',content:'New question'}},{type:'assistant',uuid:randomUUID(),parentUuid:userId,sessionId:instance.nativeId,cwd,message:{role:'assistant',content:'New reply',stop_reason:'end_turn'}}];
    fs.appendFileSync(instance.file,added.map(r=>JSON.stringify(r)+'\n').join(''));
    assert.equal(native.collect().errors.length,0);const current=store.get('branch',fork.id);
    assert.deepEqual(store.detail(fork.id).messages.map(m=>m.text),['Original question','Original reply','New question','New reply']);
    assert.equal(store.raw(current.head),fs.readFileSync(instance.file,'utf8'));
    assert.equal(store.treeGraph(parent.id).chatCount,4);
});

test('Codex materialization preserves untouched record bytes and large integer payloads', t => {
    const {cwd}=setup(t),record='{"type":"world_state", "payload":{"full":true,"unknown_counter":9007199254740993}}\n';
    const raw=codexSample(cwd,[['Keep context','Ready']])+record;
    const output=renderNative(raw,'codex',randomUUID(),cwd,'Copy');assert.ok(output.endsWith(record));
});

test('Grove rename preserves native IDs and Claude message links through continuation and reactivation', t => {
    const {store,native,cwd}=setup(t),b=store.branch(null,'Original label','claude',claudeSample(cwd,[['Question','Answer']]));
    native.setActive(b.id,cwd,true,{nodeName:'Pending 1'});native.apply([b.id]);
    const instance=store.instances().find(i=>i.branchId===b.id),original=fs.readFileSync(instance.file,'utf8');
    const ids=store.treeGraph(b.id).paths[0].messages.map(m=>m.id);
    store.edit(b.id,{name:'Grove alias'});
    assert.equal(store.get('branch',b.id).head,b.head);assert.equal(native.plan().operations.length,0);
    native.apply([b.id]);assert.equal(fs.readFileSync(instance.file,'utf8'),original);
    assert.deepEqual(store.treeGraph(b.id).paths[0].messages.map(m=>m.id),ids);
    native.setActive(b.id,null,false);native.apply([b.id]);native.setActive(b.id,cwd,true,{nodeName:'Pending 1'});native.apply([b.id]);
    const current=store.instances().find(i=>i.branchId===b.id),rows=fs.readFileSync(current.file,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(current.nativeId,instance.nativeId);
    assert.deepEqual(rows.filter(r=>r.type==='user'||r.type==='assistant').map(r=>r.uuid),original.trim().split('\n').map(JSON.parse).filter(r=>r.type==='user'||r.type==='assistant').map(r=>r.uuid));
    const last=rows.findLast(r=>r.type==='assistant'),u=randomUUID();
    fs.appendFileSync(current.file,[{type:'user',uuid:u,parentUuid:last.uuid,sessionId:current.nativeId,cwd,message:{role:'user',content:'Continue after rename'}},{type:'assistant',uuid:randomUUID(),parentUuid:u,sessionId:current.nativeId,cwd,message:{role:'assistant',content:'Still linked',stop_reason:'end_turn'}}].map(r=>JSON.stringify(r)+'\n').join(''));
    assert.deepEqual(native.collect().errors,[]);assert.equal(store.get('branch',b.id).name,'Grove alias');
    assert.deepEqual(store.detail(b.id).messages.map(m=>m.text),['Question','Answer','Continue after rename','Still linked']);
    assert.equal(store.all('branch').length,1);
});

test('Update tracks native titles by thread ID without replacing Grove aliases or transcript records', t => {
    const {store,native,roots,cwd}=setup(t),db=new DatabaseSync(path.join(roots.codex,'state_5.sqlite'));
    db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,cwd TEXT,title TEXT,name TEXT,archived INTEGER DEFAULT 0)');
    const sources=[];
    for(const prompt of ['First source','Second source']){
        const raw=codexSample(cwd,[[prompt,'Answer']]),nativeId=parse(raw,'codex').nativeId,file=path.join(roots.codex,'sessions',nativeId+'.jsonl');
        fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw);
        db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,0)').run(nativeId,file,cwd,'Same native title','Same native title');sources.push({nativeId,file,raw});
    }
    native.refreshLocal();const first=store.instances().find(i=>i.nativeId===sources[0].nativeId),second=store.instances().find(i=>i.nativeId===sources[1].nativeId);
    store.edit(first.branchId,{name:'My Grove alias'});const head=store.get('branch',first.branchId).head;
    db.prepare('UPDATE threads SET name=?,title=? WHERE id=?').run('Renamed in client','Renamed in client',sources[0].nativeId);
    native.refreshLocal();
    assert.equal(store.get('branch',first.branchId).name,'My Grove alias');assert.equal(store.get('branch',first.branchId).head,head);
    assert.equal(store.treeGraph(first.branchId).paths.find(p=>p.branchId===first.branchId).originalTitle,'Renamed in client');
    assert.equal(store.treeGraph(second.branchId).paths.find(p=>p.branchId===second.branchId).originalTitle,'Same native title');
    assert.equal(fs.readFileSync(sources[0].file,'utf8'),sources[0].raw);db.close();
});
