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
