import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {GitCloud} from '../src/git-cloud.js';import {treeSnapshot} from '../src/cloud-view.js';import {changeSnapshot} from '../src/session-changes.js';import {discardChanges} from '../src/discard-changes.js';import {Intelligence} from '../src/intelligence.js';import {metadata} from '../src/organization.js';import {codexSample,codexTurn} from '../src/demo.js';import {hash} from '../src/util.js';
function setup(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'grove-organization-discard-'))),store=new Store(root),cloud=new GitCloud(store,()=>({url:'git@example.invalid:fixture/data.git'})),snapshots=new Map();cloud.useSavedCache();cloud.organizationBaseline=async id=>snapshots.get(id)||null;t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return {root,store,cloud,snapshots,sync:id=>{const graph=structuredClone(treeSnapshot(store,id));snapshots.set(id,graph);const c=cloud.cache();c.ack[id]=hash(JSON.stringify(graph));(c.baselines||={})[id]=changeSnapshot(graph);cloud.save(c);}};}
const append=(store,b)=>store.ingest(b.id,store.raw(store.get('branch',b.id).head)+codexTurn('New private conversation','Must stay').map(r=>JSON.stringify(r)+'\n').join(''),store.get('branch',b.id).head,{operation:'capture'});
const forbiddenNative={collect(){assert.fail('Organization discard must not collect or modify native history');}};

test('organization discard restores labels and projects while preserving appended messages, forks and active files',async t=>{
 const f=setup(t),{store:s,cloud:c}=f,p=s.project('Original project'),b=s.branch(p.id,'Original session','codex',codexSample(f.root,[['First','Answer']]));
 let graph=s.treeGraph(b.id);s.organize(b.id,{version:graph.version,pathId:b.id,nodeId:graph.nodes[0].id,action:'rename',name:'Original node'});f.sync(b.id);
 append(s,b);const fork=s.fork(b.id,{name:'New continuation',end:s.detail(b.id).checkpoints.at(-1).end});
 s.edit(b.id,{name:'Wrong title'});s.checkpointProject(p.id);s.put('project',metadata(p,{name:'Wrong project'}));
 graph=s.treeGraph(b.id);s.organize(b.id,{version:graph.version,pathId:b.id,nodeId:graph.nodes[0].id,action:'rename',name:'Wrong node',nameOrigin:'automatic'});
 const file=path.join(f.root,'active.jsonl'),raw=s.raw(s.get('branch',b.id).head);fs.writeFileSync(file,raw);s.local('instances',[{id:'native',branchId:b.id,nativeId:'native-id',agent:'codex',applied:true,desired:true,file,baseRevision:s.get('branch',b.id).head}]);
 const heads=s.all('branch').map(v=>[v.id,v.head]),instances=JSON.stringify(s.instances()),records=s.db.prepare('SELECT count(*) n FROM objects').get().n;
 const result=await discardChanges(s,c,forbiddenNative,c.pendingItems(),{deactivate:()=>assert.fail('No deactivation')});
 assert.equal(result.discarded,1);assert.equal(result.confirmationRequired,undefined);assert.deepEqual(s.all('branch').map(v=>[v.id,v.head]),heads);assert.equal(s.raw(s.get('branch',b.id).head),raw);assert.ok(s.find('branch',fork.id));assert.equal(fs.readFileSync(file,'utf8'),raw);assert.equal(JSON.stringify(s.instances()),instances);assert.equal(s.db.prepare('SELECT count(*) n FROM objects').get().n,records);
 assert.equal(s.get('branch',b.id).name,'Original session');assert.equal(s.get('project',p.id).name,'Original project');assert.ok(s.treeGraph(b.id).nodes.some(n=>n.name==='Original node'));assert.ok(!s.treeGraph(b.id).nodes.some(n=>n.name==='Wrong node'));
 const changes=c.pendingItems().flatMap(i=>i.changes);assert.ok(changes.some(v=>v.kind==='transcript-appended'));assert.ok(changes.some(v=>v.kind==='session-added'));assert.ok(!changes.some(v=>v.kind==='session-renamed'||v.kind==='project-renamed'||v.kind==='node-renamed'));assert.ok(c.pendingItems().every(i=>!i.discardable));
 assert.equal((s.local('trashEntries')||[]).length,0);assert.ok(!JSON.stringify(s.local('organization-recovery:'+result.recoveryId)).includes('New private conversation'));
});
test('never-synced sessions undo their recorded organization edits without removing any history',async t=>{
 const {root,store:s,cloud:c}=setup(t),b=s.branch(null,'Native name','codex',codexSample(root,[['Question','Answer']]));s.edit(b.id,{name:'Wrong name'});append(s,b);const head=s.get('branch',b.id).head;
 const result=await discardChanges(s,c,forbiddenNative,c.pendingItems());assert.equal(result.discarded,1);assert.equal(s.get('branch',b.id).head,head);assert.equal(s.get('branch',b.id).name,'Native name');assert.match(s.raw(head),/New private conversation/);assert.equal(c.pendingItems()[0].discardable,false);
});
test('content-only selections report no organization edits and retain pending content',async t=>{
 const f=setup(t),b=f.store.branch(null,'Session','codex',codexSample(f.root,[['Question','Answer']]));f.sync(b.id);append(f.store,b);const head=f.store.get('branch',b.id).head,phases=[];
 assert.equal(f.cloud.pendingItems()[0].discardable,false);const result=await discardChanges(f.store,f.cloud,forbiddenNative,f.cloud.pendingItems(),{onProgress:async p=>phases.push(p.phase)});assert.equal(result.discarded,0);assert.equal(phases.at(-1),'No organization changes to discard.');assert.equal(f.store.get('branch',b.id).head,head);assert.ok(f.cloud.dirtyIds().length);
});
test('an earlier organization checkpoint never makes a newly added fork discardable',async t=>{
 const f=setup(t),b=f.store.branch(null,'Session','codex',codexSample(f.root,[['Question','Answer']]));f.sync(b.id);f.store.checkpointOrganization(b.id);
 const child=f.store.fork(b.id,{name:'New path',end:f.store.detail(b.id).checkpoints[0].end});assert.equal(f.cloud.pendingItems()[0].discardable,false);
 const result=await discardChanges(f.store,f.cloud,forbiddenNative,f.cloud.pendingItems());assert.equal(result.discarded,0);assert.equal(f.store.get('branch',child.id).head,child.head);
});
test('conversation growth during an organization rollback remains intact',async t=>{
 const f=setup(t),b=f.store.branch(null,'Original','codex',codexSample(f.root,[['Question','Answer']]));f.sync(b.id);f.store.edit(b.id,{name:'Wrong'});let head;
 await discardChanges(f.store,f.cloud,forbiddenNative,f.cloud.pendingItems(),{onProgress:async p=>{if(p.phase==='Restoring organization changes'){append(f.store,b);head=f.store.get('branch',b.id).head;}}});
 assert.equal(f.store.get('branch',b.id).head,head);assert.equal(f.store.get('branch',b.id).name,'Original');assert.match(f.store.raw(head),/New private conversation/);assert.equal(f.cloud.pendingItems()[0].discardable,false);
});
test('classification and later project-name edits revert without removing new paths or projects',async t=>{
 const f=setup(t),a=f.store.project('A'),b=f.store.project('B'),s=f.store.branch(a.id,'Session','codex',codexSample(f.root,[['Question','Answer']]));f.sync(s.id);
 f.store.moveItems({itemIds:[s.id],projectId:b.id});f.store.checkpointProject(b.id);f.store.put('project',metadata(b,{name:'Wrong B'}));
 const child=f.store.fork(s.id,{name:'New path',end:f.store.detail(s.id).checkpoints[0].end});const heads=f.store.all('branch').map(v=>[v.id,v.head]);
 await discardChanges(f.store,f.cloud,forbiddenNative,f.cloud.pendingItems());
 assert.deepEqual(f.store.all('branch').map(v=>[v.id,v.head]),heads);assert.equal(f.store.get('branch',s.id).projectId,a.id);assert.equal(f.store.get('branch',child.id).projectId,a.id);assert.equal(f.store.get('project',b.id).name,'B');
});
test('discard can restore a dissolved node label without changing its conversation',async t=>{
 const f=setup(t),b=f.store.branch(null,'Session','codex',codexSample(f.root,[['Question','Answer']]));let g=f.store.treeGraph(b.id);
 f.store.organize(b.id,{version:g.version,pathId:b.id,nodeId:g.nodes[0].id,action:'rename',name:'Saved label'});f.sync(b.id);g=f.store.treeGraph(b.id);
 f.store.organize(b.id,{version:g.version,pathId:b.id,chatIds:g.nodes[0].chatIds,action:'dissolve'});assert.ok(f.cloud.pendingItems()[0].discardable);
 await discardChanges(f.store,f.cloud,forbiddenNative,f.cloud.pendingItems());assert.equal(f.store.get('branch',b.id).head,b.head);assert.ok(f.store.treeGraph(b.id).nodes.some(n=>n.name==='Saved label'));assert.equal(f.cloud.pendingItems().length,0);
});
test('discarded automatic labels are not recreated by refresh or restart with unchanged conversations',async t=>{
 const f=setup(t),b=f.store.branch(null,'Native name','codex',codexSample(f.root,[['Question','Answer']]));fs.writeFileSync(path.join(f.root,'intelligence.json'),JSON.stringify({apiKey:'synthetic-key',classify:true,nameNodes:false}));let calls=0;
 const request=async()=>{calls++;return {name:'Automatic label'};};let smart=new Intelligence(f.store,{request});
 try{
  clearTimeout(smart.timer);await smart.run();await smart.pending;assert.equal(f.store.get('branch',b.id).sessionName,'Automatic label');
  await discardChanges(f.store,f.cloud,forbiddenNative,f.cloud.pendingItems());smart.observe();await smart.run();await smart.pending;assert.equal(calls,1);assert.equal(f.store.get('branch',b.id).sessionName,undefined);
  smart.close();await smart.pending;smart=new Intelligence(f.store,{request});smart.observe();await smart.run();await smart.pending;assert.equal(calls,1);assert.equal(smart.data.jobs.length,0);
  assert.equal(smart.status().awaitingConfirmation,1);
  append(f.store,b);smart.observe();await smart.run();await smart.pending;assert.equal(calls,1,'new messages must not resume discarded organization');
  smart.retry();clearTimeout(smart.timer);await smart.run();await smart.pending;assert.equal(calls,2);assert.equal(smart.status().awaitingConfirmation,0);assert.equal(f.store.get('branch',b.id).sessionName,'Automatic label');
 }finally{smart.close();await smart.pending;}
});

test('discard rejects a selection made before a later organization edit',async t=>{
 const f=setup(t),b=f.store.branch(null,'Original','codex',codexSample(f.root,[['Question','Answer']]));f.sync(b.id);
 f.store.edit(b.id,{name:'First edit'});const selected=f.cloud.pendingItems();f.store.edit(b.id,{name:'Later edit'});
 await assert.rejects(discardChanges(f.store,f.cloud,forbiddenNative,selected),e=>e.status===409);
 assert.equal(f.store.get('branch',b.id).name,'Later edit');
});

test('appended conversation after selection does not make an organization rollback stale',async t=>{
 const f=setup(t),b=f.store.branch(null,'Original','codex',codexSample(f.root,[['Question','Answer']]));f.sync(b.id);
 f.store.edit(b.id,{name:'Wrong'});const selected=f.cloud.pendingItems();append(f.store,b);const head=f.store.get('branch',b.id).head;
 await discardChanges(f.store,f.cloud,forbiddenNative,selected);assert.equal(f.store.get('branch',b.id).name,'Original');assert.equal(f.store.get('branch',b.id).head,head);
});

test('returning a tree to its project preserves a separate edit to that project',async t=>{
 const f=setup(t),a=f.store.project('A'),b=f.store.project('B'),session=f.store.branch(a.id,'Session','codex',codexSample(f.root,[['Question','Answer']]));f.sync(session.id);
 f.store.moveItems({itemIds:[session.id],projectId:b.id});f.store.put('project',metadata(a,{name:'A renamed elsewhere'}));
 const selected=f.cloud.pendingItems();await discardChanges(f.store,f.cloud,forbiddenNative,selected);
 assert.equal(f.store.get('branch',session.id).projectId,a.id);assert.equal(f.store.get('project',a.id).name,'A renamed elsewhere');
});

test('discard preserves client-synchronized transcription titles and their pending upload',async t=>{
 const f=setup(t),b=f.store.branch(null,'Original','codex',codexSample(f.root,[['Question','Answer']]));f.sync(b.id);
 f.store.checkpointOrganization(b.id);f.store.put('branch',metadata(f.store.get('branch',b.id),{transcriptionTitle:'Client title',transcriptionNameOrigin:'manual'}));
 f.store.edit(b.id,{name:'Wrong Grove label'});await discardChanges(f.store,f.cloud,forbiddenNative,f.cloud.pendingItems());
 assert.equal(f.store.get('branch',b.id).name,'Original');assert.equal(f.store.get('branch',b.id).transcriptionTitle,'Client title');assert.equal(f.cloud.dirtyIds().length,1);assert.equal(f.cloud.pendingItems()[0].discardable,false);
});

test('a batch with incompatible shared project baselines leaves every selection untouched',async t=>{
 const f=setup(t),p=f.store.project('First name'),a=f.store.branch(p.id,'A','codex',codexSample(f.root,[['A','Answer']]));f.sync(a.id);
 f.store.put('project',metadata(p,{name:'Second name'}));const b=f.store.branch(p.id,'B','codex',codexSample(f.root,[['B','Answer']]));f.sync(b.id);
 f.store.put('project',metadata(f.store.get('project',p.id),{name:'Current name'}));f.store.edit(a.id,{name:'A edit'});f.store.edit(b.id,{name:'B edit'});
 await assert.rejects(discardChanges(f.store,f.cloud,forbiddenNative,f.cloud.pendingItems()),e=>e.status===409);
 assert.equal(f.store.get('project',p.id).name,'Current name');assert.equal(f.store.get('branch',a.id).name,'A edit');assert.equal(f.store.get('branch',b.id).name,'B edit');
});
