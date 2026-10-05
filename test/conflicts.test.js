import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {codexSample,codexTurn} from '../src/demo.js';import {metadata} from '../src/organization.js';import {conflictItems,resolveConflicts,repairInheritedProjectConflicts,clearConflictFailure} from '../src/conflicts.js';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-conflict-')),store=new Store(path.join(root,'library')),native=new Native(store,{roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});return {root,store,native};}
const graphCopy=(a,b,options)=>b.merge(a.exportGraph(),Object.fromEntries(a.db.prepare('SELECT hash,body FROM objects').all().map(r=>[r.hash,r.body])),options);
const selected=s=>conflictItems(s).map(({id,version})=>({id,version}));
const append=()=>codexTurn('Later question','Later result').map(v=>JSON.stringify(v)+'\n').join('');

test('derived child projects are normalized before merge and stale same-version project conflicts are repaired',t=>{
 const a=fixture(t),b=fixture(t),project=a.store.project('Filed'),parent=a.store.branch(project.id,'Root','codex',codexSample(a.root,[['Question','Answer']])),child=a.store.fork(parent.id,{name:'Child',end:a.store.detail(parent.id).checkpoints[0].end});
 graphCopy(a.store,b.store);const remote={...a.store.get('branch',child.id),projectId:null};
 a.store.put('branch',remote);const result=graphCopy(a.store,b.store,{latest:true});assert.equal(result.conflicts,0);assert.equal(b.store.get('branch',child.id).projectId,project.id);
 const current=b.store.get('branch',child.id);b.store.local('conflicts',[{kind:'branch',local:current,remote}]);assert.equal(repairInheritedProjectConflicts(b.store),1);assert.equal(b.store.local('conflicts').length,0);
 b.store.local('conflicts',[{kind:'branch',local:current,remote:{...remote,name:'Real different title'}}]);assert.equal(repairInheritedProjectConflicts(b.store),0,'a real field difference is not silently repaired');
});

for(const choice of ['previous','current'])test(`${choice} persists metadata and acknowledges both parents across repeated merges`,async t=>{
 const a=fixture(t),b=fixture(t),project=a.store.project('Original'),session=a.store.branch(project.id,'Initial','codex',codexSample(a.root,[['Question','Answer']]));graphCopy(a.store,b.store);
 a.store.edit(session.id,{name:'Current local title'});b.store.edit(session.id,{name:'Previous synced title'});const remote=b.store.exportGraph();graphCopy(b.store,a.store);
 const items=conflictItems(a.store);assert.equal(items.length,1);assert.ok(items[0].changes.some(c=>c.previous==='Previous synced title'&&c.current==='Current local title'));
 await resolveConflicts(a.store,a.native,selected(a.store),choice);
 assert.equal(a.store.get('branch',session.id).name,choice==='previous'?'Previous synced title':'Current local title');assert.equal(a.store.local('conflicts').length,0);
 for(let n=0;n<3;n++)assert.equal(a.store.merge(remote,{}).conflicts,0);
 assert.equal(graphCopy(a.store,b.store).conflicts,0);assert.equal(graphCopy(b.store,a.store).conflicts,0);
 a.native.refreshLocal();assert.equal(a.store.local('conflicts').length,0);
});

test('project choices merge ancestry rather than only removing the pending conflict',async t=>{
 const a=fixture(t),b=fixture(t),p=a.store.project('Original');a.store.branch(p.id,'Session','codex',codexSample(a.root,[['Q','A']]));graphCopy(a.store,b.store);
 a.store.put('project',metadata(a.store.get('project',p.id),{name:'Current'}));b.store.put('project',metadata(b.store.get('project',p.id),{name:'Previous'}));const remote=b.store.exportGraph();graphCopy(b.store,a.store);
 await resolveConflicts(a.store,a.native,selected(a.store),'previous');assert.equal(a.store.get('project',p.id).name,'Previous');assert.equal(a.store.merge(remote,{}).conflicts,0);assert.equal(graphCopy(a.store,b.store).conflicts,0);
});

test('a stale multi-item selection rejects the whole batch and preserves all conflicts',async t=>{
 const {store:s,native}=fixture(t);for(let n=0;n<2;n++){const b=s.branch(null,'Current '+n,'codex',codexSample('/fixture',[['Q','A']]));s.local('conflicts',[...(s.local('conflicts')||[]),{kind:'branch',local:b,remote:metadata(b,{name:'Previous '+n})}]);}
 const choices=selected(s),conflicts=s.local('conflicts');s.edit(conflicts[1].local.id,{name:'New edit'});
 await assert.rejects(resolveConflicts(s,native,choices,'previous'),/Conflicts changed/);assert.deepEqual(s.local('conflicts'),conflicts);assert.equal(s.get('branch',conflicts[0].local.id).name,'Current 0');
});

test('previous history is recoverable and detached client records cannot resurrect it on Update',async t=>{
 const f=fixture(t),s=f.store,initial=codexSample(f.root,[['First','Answer']]),b=s.branch(null,'Session','codex',initial);f.native.setActive(b.id,f.root,true);f.native.apply([b.id]);
 const remote=s.revision(initial+codexTurn('Remote question','Remote answer').map(v=>JSON.stringify(v)+'\n').join(''),b.head,{operation:'remote'}),current=s.get('branch',b.id);
 s.local('conflicts',[{kind:'session',local:current,remote:{...current,head:remote.id}}]);const oldInstance=s.instances()[0],oldFile=oldInstance.file;
 const result=await resolveConflicts(s,f.native,selected(s),'previous',{deactivate:async ids=>{for(const id of ids)f.native.setActive(id,null,false);f.native.apply(ids);}});
 assert.ok(result.recoveryId);assert.equal(s.get('branch',b.id).head,remote.id);assert.equal(s.instances().some(i=>i.nativeId===oldInstance.nativeId),false);assert.ok(s.local('discardedNative').some(i=>i.nativeId===oldInstance.nativeId));
 // A native copy reappearing at its old identity must remain suppressed.
 fs.mkdirSync(path.dirname(oldFile),{recursive:true});fs.writeFileSync(oldFile,initial+append());f.native.refreshLocal();assert.equal(s.get('branch',b.id).head,remote.id);assert.equal(s.local('conflicts').length,0);
 const priorGraph={schema:3,projects:[],branches:[current],nodes:[],layouts:[],revisions:[s.get('revision',current.head)]};assert.equal(s.merge(priorGraph,{}).forks,0);assert.equal(s.get('branch',b.id).head,remote.id);
});

test('resolved organization chains acknowledge both alternatives across sync',async t=>{
 const a=fixture(t),b=fixture(t),session=a.store.branch(null,'Session','codex',codexSample(a.root,[['First','Answer'],['Second','Reply']]));graphCopy(a.store,b.store);
 for(const [f,index,name] of [[a,0,'Current node'],[b,1,'Previous node']]){const d=f.store.detail(session.id);f.store.commitPending(session.id,{name,end:d.checkpoints[index].end,revisionId:d.head,expectedStart:0});}
 graphCopy(b.store,a.store);assert.equal(a.store.local('conflicts')[0].kind,'organization');await resolveConflicts(a.store,a.native,selected(a.store),'previous');assert.equal(a.store.detail(session.id).nodes[0].name,'Previous node');assert.equal(graphCopy(b.store,a.store).conflicts,0);assert.equal(graphCopy(a.store,b.store).conflicts,0);
});

test('clearing a resolved conflict failure leaves unrelated errors intact',()=>{
 const saved=new Map(),store={};
 store.local=(k,...value)=>value.length?(saved.set(k,value[0]),value[0]):saved.get(k);saved.set('conflicts',[]);
 const sync={store,lastFailure:{error:'Resolve sync conflicts before uploading.'},lastManualOperation:{error:'Resolve sync conflicts before uploading.'},operation:{error:'Resolve sync conflicts before uploading.'},error:'Resolve sync conflicts before uploading.',needsReview:{retry:true}};clearConflictFailure(sync);assert.equal(sync.error,null);assert.equal(sync.lastManualOperation,null);
 sync.error='Network failed';sync.lastFailure={error:'Network failed'};clearConflictFailure(sync);assert.equal(sync.error,'Network failed');assert.equal(sync.lastFailure.error,'Network failed');
});

test('content conflicts expose bounded differing messages and reject unavailable previous history safely',async t=>{
 const {store:s,native}=fixture(t),b=s.branch(null,'Session','codex',codexSample('/fixture',[['Common','Answer'],['Current text','Current reply']])),r=s.revision(codexSample('/fixture',[['Common','Answer'],['Previous text','Previous reply']]),null,{operation:'remote'});
 s.local('conflicts',[{kind:'session',local:b,remote:{...b,head:r.id}}]);let item=conflictItems(s)[0],change=item.changes.find(c=>c.field==='Conversation history');assert.equal(change.previousMessages[0].text,'Previous text');assert.equal(change.currentMessages[0].text,'Current text');
 s.db.prepare('DELETE FROM objects WHERE hash=?').run(r.refs.at(-1));s.parseCache.clear();s.parseBytes=0;s.recordCache.clear();s.recordBytes=0;
 item=conflictItems(s)[0];assert.equal(item.changes.find(c=>c.field==='Conversation history').previewUnavailable,true);
 await assert.rejects(resolveConflicts(s,native,[{id:item.id,version:item.version}],'previous'),/previous history is unavailable/);assert.equal(s.get('branch',b.id).head,b.head);assert.equal(s.local('conflicts').length,1);
});

test('a failed batch metadata write rolls back every selected choice',async t=>{
 const {store:s,native}=fixture(t),conflicts=[];for(let i=0;i<2;i++){const b=s.branch(null,'Current '+i,'codex',codexSample('/fixture',[['Q','A']]));conflicts.push({kind:'branch',local:b,remote:metadata(b,{name:'Previous '+i})});}s.local('conflicts',conflicts);
 const selections=selected(s),put=s.put.bind(s);let writes=0;s.put=(kind,value)=>{if(kind==='branch'&&++writes===2)throw Error('Synthetic second write failed');return put(kind,value);};
 await assert.rejects(resolveConflicts(s,native,selections,'previous'),/second write failed/);for(const c of conflicts)assert.deepEqual(s.get('branch',c.local.id),c.local);assert.deepEqual(s.local('conflicts'),conflicts);
});
