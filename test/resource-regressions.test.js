import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {CloudView as Cloud,treeSnapshot,graphFingerprint} from '../src/cloud-view.js';
import {GitCloud} from '../src/git-cloud.js';
import {changeSnapshot} from '../src/session-changes.js';
import {codexSample} from '../src/demo.js';
import {hash} from '../src/util.js';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-resources-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return store;}
function requireFingerprints(s,cloud){cloud.useSavedCache();const cache=cloud.cache();for(const item of s.syncCollections().items)cache.ack[item.id]='0'.repeat(64);s.local(cloud.cacheKey,cache);}

test('pending review releases expanded histories while preserving its result and an enclosing transfer snapshot',t=>{
 const s=setup(t),b=s.branch(null,'Before','codex',codexSample('/fixture',[['Question','Answer']])),cloud=new GitCloud(s,()=>({})),graph=treeSnapshot(s,b.id);cloud.useSavedCache();const cache=cloud.cache();cache.ack[b.id]=graphFingerprint(graph);cache.baselines={[b.id]:changeSnapshot(graph)};cloud.save(cache);s.edit(b.id,{name:'After'});const raw=s.raw(s.get('branch',b.id).head);
 const result=cloud.pendingItems();assert.equal(result.length,1);assert.ok(result[0].changes.some(c=>c.kind==='session-renamed'));assert.ok(![...s.memoCache.keys()].some(k=>k==='exportGraph'||k==='cloud-snapshot-index'||k.startsWith('cloud-tree:')));assert.deepEqual(cloud.pendingItems(),result);assert.equal(s.raw(s.get('branch',b.id).head),raw);
 const existing=treeSnapshot(s,b.id);assert.deepEqual(cloud.pendingItems(),result);assert.equal(treeSnapshot(s,b.id),existing,'a snapshot held by an enclosing upload remains intact');
});
test('failed pending review also releases its temporary graph snapshots',t=>{
 const s=setup(t),b=s.branch(null,'Session','codex',codexSample('/fixture',[['Question','Answer']])),cloud=new GitCloud(s,()=>({})),local=s.local.bind(s);s.local=(key,...args)=>{if(key.startsWith('organization-undo:'))throw Error('Synthetic review failure');return local(key,...args);};
 assert.throws(()=>cloud.pendingItems(),/Synthetic review failure/);assert.ok(![...s.memoCache.keys()].some(k=>k==='exportGraph'||k==='cloud-snapshot-index'||k.startsWith('cloud-tree:')));s.local=local;assert.equal(cloud.pendingItems()[0].id,b.id);
});

test('status fingerprints preserve sync bytes without retaining export graphs',t=>{
    const s=setup(t),b=s.branch(null,'Unicode 测试','codex',codexSample('/fixture',[['Question','Answer']])),cloud=new Cloud(s,()=>({}));
    const graph=treeSnapshot(s,b.id),expected=hash(JSON.stringify(graph));
    assert.equal(graphFingerprint(graph),expected);
    assert.equal(graphFingerprint({...graph,optional:undefined,retention:{schema:1,ranges:{},extras:{}}}),hash(JSON.stringify({...graph,optional:undefined,retention:{schema:1,ranges:{},extras:{}}})));
    requireFingerprints(s,cloud);s.invalidate();assert.deepEqual(cloud.dirtyIds(),[b.id]);
    assert.equal(s.memoCache.get('fingerprint:'+b.id),expected);
    assert.ok(![...s.memoCache.keys()].some(k=>k==='exportGraph'||k==='cloud-snapshot-index'||k.startsWith('cloud-tree:')));
    const build=s.buildExportGraph;s.buildExportGraph=()=>{throw Error('Unchanged status must not export history');};assert.deepEqual(cloud.dirtyIds(),[b.id]);s.buildExportGraph=build;
    const existing=treeSnapshot(s,b.id);cloud.dirtyIds();assert.equal(treeSnapshot(s,b.id),existing,'an export owned by another operation stays cached');
    cloud.useSavedCache();const cache=cloud.cache();cache.ack[b.id]=expected;s.local(cloud.cacheKey||'cloud:unconfigured',cache);assert.deepEqual(cloud.dirtyIds(),[]);
    s.put('branch',{...s.get('branch',b.id),name:'Changed'});assert.deepEqual(cloud.dirtyIds(),[b.id]);
});

test('unchanged entity writes do not invalidate projections or modify SQLite',t=>{
    const s=setup(t),b=s.branch(null,'Same','codex',codexSample('/fixture',[['Question','Answer']]));
    const view=s.collections(),version=s.version,changes=()=>s.db.prepare('SELECT total_changes() n').get().n,before=changes();
    s.put('branch',s.get('branch',b.id));assert.equal(changes(),before);assert.equal(s.version,version);assert.equal(s.collections(),view);
    s.put('branch',{...b,name:'Different'});assert.equal(changes(),before+1);assert.notEqual(s.collections(),view);
});

test('family inference excludes other working directories before parsing their tool histories',t=>{
    const s=setup(t),project=s.project('Filed');
    s.branch(project.id,'Other','codex',codexSample('/other',[['Shared initial question','Shared answer'],['Next','Reply']]));
    const a=s.branch(null,'Candidate A','codex',codexSample('/candidate',[['Shared initial question','Shared answer'],['Next','Reply']]));
    s.branch(null,'Candidate B','codex',codexSample('/candidate',[['Shared initial question','Shared answer'],['Next','Reply'],['Suffix','Final']]));
    // Native discovery persists these summaries before family inference runs.
    for(const branch of s.all('branch'))s.summary(branch.head,branch.agent);
    const original=s.parsed.bind(s);s.parsed=(...args)=>{const parsed=original(...args);assert.notEqual(parsed.cwd,'/other');return parsed;};
    assert.ok(s.detectFamilies().grouped>0);assert.ok(s.get('branch',a.id).parentId);
});

test('tree projections stay identical when raw parse results cannot be cached',t=>{
    const s=setup(t),b=s.branch(null,'Root','codex',codexSample('/fixture',[['First','Done'],['Next','Result']]));
    s.fork(b.id,{name:'Fork',end:s.detail(b.id).checkpoints[0].end});
    const expected=s.treeGraph(b.id);s.invalidate();
    const original=s.parsed.bind(s),reads=new Map();
    s.parsed=(revision,agent,end)=>{s.parseCache.clear();s.parseBytes=0;const key=agent+':'+revision+':'+end;reads.set(key,(reads.get(key)||0)+1);return original(revision,agent,end);};
    assert.deepEqual(s.treeGraph(b.id),expected);
    assert.ok([...reads.values()].every(n=>n===1),'each revision/prefix is projected once even without a raw parse cache');
});

test('async tree loading yields measured path progress and never caches a mixed revision',async t=>{
 const s=setup(t),b=s.branch(null,'Root','codex',codexSample('/fixture',[['First','Done'],['Next','Result']]));
 s.fork(b.id,{name:'Fork',end:s.detail(b.id).checkpoints[0].end});
 const expected=s.treeGraph(b.id,'in-use');s.invalidate();let ticked=false;setImmediate(()=>{ticked=true;});const progress=[];
 const actual=await s.treeGraphAsync(b.id,'in-use',{onProgress:async p=>{progress.push(p);await new Promise(r=>setImmediate(r));}});
 assert.equal(ticked,true);assert.deepEqual(actual,expected);assert.ok(progress.some(p=>p.completed===1&&p.total===2));
 s.invalidate();let changed=false;
 await assert.rejects(s.treeGraphAsync(b.id,'in-use',{onProgress:async()=>{if(!changed){changed=true;s.put('branch',{...s.get('branch',b.id),name:'Updated during load'});}}}),/Session changed while loading/);
 assert.ok(!s.memoCache.has('graph:'+b.id));assert.equal((await s.treeGraphAsync(b.id,'in-use')).name,'Updated during load');
});

test('a mutation after graph construction cannot publish a stale async cache',async t=>{
 const s=setup(t),b=s.branch(null,'Before','codex',codexSample('/fixture',[['First','Done']]));
 await assert.rejects(s.treeGraphAsync(b.id,'in-use',{onProgress:async progress=>{
  if(progress.phase==='Building conversation tree')queueMicrotask(()=>queueMicrotask(()=>s.put('branch',{...s.get('branch',b.id),name:'After'})));
 }}),/Session changed while loading/);
 assert.ok(!s.memoCache.has('graph:'+b.id));
 assert.equal(s.treeGraph(b.id,'in-use').name,'After');
});

test('renaming reuses only lightweight revision projections and changed history is reread',t=>{
 const s=setup(t),b=s.branch(null,'Session','codex',codexSample('/fixture',[['First','Done'],['Tail','Result']]));
 s.fork(b.id,{name:'Child',end:s.detail(b.id).checkpoints[0].end});
 const graph=s.treeGraph(b.id,'in-use'),node=graph.nodes[0];
 s.parseCache.clear();s.parseBytes=0;s.recordCache.clear();s.recordBytes=0;
 const parsed=s.parsed.bind(s);let reads=0;s.parsed=(...args)=>{reads++;return parsed(...args);};
 s.organize(b.id,{action:'rename',nodeId:node.id,pathId:node.branchIds[0],version:graph.version,name:'Renamed'});
 const renamed=s.treeGraph(b.id,'in-use');assert.equal(renamed.nodes.find(n=>n.id===node.id).name,'Renamed');assert.equal(reads,0);
 for(const projection of s.graphProjections.values.values()){assert.ok(!projection.p.records);assert.ok(projection.p.messages.every(m=>m.role!=='tool'));}
 const expected=structuredClone(renamed);s.graphProjections=null;s.invalidate();assert.deepEqual(s.treeGraph(b.id,'in-use'),expected);
 const head=s.get('branch',b.id).head;s.ingest(b.id,codexSample('/fixture',[['Replaced','New answer']]),head,{});reads=0;
 s.treeGraph(b.id,'in-use');assert.ok(reads>0,'new revision invalidates old projection inputs');
 const other=s.branch(null,'Other','codex',codexSample('/elsewhere',[['Other','Done']]));s.treeGraph(other.id);assert.equal(s.graphProjections.rootId,other.id,'at most one tree retains projections');
});

test('sync fingerprint reuse stays equivalent to a cold calculation across mutations and cleanup',async t=>{
 const s=setup(t),{GitCloud}=await import('../src/git-cloud.js'),{stageTrash,cleanupLocal}=await import('../src/trash.js'),p=s.project('P'),q=s.project('Q');
 const a=s.branch(p.id,'A','codex',codexSample('/fixture',[['A','Ready'],['Next','Done']])),b=s.branch(q.id,'B','codex',codexSample('/fixture',[['B','Ready']])),cloud=new GitCloud(s,()=>({url:'git@example.invalid:test/data.git'}));
 const check=()=>{const warm=cloud.dirtyIds().sort(),values=s.syncCollections().items.map(i=>[i.id,s.memoCache.get('fingerprint:'+i.id)]);s.invalidate();assert.deepEqual(cloud.dirtyIds().sort(),warm);assert.deepEqual(s.syncCollections().items.map(i=>[i.id,s.memoCache.get('fingerprint:'+i.id)]),values);};
 requireFingerprints(s,cloud);cloud.dirtyIds();const cache=cloud.cache();for(const root of s.syncCollections().items)cache.ack[root.id]=hash(JSON.stringify(treeSnapshot(s,root.id)));cloud.save(cache);
 s.edit(a.id,{name:'A renamed'});assert.ok(s.memoCache.has('fingerprint:'+b.id),'an unrelated tree keeps its small fingerprint');check();
 s.fork(a.id,{name:'New fork',end:s.detail(a.id).checkpoints[0].end});check();
 s.put('project',{...q,name:'Q renamed'});check();
 const revision=s.get('revision',b.head);s.put('revision',{...revision,source:{...revision.source,testMarker:true}});check();
 try{s.transaction(()=>{s.put('branch',{...s.get('branch',b.id),name:'Rolled back'});throw Error('rollback');});}catch{}check();assert.equal(s.get('branch',b.id).name,'B');
 stageTrash(s,[a.id]);cleanupLocal(s);check();
});

test('native availability changes and cleanup do not rebuild unaffected sync graphs',async t=>{
 const s=setup(t),{GitCloud}=await import('../src/git-cloud.js'),{stageTrash,cleanupLocal}=await import('../src/trash.js'),a=s.branch(null,'A','codex',codexSample('/fixture',[['A','Ready']])),b=s.branch(null,'B','codex',codexSample('/fixture',[['B','Ready']])),cloud=new GitCloud(s,()=>({url:'git@example.invalid:test/data.git'}));
 const retired=s.branch(null,'Earlier trash','codex',codexSample('/fixture',[['Old','Ready']]));stageTrash(s,[retired.id]);cleanupLocal(s);
 requireFingerprints(s,cloud);cloud.dirtyIds();s.local('instances',[{id:'native',branchId:b.id,applied:true}]);const build=s.buildExportGraph;s.buildExportGraph=()=>{throw Error('No unchanged export should be rebuilt');};assert.ok(cloud.dirtyIds().includes(b.id));s.buildExportGraph=build;
 stageTrash(s,[a.id]);cleanupLocal(s);s.buildExportGraph=()=>{throw Error('The remaining tree is unchanged');};assert.deepEqual(cloud.dirtyIds(),[b.id]);s.buildExportGraph=build;
});

test('async cleanup keeps the event loop alive and discards a stale reclamation plan',async t=>{
 const s=setup(t),{stageTrash,cleanupLocalAsync}=await import('../src/trash.js'),raw=codexSample('/fixture',[['Recover this','Ready']]),b=s.branch(null,'Removed','codex',raw);stageTrash(s,[b.id]);
 let replacement,ticks=0;const timer=setInterval(()=>ticks++,1);
 try{const result=await cleanupLocalAsync(s,{onProgress:async p=>{if(p.phase==='Removing unused local records')replacement=s.branch(null,'Arrived during cleanup','codex',raw);}});assert.equal(result.deferred,true);assert.ok(ticks>0,'history preparation yields to timers');assert.equal(s.raw(replacement.head),raw);assert.equal(s.cleanupDeferred,true);}finally{clearInterval(timer);}
 await cleanupLocalAsync(s);assert.equal(s.raw(s.get('branch',replacement.id).head),raw);
});

test('shared revisions invalidate every dependent tree fingerprint',t=>{
 const s=setup(t),a=s.branch(null,'A','codex',codexSample('/fixture',[['Shared','Ready']])),b=s.branch(null,'B','codex',codexSample('/fixture',[['Other','Ready']]));
 s.put('branch',{...b,head:a.head});const cloud=new Cloud(s,()=>({}));requireFingerprints(s,cloud);cloud.dirtyIds();
 const revision=s.get('revision',a.head);s.put('revision',{...revision,source:{...revision.source,marker:'changed'}});cloud.dirtyIds();
 const values=[a,b].map(b=>s.memoCache.get('fingerprint:'+b.id));s.invalidate();cloud.dirtyIds();assert.deepEqual([a,b].map(b=>s.memoCache.get('fingerprint:'+b.id)),values);
});

test('never-uploaded trees stay pending without exporting or hashing their histories',t=>{
 const s=setup(t),b=s.branch(null,'New tree','codex',codexSample('/fixture',[['New conversation','Ready']])),cloud=new Cloud(s,()=>({}));
 const build=s.buildExportGraph;s.buildExportGraph=()=>assert.fail('An unacknowledged tree needs no export');
 assert.deepEqual(cloud.dirtyIds(),[b.id]);s.edit(b.id,{name:'Renamed before the first upload'});assert.deepEqual(cloud.dirtyIds(),[b.id]);
 s.buildExportGraph=build;const cache=cloud.cache();cache.ack[b.id]=hash(JSON.stringify(treeSnapshot(s,b.id)));s.local(cloud.cacheKey,cache);assert.deepEqual(cloud.dirtyIds(),[]);
 s.edit(b.id,{name:'A real change after acknowledgement'});assert.deepEqual(cloud.dirtyIds(),[b.id]);
});
