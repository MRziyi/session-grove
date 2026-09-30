import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {codexSample,codexTurn,claudeSample} from '../src/demo.js';import {stageTrash,restoreTrash,cleanupLocal,expireTrash} from '../src/trash.js';import {moveNativeToRecovery,deleteRecoveryCopies,nativeTrashCandidates} from '../src/trash-actions.js';
function setup(t,agent='codex'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-trash-action-')),store=new Store(path.join(root,'library')),native=new Native(store,{roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
 const b=store.branch(null,'Discarded',agent,(agent==='codex'?codexSample:claudeSample)(root,[['Original','Answer']]));native.setActive(b.id,root,true);native.apply([b.id]);const instance=store.instances()[0];
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return{root,store,native,b,instance};
}
const options={checkFile:()=>{},archive:async()=>{}};
test('moving a changed native copy first saves its latest content and does not require the whole Codex process to exit',async t=>{
 const {store,native,b,instance}=setup(t);stageTrash(store,[b.id],[b.id]);cleanupLocal(store);
 fs.appendFileSync(instance.file,codexTurn('Latest work','Keep this too').map(r=>JSON.stringify(r)+'\n').join(''));
 native.guard=()=>{throw Error('Whole IDE is running');};
 const result=await moveNativeToRecovery(store,native,[instance.id],options);assert.deepEqual(result.blocked,[]);assert.deepEqual(result.moved,[instance.id]);assert.equal(fs.existsSync(instance.file),false);
 const restored=restoreTrash(store,result.recoveryIds[0]);assert.match(store.raw(store.get('branch',restored.branchIds[0]).head),/Latest work/);
});
test('a busy selected file stays intact and returns a per-copy reason',async t=>{
 const {store,native,b,instance}=setup(t);stageTrash(store,[b.id],[b.id]);
 const before=fs.readFileSync(instance.file,'utf8');const result=await moveNativeToRecovery(store,native,[instance.id],{...options,checkFile:()=>{throw Error('Selected file busy');}});
 assert.equal(result.moved.length,0);assert.match(result.blocked[0].reason,/busy/);assert.equal(fs.readFileSync(instance.file,'utf8'),before);
});
test('client-archived copies can enter recovery and immediate deletion removes only the selected backup',async t=>{
 const {store,native,b,instance}=setup(t);store.edit(b.id,{archived:true});assert.equal(nativeTrashCandidates(store).length,1);
 const result=await moveNativeToRecovery(store,native,[instance.id],options);assert.deepEqual(result.blocked,[]);const entry=result.recoveryIds[0];
 assert.ok(fs.existsSync(path.join(store.root,'trash',entry+'.json.gz')));deleteRecoveryCopies(store,[entry]);assert.equal(fs.existsSync(path.join(store.root,'trash',entry+'.json.gz')),false);assert.throws(()=>restoreTrash(store,entry),/expired/);
});
test('Claude companion files are saved in recovery before removing the client copy',async t=>{
 const {store,native,b,instance}=setup(t,'claude');stageTrash(store,[b.id],[b.id]);
 const companion=path.join(path.dirname(instance.file),instance.nativeId);fs.mkdirSync(companion,{recursive:true});fs.writeFileSync(path.join(companion,'context.txt'),'Companion bytes');
 const result=await moveNativeToRecovery(store,native,[instance.id],options);assert.deepEqual(result.blocked,[]);assert.equal(fs.existsSync(companion),false);
 const restored=restoreTrash(store,result.recoveryIds[0]),head=store.get('revision',store.get('branch',restored.branchIds[0]).head);
 assert.equal(Buffer.from(head.source.auxiliary[0].data,'base64').toString(),'Companion bytes');
});

test('moving one archived native instance preserves another active copy of the same Grove session',async t=>{
 const {root,store,native,b,instance}=setup(t),other=path.join(root,'other');fs.mkdirSync(other);
 native.setActive(b.id,other,true);native.apply([b.id]);store.local('instances',store.instances().map(i=>i.id===instance.id?{...i,applied:false,desired:false,nativeArchived:true}:i));
 const result=await moveNativeToRecovery(store,native,[instance.id],options);assert.deepEqual(result.blocked,[]);
 assert.ok(store.syncCollections().items.some(item=>item.sessionIds.includes(b.id)));assert.ok(store.instances().some(i=>i.id!==instance.id&&i.applied&&fs.existsSync(i.file)));
});

test('SSH verification failures give actionable reasons and preserve the saved repository',async t=>{
 const {store}=setup(t);const {GitSettings,connectionError}=await import('../src/git-settings.js');const {GitCloud}=await import('../src/git-cloud.js');
 const file=path.join(store.root,'git-sync.json'),saved={provider:'git',url:'git@github.com:owner/kept.git',verified:true};fs.writeFileSync(file,JSON.stringify(saved));
 const old=GitCloud.prototype.connect;t.after(()=>{GitCloud.prototype.connect=old;});GitCloud.prototype.connect=async()=>{throw Error('Git ls-remote failed: Permission denied (publickey).');};
 const settings=new GitSettings(store.root,store,{running:false},()=>{});
 await assert.rejects(settings.verify({url:'git@github.com:owner/new.git'}),/SSH authentication failed/);assert.deepEqual(JSON.parse(fs.readFileSync(file)),saved);assert.equal(settings.job,null);
 assert.match(connectionError(Error('Host key verification failed')),/host verification/);assert.match(connectionError(Error('Repository not found')),/account access/);
});

test('HTTP bulk recovery restores and deletes the selected copies',async t=>{
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-trash-http-')),app=createApp({root:path.join(root,'app'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const entries=['One','Two','Delete'].map(name=>{const b=app.store.branch(null,name,'codex',codexSample(root,[[name,'Done']]));return stageTrash(app.store,[b.id],[b.id]);});
 const call=async body=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/trash/recovery',{method:'POST',headers:{'Content-Type':'application/json','X-Grove-Token':app.token},body:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;};
 const restored=await call({action:'restore',ids:entries.slice(0,2).map(e=>e.id)});assert.equal(restored.restored.length,2);assert.equal(restored.failed.length,0);
 const removed=await call({action:'delete',ids:[entries[2].id]});assert.equal(removed.deleted,1);assert.equal(app.store.syncCollections().items.length,2);
});

test('a damaged old recovery file is replaced by a verified new snapshot before native removal',async t=>{
 const {store,native,b,instance}=setup(t);const old=stageTrash(store,[b.id],[b.id]);fs.writeFileSync(path.join(store.root,'trash',old.id+'.json.gz'),'broken');
 const result=await moveNativeToRecovery(store,native,[instance.id],options);assert.deepEqual(result.blocked,[]);assert.notEqual(result.recoveryIds[0],old.id);
 const restored=restoreTrash(store,result.recoveryIds[0]);assert.match(store.raw(store.get('branch',restored.branchIds[0]).head),/Original/);
});

test('asynchronous recovery staging is never visible or eligible for cloud upload',async t=>{
 const {store,native,b,instance}=setup(t);stageTrash(store,[b.id],[b.id]);fs.appendFileSync(instance.file,codexTurn('New recovery content','Done').map(r=>JSON.stringify(r)+'\n').join(''));
 let checked=false;
 const result=await moveNativeToRecovery(store,native,[instance.id],{...options,onProgress:async p=>{if(p.phase==='Copying recovery records'){checked=true;const helpers=store.all('branch').filter(b=>b.excluded==='recovery-staging').map(b=>b.id);assert.ok(helpers.length);assert.ok(store.exportGraph().branches.every(b=>!helpers.includes(b.id)));}}});
 assert.equal(checked,true);assert.deepEqual(result.blocked,[]);const restored=restoreTrash(store,result.recoveryIds[0]);assert.ok(store.syncCollections().items.some(i=>i.sessionIds.includes(restored.branchIds[0])));
});
test('restoring a recovery copy creates a visible project session and never a client archive',t=>{
 const {store,native,b,instance}=setup(t);native.setActive(b.id,null,false);native.apply([b.id]);
 store.put('branch',{...store.get('branch',b.id),excluded:'recovery-staging',background:'agent-owned'});
 const entry=stageTrash(store,[b.id],[b.id],{transient:true}),restored=restoreTrash(store,entry.id),id=restored.branchIds[0];
 assert.ok(store.listing('projects').items.some(i=>i.sessionIds.includes(id)));assert.equal(store.instances().filter(i=>i.branchId===id).length,0);
 assert.ok(!nativeTrashCandidates(store).some(i=>i.clientArchived&&i.branchId===b.id));assert.ok(!store.listing('archived').items.some(i=>i.sessionIds.includes(id)));
});
test('client archive changes follow an adopted identity without confusing Grove deactivation with archive',t=>{
 const {store,native,b,instance}=setup(t);store.local('instances',store.instances().map(i=>({...i,adopted:true,nativeArchived:false})));
 const archived=path.join(native.roots.codex,'archived_sessions',path.basename(instance.file));fs.mkdirSync(path.dirname(archived),{recursive:true});fs.renameSync(instance.file,archived);native.refreshLocal();
 assert.equal(store.get('branch',b.id).archived,true);assert.ok(nativeTrashCandidates(store).some(i=>i.branchId===b.id&&i.clientArchived));
 fs.renameSync(archived,instance.file);native.refreshLocal();assert.equal(store.get('branch',b.id).archived,false);assert.ok(store.listing('projects').items.some(i=>i.sessionIds.includes(b.id)));
 native.setActive(b.id,null,false);native.apply([b.id]);native.refreshLocal();assert.ok(!nativeTrashCandidates(store).some(i=>i.branchId===b.id&&i.clientArchived));
});

test('client archive recovery keeps its shared parent, sibling and named layout',async t=>{
 const {root,store,native,b,instance}=setup(t);
 const child=store.fork(b.id,{name:'Sibling',end:store.detail(b.id).checkpoints[0].end});
 const g=store.treeGraph(b.id);store.organize(b.id,{version:g.version,pathId:b.id,action:'combine',name:'Shared label',chatIds:g.paths.find(p=>p.branchId===b.id).messages.map(m=>m.id)});
 const before=native.history(instance.file,b.agent);store.edit(b.id,{archived:true});
 const result=await moveNativeToRecovery(store,native,[instance.id],options);assert.deepEqual(result.blocked,[]);
 const restored=restoreTrash(store,result.recoveryIds[0]);
 const item=store.listing('projects').items.find(i=>i.sessionIds.includes(child.id));
 assert.ok(item.sessionIds.includes(restored.branchIds[0]),'restored parent stays with its kept sibling');
 const tree=store.treeGraph(item.id);assert.equal(tree.paths.length,2);assert.ok(tree.nodes.some(n=>n.name==='Shared label'&&n.branchIds.length===2));
 assert.equal(store.raw(store.get('branch',restored.branchIds[0]).head),before);
});
test('separately discarded siblings restore into one tree in either order',t=>{
 const {store,b}=setup(t);const end=store.detail(b.id).checkpoints[0].end;
 const children=['A','B'].map(name=>store.fork(b.id,{name,end}));
 const entries=children.map(c=>stageTrash(store,[c.id]));cleanupLocal(store);
 const restored=entries.reverse().map(e=>restoreTrash(store,e.id).branchIds[0]);
 assert.ok(store.listing('projects').items.some(i=>[b.id,...restored].every(id=>i.sessionIds.includes(id))));
});
test('restoring an entire deleted tree retains every path and stable chat identity',t=>{
 const {store,b}=setup(t);const c=store.fork(b.id,{name:'Child',end:store.detail(b.id).checkpoints[0].end});
 const before=store.treeGraph(b.id),entry=stageTrash(store,[b.id,c.id],[b.id]);cleanupLocal(store);
 const restored=restoreTrash(store,entry.id),tree=store.treeGraph(restored.branchIds[0]);
 assert.equal(tree.paths.length,2);assert.equal(new Set(tree.paths.map(p=>p.nodeIds[0])).size,1);
 assert.deepEqual(tree.paths.map(p=>p.messages.map(m=>m.id)),before.paths.map(p=>p.messages.map(m=>m.id)));
});

test('parent and child restored from separate entries reunite in either order after all paths were trashed',t=>{
 for(const reverse of [false,true]){
  const {store,b}=setup(t);const child=store.fork(b.id,{name:'Nested',end:store.detail(b.id).checkpoints[0].end});
  const entries=[stageTrash(store,[child.id]),stageTrash(store,[b.id])];cleanupLocal(store);
  if(reverse)entries.reverse();const restored=entries.map(e=>restoreTrash(store,e.id).branchIds[0]);
  assert.ok(store.listing('projects').items.some(i=>restored.every(id=>i.sessionIds.includes(id))));
  const g=store.treeGraph(restored[0]);assert.equal(g.paths.length,2);assert.equal(new Set(g.paths.map(p=>p.nodeIds[0])).size,1);
 }
});
test('restoring a child follows its surviving family into the current project',t=>{
 const {store,b}=setup(t);const child=store.fork(b.id,{name:'Child',end:store.detail(b.id).checkpoints[0].end}),entry=stageTrash(store,[child.id]);cleanupLocal(store);
 const destination=store.project('Moved while child was discarded');store.moveItems({itemIds:[b.id],projectId:destination.id});
 const restored=restoreTrash(store,entry.id);assert.equal(store.get('branch',restored.branchIds[0]).projectId,destination.id);assert.deepEqual(restored.projectIds,[destination.id]);
});
test('restoring into a surviving family reopens its archived project without activating siblings',t=>{
 const {store,b}=setup(t),project=store.project('Destination');store.moveItems({itemIds:[b.id],projectId:project.id});
 const child=store.fork(b.id,{name:'Child',end:store.detail(b.id).checkpoints[0].end}),entry=stageTrash(store,[child.id]);cleanupLocal(store);store.put('project',{...project,archived:true});
 const restored=restoreTrash(store,entry.id);assert.ok(store.listing('projects').items.some(i=>i.sessionIds.includes(restored.branchIds[0])));assert.equal(store.get('project',project.id).archived,false);assert.ok(!store.instances().some(i=>i.branchId===restored.branchIds[0]));
});
