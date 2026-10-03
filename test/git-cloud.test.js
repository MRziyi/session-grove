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
import {hash} from '../src/util.js';
import { stageTrash,cleanupLocal,restoreTrash } from '../src/trash.js';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-git-test-'));
    const url = path.join(root, 'remote.git'); execFileSync('git', ['init', '--bare', '-b', 'main', url]);
    // The disposable receiver must not launch maintenance that outlives Push
    // and recreates info/refs or objects/info/packs during fixture teardown.
    fs.appendFileSync(path.join(url,'config'),'\n[receive]\n\tautoGC = false\n');
    const config = { provider: 'git', url, allowLocal: true }, devices = [];
    const device = name => { const store = new Store(path.join(root, name)); const auto = new AutoSync(store, () => config, null, { provider: 'git' }); const d = { store, auto, cloud: auto.cloud }; devices.push(d); return d; };
    t.after(() => { devices.forEach(d => { d.auto.close(); d.store.close(); }); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
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

test('unchanged Pull checks the remote once without fetching or rereading session indexes',async t=>{
    const e=fixture(t),a=e.device('a'),b=e.device('b');branch(a);await push(a);await pull(b);
    const remote=b.cloud.connection.remote,run=remote.run.bind(remote),commands=[];
    remote.run=(args,options)=>{commands.push(args[0]);return run(args,options);};
    b.cloud.loadDirectory=()=>{throw new Error('Unchanged catalog should be reused');};
    const result=await pull(b);
    assert.equal(result.unchanged,true);assert.equal(commands.filter(c=>c==='ls-remote').length,1);assert.ok(!commands.includes('fetch'));
    assert.equal(b.store.all('branch').length,1);
});

test('local rename during streamed Pull wins and remains queued',async t=>{
    const e=fixture(t),a=e.device('a'),b=e.device('b'),one=branch(a);await push(a);await pull(b);
    a.store.ingest(one.id,a.store.raw(one.head)+codexTurn('Remote continuation','Reply').map(v=>JSON.stringify(v)+'\n').join(''),one.head,{});await push(a);
    const records=b.cloud.streamRecords.bind(b.cloud);let changed=false;
    b.cloud.streamRecords=async function*(id){for await(const row of records(id)){if(!changed){changed=true;b.store.edit(one.id,{name:'Edited while reading'});}yield row;}};
    await pull(b);assert.equal(b.store.get('branch',one.id).name,'Edited while reading');assert.ok(b.cloud.dirtyIds().includes(one.id));
});

test('Trash during streamed Pull does not resurrect the discarded session',async t=>{
    const e=fixture(t),a=e.device('a'),b=e.device('b'),one=branch(a);await push(a);await pull(b);
    a.store.ingest(one.id,a.store.raw(one.head)+codexTurn('Remote continuation','Reply').map(v=>JSON.stringify(v)+'\n').join(''),one.head,{});await push(a);
    const records=b.cloud.streamRecords.bind(b.cloud);let changed=false;
    b.cloud.streamRecords=async function*(id){for await(const row of records(id)){if(!changed){changed=true;stageTrash(b.store,[one.id],[one.id]);}yield row;}};
    await pull(b);assert.equal(b.store.syncCollections().items.length,0);assert.equal(b.auto.trashPending(),true);
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
    // Construct a Git symlink entry without requiring Windows symlink privileges.
    const object=await remote.run(['hash-object','-w','--stdin'],{input:'/tmp'});
    await remote.run(['update-index','--add','--cacheinfo','120000,'+object.stdout+',unsafe']); await remote.run(['commit', '-m', 'Synthetic unsafe file']); await remote.run(['push', 'origin', 'HEAD:main']);
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

test('lightweight verification downloads no session blobs or history and leaves the sync cache untouched', async t => {
    const e=fixture(t),a=e.device('verify-source');
    const remote=new GitRemote(path.join(e.root,'untouched'),e.url);
    await remote.verify();
    const session=branch(a);await push(a);
    a.store.edit(session.id,{name:'Second revision'});await push(a);
    await assert.rejects(remote.verify(),/lightweight verification/);
    execFileSync('git',['--git-dir='+e.url,'config','uploadpack.allowFilter','true']);
    execFileSync('git',['--git-dir='+e.url,'config','uploadpack.allowAnySHA1InWant','true']);
    const original=GitRemote.prototype.run,commands=[];
    t.mock.method(GitRemote.prototype,'run',async function(args,options){
        commands.push(args);
        const result=await original.call(this,args,options);
        if(args[0]==='show'&&args[1]==='FETCH_HEAD:grove.json'){
            const objects=execFileSync('git',['rev-list','--objects','--missing=print','FETCH_HEAD'],{cwd:this.directory,encoding:'utf8'});
            assert.match(objects,/^\?/m,'session trees and bodies stay remote');
            assert.equal(execFileSync('git',['rev-list','--count','FETCH_HEAD'],{cwd:this.directory,encoding:'utf8'}).trim(),'1');
        }
        return result;
    });
    await remote.verify();
    assert.ok(!fs.existsSync(remote.directory));
    assert.ok(!commands.some(args=>args.includes('reset')||args.includes('--hard')));
    assert.ok(commands.some(args=>args.includes('--filter=tree:0')));
});

test('discard restores the exact acknowledged snapshot, removes an empty fork and keeps recovery',async t=>{
    const {discardChanges}=await import('../src/discard-changes.js');
    const e=fixture(t),a=e.device('undo'),b=branch(a);await push(a);
    const baseline=a.cloud.cache().ack[b.id];
    a.store.edit(b.id,{name:'Mistake'});
    const child=a.store.fork(b.id,{name:'Empty fork',end:a.store.parsed(b.head,'codex').checkpoints.at(-1).end});
    a.store.put('branch',{...child,activationNodeName:'Pending'});
    const pending=a.cloud.pendingItems();assert.equal(pending.length,1);
    const result=await discardChanges(a.store,a.cloud,{collect:()=>({errors:[]})},pending);
    assert.equal(a.store.get('branch',b.id).name,'Sample');assert.ok(!a.store.find('branch',child.id));
    assert.equal(a.cloud.cache().ack[b.id],baseline);assert.equal(a.cloud.dirtyIds().length,0);
    assert.ok(fs.existsSync(path.join(a.store.root,'trash',result.recoveryId+'.json.gz')));
    const restored=restoreTrash(a.store,result.recoveryId);assert.ok(restored);assert.ok(a.store.all('branch').some(b=>b.name==='Empty fork'),'discarded work can be recovered under new identities');
});
test('discard reconciles updated selections and only confirms active changed conversations',async t=>{
    const {discardChanges}=await import('../src/discard-changes.js');
    const e=fixture(t),a=e.device('undo-guards'),b=branch(a);await push(a);const native={collect:()=>({errors:[]})};
    a.store.edit(b.id,{name:'First'});const stale=a.cloud.pendingItems();a.store.edit(b.id,{name:'Second'});
    assert.equal((await discardChanges(a.store,a.cloud,native,stale)).discarded,1);assert.equal(a.store.get('branch',b.id).name,'Sample');a.store.edit(b.id,{name:'Second'});
    a.store.local('instances',[{id:'native',branchId:b.id,agent:'codex',nativeId:'native-id',applied:true,baseRevision:b.head}]);
    await discardChanges(a.store,a.cloud,native,a.cloud.pendingItems());assert.equal(a.store.get('branch',b.id).name,'Sample');
    a.store.ingest(b.id,a.store.raw(b.head)+codexTurn('New question','New answer').map(v=>JSON.stringify(v)+'\n').join(''),b.head,{operation:'capture'});
    const approval=await discardChanges(a.store,a.cloud,native,a.cloud.pendingItems());assert.equal(approval.confirmationRequired,true);assert.equal(approval.sessions[0].nativeId,'native-id');
});
test('discarding a never-synced session works offline without publishing a deletion',async t=>{
    const {discardChanges}=await import('../src/discard-changes.js');
    const e=fixture(t),a=e.device('undo-new'),b=branch(a);
    await discardChanges(a.store,a.cloud,{collect:()=>({errors:[]})},a.cloud.pendingItems());
    assert.ok(!a.store.find('branch',b.id));assert.equal(a.cloud.pendingItems().length,0);assert.equal((a.store.local('trashPending')||[]).length,0);
});
test('discard cancels a queued removal and restores the original synced identities',async t=>{
    const {discardChanges}=await import('../src/discard-changes.js');
    const e=fixture(t),a=e.device('undo-removal'),b=branch(a);await push(a);
    stageTrash(a.store,[b.id],[b.id]);cleanupLocal(a.store);
    await discardChanges(a.store,a.cloud,{collect:()=>({errors:[]})},a.cloud.pendingItems());
    assert.ok(!a.store.isTrashed(b.id));assert.equal(a.cloud.pendingItems().length,0);assert.equal(a.store.get('branch',b.id).name,'Sample');
});
test('shared project rollback is automatic and preserves other sessions edits and undo bodies',async t=>{
    const {discardChanges}=await import('../src/discard-changes.js');
    const e=fixture(t),a=e.device('undo-gc'),p=a.store.project('Original project'),b=branch(a),other=branch(a,'Other');
    a.store.edit(b.id,{name:'Original'});a.store.moveItems({itemIds:[b.id,other.id],projectId:p.id});await push(a);
    const native={collect:()=>({errors:[]})},original=a.store.raw(b.head);
    a.store.edit(other.id,{name:'Independent edit'});a.store.put('project',{...p,name:'Accidental project rename'});
    assert.equal((await discardChanges(a.store,a.cloud,native,a.cloud.pendingItems().filter(i=>i.id===b.id))).discarded,1);
    assert.equal(a.store.get('project',p.id).name,'Original project');assert.equal(a.store.get('branch',other.id).name,'Independent edit');
    const revision=a.store.revision(codexSample('/synthetic',[['Replacement','Oops']]),null,{agent:'codex'});
    a.store.put('branch',{...a.store.get('branch',b.id),head:revision.id});
    stageTrash(a.store,[other.id],[other.id]);cleanupLocal(a.store);
    await discardChanges(a.store,a.cloud,native,a.cloud.pendingItems().filter(i=>i.id===b.id));
    assert.equal(a.store.raw(a.store.get('branch',b.id).head),original);
});

test('Git keeps previous archives local and retains only the prefix needed by active descendants',async t=>{
    const e=fixture(t),a=e.device('archive-source'),b=e.device('archive-reader');
    const root=a.store.branch(null,'Archived root','codex',codexSample('/synthetic',[['Shared','Prefix'],['ARCHIVED PRIVATE SUFFIX','Do not upload']]));
    const child=a.store.fork(root.id,{name:'Active fork',end:a.store.parsed(root.head,'codex').checkpoints[0].end});
    a.store.edit(root.id,{archived:true});
    const alone=branch(a,'Archived alone');a.store.edit(alone.id,{archived:true});
    const project=a.store.project('Archived project'),inside=branch(a,'Project archive');a.store.moveItems({itemIds:[inside.id],projectId:project.id});a.store.put('project',{...project,archived:true});
    await push(a);assert.equal(a.cloud.items().length,1);
    const graph=a.cloud.read(a.cloud.folder(root.id)+'/graph.json');assert.ok(!graph.branches.some(b=>!b.synthetic&&b.archived));
    assert.ok(![...a.cloud.records(root.id)].some(([,body])=>body.includes('ARCHIVED PRIVATE SUFFIX')));
    await pull(b);assert.equal(b.store.listing('archived').items.length,0);assert.ok(b.store.find('branch',child.id));
    a.store.edit(child.id,{name:'Accidental rename'});
    const {discardChanges}=await import('../src/discard-changes.js');await discardChanges(a.store,a.cloud,{collect:()=>({errors:[]})},a.cloud.pendingItems());
    assert.equal(a.store.get('branch',root.id).archived,true);assert.ok(a.store.raw(a.store.get('branch',root.id).head).includes('ARCHIVED PRIVATE SUFFIX'),'undo must preserve local-only archived history');
});
test('archiving a synced tree removes its current Git entry on the next explicit Push without deleting local history',async t=>{
    const e=fixture(t),a=e.device('archive-publish'),session=branch(a);await push(a);
    a.store.edit(session.id,{archived:true});assert.equal(a.cloud.pendingItems().length,0);
    await push(a);assert.ok(a.store.find('branch',session.id)?.archived);assert.equal(a.cloud.entries().length,0);assert.equal(a.cloud.archiveCleanupNeeded(),false);
});
test('discard recovers an older verified baseline from local Git after the working cache was rewritten',async t=>{
 const {discardChanges}=await import('../src/discard-changes.js'),e=fixture(t),a=e.device('undo-local-history'),b=branch(a);await push(a);
 a.store.local(a.cloud.undoKey(b.id),null);a.store.edit(b.id,{name:'Unpublished mistake'});
 a.cloud.write(a.cloud.folder(b.id)+'/graph.json',{schema:3,branches:[],projects:[],revisions:[],nodes:[],layouts:[]});
 const remote=a.cloud.connection.remote,run=remote.run.bind(remote),lookups=[];remote.run=async(args,options)=>{
  assert.ok(!['fetch','push','ls-remote'].includes(args[0]),'discard must stay offline');
  const result=await run(args,options);let parsed=false,verified=false;
  if(args[0]==='cat-file')try{const graph=JSON.parse(result.stdout);parsed=true;verified=hash(JSON.stringify(graph))===a.cloud.cache().ack[b.id];}catch{}
  lookups.push({command:args[0],code:result.code,bytes:result.stdout.length,parsed,verified,stderrKind:/invalid object name|bad object|not a valid object/.test(result.stderr)?'invalid-object':/does not exist|exists on disk|not in/.test(result.stderr)?'missing-path':result.stderr?'other':null});return result;
 };
 try{await discardChanges(a.store,a.cloud,{collect:()=>({errors:[]})},a.cloud.pendingItems());assert.equal(a.store.get('branch',b.id).name,'Sample');assert.equal(a.cloud.pendingItems().length,0);}
 catch(error){
  // Public CI diagnostics contain only control-flow facts, never graph bodies,
  // titles, paths, credentials, command output or user-provided error strings.
  if(process.env.CI)console.error('::error file=test/git-cloud.test.js,title=Offline Discard diagnostic::'+JSON.stringify({kind:error.name,status:error.status,code:error.code,gitExitCode:error.gitExitCode,missingBaseline:error.message.includes('No verified local sync snapshot'),offlineGuard:error.message.includes('discard must stay offline'),lookups}));
  throw error;
 }
});
