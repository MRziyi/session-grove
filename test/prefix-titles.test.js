import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {TranscriptionTitles} from '../src/transcription-titles.js';import {PrefixTitles,normalizedPrefix} from '../src/prefix-titles.js';import {codexSample,claudeSample} from '../src/demo.js';import {claudeTitle} from '../src/claude-title.js';
function fixture(t,{claude=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-prefix-')),store=new Store(root+'/library'),native=new Native(store,{roots:{codex:root+'/codex',claude:root+'/claude'},guard:()=>{}}),names=new Map(),calls=[];
 const b=store.branch(null,'Logical Session','codex',codexSample(root,[['Shared','Ready'],['Tail','Done']])),child=store.fork(b.id,{name:'Logical child',end:store.detail(b.id).checkpoints[0].end});
 native.setActive(b.id,root,true);native.setActive(child.id,root,true);native.apply();
 for(const i of store.instances())names.set(i.nativeId,i.title);
 const manager=new TranscriptionTitles(store,native,{support:()=>({supported:true}),binary:()=>'/fixture',refresh:async()=>({status:'sent'}),clientFactory:()=>({init:async()=>{calls.push('init');},close:async()=>{calls.push('close');},request:async(method,p)=>{calls.push(method);if(method==='thread/read')return {thread:{name:names.get(p.threadId)}};assert.equal(method,'thread/name/set');names.set(p.threadId,p.name);return {};}})});manager.ready=()=>true;
 const batch=new PrefixTitles(store,native,manager);
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return {root,store,native,b,child,manager,batch,names,calls};
}
test('prefix batch renames all active paths once, keeps logical labels and replaces its own prefix',async t=>{
 const f=fixture(t),heads=f.store.all('branch').map(b=>[b.id,b.head]),before=new Map(f.names),phases=[];
 await f.batch.apply(f.b.id,'[Work]',f.batch.plan(f.b.id).version,{onProgress:async p=>phases.push(p.phase)});
 assert.equal(f.calls.filter(c=>c==='init').length,1);assert.equal(f.calls.filter(c=>c==='close').length,1);
 for(const [id,name]of before)assert.equal(f.names.get(id),'[Work] '+name);
 assert.equal(f.store.get('branch',f.b.id).name,'Logical Session');assert.deepEqual(f.store.all('branch').map(b=>[b.id,b.head]),heads);assert.ok(phases.includes('Updating client titles'));
 await f.batch.apply(f.b.id,'Next',f.batch.plan(f.b.id).version);for(const [id,name]of before)assert.equal(f.names.get(id),'[Next] '+name);
 const result=await f.batch.apply(f.b.id,'Next',f.batch.plan(f.b.id).version);assert.equal(result.renamed,0);
});
test('a stale active-set preview and unavailable clients never issue rename writes',async t=>{
 const f=fixture(t),plan=f.batch.plan(f.b.id);f.native.setActive(f.child.id,null,false);f.native.apply([f.child.id]);
 await assert.rejects(f.batch.apply(f.b.id,'Work',plan.version),e=>e.status===409);assert.equal(f.calls.length,0);
 f.manager.ready=()=>false;const current=f.batch.plan(f.b.id);await assert.rejects(f.batch.apply(f.b.id,'Work',current.version),e=>e.status===409);assert.equal(f.calls.length,0);
 for(const invalid of ['', 'x'.repeat(41),'a\nb','a[b]'])assert.throws(()=>normalizedPrefix(invalid));
});
test('partial client writes, including a lost write response, restore previous names',async t=>{
 const f=fixture(t),before=new Map(f.names),factory=f.manager.clientFactory;let writes=0;
 f.manager.clientFactory=()=>{const client=factory(),request=client.request;client.request=async(method,p)=>{const result=await request(method,p);if(method==='thread/name/set'&&++writes===2)throw Error('Lost write response');return result;};return client;};
 await assert.rejects(f.batch.apply(f.b.id,'Work',f.batch.plan(f.b.id).version),/Lost write response/);assert.deepEqual(f.names,before);assert.ok(f.store.instances().every(i=>!i.prefixTitle));
});
test('refresh failures roll the whole batch back and manual client names are preserved',async t=>{
 const f=fixture(t),before=new Map(f.names);f.manager.refresh=async()=>({status:'unavailable'});
 await assert.rejects(f.batch.apply(f.b.id,'Work',f.batch.plan(f.b.id).version),/refresh is unavailable/);assert.deepEqual(f.names,before);
 const i=f.store.instances()[0];f.names.set(i.nativeId,'Manual client title');
 await assert.rejects(f.batch.apply(f.b.id,'Work',f.batch.plan(f.b.id).version),e=>e.code==='CLIENT_TITLE_CHANGED');assert.equal(f.names.get(i.nativeId),'Manual client title');assert.equal(f.store.instances().find(v=>v.id===i.id).observedTitle,'Manual client title');
});
test('official Claude rename appends title metadata and keeps all prior records intact',async t=>{
 const f=fixture(t),b=f.store.branch(null,'Claude logical label','claude',claudeSample(f.root,[['Question','Answer']]));f.native.setActive(b.id,f.root,true);f.native.apply([b.id]);
 const i=f.store.instances().find(i=>i.branchId===b.id),before=fs.readFileSync(i.file,'utf8');
 await f.batch.apply(b.id,'Work',f.batch.plan(b.id).version);const after=fs.readFileSync(i.file,'utf8');assert.ok(after.startsWith(before));assert.equal(claudeTitle(after.trim().split('\n').map(l=>JSON.parse(l))).title,'[Work] '+i.title);assert.equal(f.store.get('branch',b.id).name,'Claude logical label');assert.equal(f.store.parsed(f.store.get('branch',b.id).head,'claude').messages.length,2);
});

test('an active-set change during native writes rolls back the batch and preserves the new path',async t=>{
 const f=fixture(t),before=new Map(f.names),version=f.batch.plan(f.b.id).version;let added;
 await assert.rejects(f.batch.apply(f.b.id,'Work',version,{onProgress:async p=>{if(p.phase==='Updating client titles'&&!added)added=f.store.fork(f.b.id,{name:'New path',end:f.store.detail(f.b.id).checkpoints[0].end});}}),e=>e.status===409);
 assert.deepEqual(f.names,before);assert.ok(f.store.find('branch',added.id));assert.ok(f.store.instances().every(i=>!i.prefixTitle));
});

test('a completed batch stays committed when final feedback or client cleanup fails',async t=>{
 const f=fixture(t),factory=f.manager.clientFactory,before=new Map(f.names);
 f.manager.clientFactory=()=>({...factory(),close:async()=>{throw Error('Client already closed');}});
 const result=await f.batch.apply(f.b.id,'Work',f.batch.plan(f.b.id).version,{onProgress:async p=>{if(p.phase==='Client titles updated')throw Error('Feedback disconnected');}});
 assert.equal(result.renamed,2);for(const [id,name]of before)assert.equal(f.names.get(id),'[Work] '+name);
 assert.ok(f.store.instances().every(i=>i.prefixTitle.title===f.names.get(i.nativeId)));assert.equal(f.manager.renaming.size,0);
});
