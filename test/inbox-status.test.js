import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {once}from'node:events';
import{createApp}from'../src/server.js';import{Store}from'../src/store.js';import{Native}from'../src/native.js';import{codexSample,codexTurn,claudeSample}from'../src/demo.js';import{INBOX_ID}from'../src/inbox.js';
test('light status has real deadlines, no library payload, and honors disabled local updates',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-status-')),app=createApp({root,roots:{codex:path.join(root,'native/codex'),claude:path.join(root,'native/claude')},guard:()=>{}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.close();await once(app.server,'close');fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,boot=await(await fetch(base+'/api/bootstrap')).json(),headers={'x-grove-token':boot.token,'content-type':'application/json'};
 const get=async route=>(await fetch(base+route,{headers})).json();const status=await get('/api/status');assert.ok(status.update.nextRunAt>Date.now());assert.ok(status.update.nextRunAt-Date.now()<=60000);assert.equal(status.branches,undefined);assert.equal(status.items,undefined);assert.ok(Buffer.byteLength(JSON.stringify(status))<1800);assert.ok(boot.projects.some(p=>p.id===INBOX_ID));
 await fetch(base+'/api/settings/timers',{method:'POST',headers,body:JSON.stringify({localUpdateEnabled:false})});assert.equal((await get('/api/status')).update.nextRunAt,null);
});
test('tool and device provenance follow actual content, not rename, organization or activation',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-origin-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});store.device={id:'studio',name:'Studio',model:'Mac Studio',platform:'darwin',kind:'desktop'};
 const b=store.branch(null,'Daily','codex',codexSample(root,[['First','Reply']]));const native=new Native(store,{roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
 assert.equal(store.collections().items[0].origin.model,'Mac Studio');store.edit(b.id,{name:'Renamed'});assert.equal(store.collections().items[0].origin.id,'studio');
 store.device={id:'air',name:'Air',model:'MacBook Air',platform:'darwin',kind:'laptop'};store.invalidate();native.setActive(b.id,root,true);native.apply();assert.equal(store.collections().items[0].origin.id,'studio');
 const current=store.get('branch',b.id);store.ingest(b.id,store.raw(current.head)+codexTurn('New work','Done').map(v=>JSON.stringify(v)+'\n').join(''),current.head,{operation:'capture'});
 assert.equal(store.collections().items[0].origin.id,'air');assert.equal(store.collections().items[0].origin.model,'MacBook Air');assert.deepEqual(store.collections().items[0].agents,['codex']);assert.ok(store.treeGraph(b.id).nodes.every(n=>n.agents.includes('codex')));
 const fork=store.fork(b.id,{name:'Fork',end:store.detail(b.id).checkpoints.at(-1).end});assert.equal(store.collections().items.find(i=>i.sessionIds.includes(fork.id)).origin.id,'air');
});
test('no-op native apply does not demand that unrelated running clients close',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-noop-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});const native=new Native(store,{roots:{codex:path.join(root,'c'),claude:path.join(root,'a')},guard:()=>{throw new Error('unrelated client');}});assert.deepEqual(native.apply(),{applied:0});
});

test('list snapshots reuse scalar summaries after full parse caches are evicted',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-summary-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 store.branch(null,'Daily','codex',codexSample(root,[['Question','Answer']]));store.snapshot();store.parseCache.clear();store.parseBytes=0;store.invalidate();
 const parse=store.parsed;store.parsed=()=>{throw new Error('List should not parse history again');};assert.equal(store.snapshot().items.length,1);store.parsed=parse;
});

test('complete JSON from an ongoing turn updates Pending without permitting unsafe materialization',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-live-pending-')),store=new Store(path.join(root,'library')),home=path.join(root,'codex');fs.mkdirSync(path.join(home,'sessions'),{recursive:true});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const file=path.join(home,'sessions','sample.jsonl');fs.writeFileSync(file,codexSample(root,[['Initial','Ready']]));const native=new Native(store,{roots:{codex:home,claude:path.join(root,'claude')},guard:()=>{}});native.refreshLocal();const b=store.all('branch')[0],turn=codexTurn('More work','Still thinking');
 fs.appendFileSync(file,turn.slice(0,-1).map(v=>JSON.stringify(v)+'\n').join(''));native.refreshLocal();assert.equal(store.detail(b.id).messages.length,4);assert.ok(store.instances()[0].pending);
 fs.appendFileSync(file,JSON.stringify(turn.at(-1))+'\n');native.refreshLocal();assert.equal(store.instances()[0].pending,null);
});

test('a remote archive does not silently hide an actually active native copy',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-archive-local-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});const b=store.branch(null,'Everyday','codex',codexSample(root,[['Daily','Ready']]));const native=new Native(store,{roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});native.setActive(b.id,root,true);native.apply();store.edit(b.id,{archived:true});
 const list=store.listing('active:codex');assert.equal(list.items.length,0);assert.equal(list.sessionCount,1);assert.deepEqual(list.pendingDeactivation.map(s=>s.id),[b.id]);
 native.setActive(b.id,null,false);native.apply();assert.equal(store.listing('active:codex').pendingDeactivation.length,0);assert.equal(store.listing('archived').items.length,1);
});

test('tool badges describe actual mixed ancestry while retaining prefix provenance',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-tools-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});const parent=store.branch(null,'First','codex',codexSample(root,[['Context','Ready']])),child=store.branch(null,'Continuation','claude',claudeSample(root,[['Context','Ready'],['More','Claude reply']]));
 store.put('branch',{...child,parentId:parent.id,forkRevision:parent.head,forkEnd:2,forkParentEnd:store.detail(parent.id).checkpoints[0].end});
 assert.deepEqual(new Set(store.collections().items[0].agents),new Set(['codex','claude']));const graph=store.treeGraph(parent.id);assert.deepEqual(graph.nodes[0].agents,['codex']);assert.deepEqual(graph.nodes.at(-1).agents,['claude']);
});

test('native resume/settings events preserve the previous conversation device',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-resume-origin-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});store.device={id:'studio',name:'Studio',model:'Mac Studio',platform:'darwin',kind:'desktop'};
 const b=store.branch(null,'Original','codex',codexSample(root,[['Context','Ready']])),date=b.contentUpdatedAt;store.device={id:'air',name:'Air',model:'MacBook Air',platform:'darwin',kind:'laptop'};store.invalidate();const native=new Native(store,{roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});native.setActive(b.id,root,true);native.apply();const file=store.instances().find(i=>i.applied).file;
 fs.appendFileSync(file,JSON.stringify({type:'event_msg',payload:{type:'thread_settings_applied'}})+'\n');native.collect();assert.equal(store.collections().items[0].origin.id,'studio');assert.equal(store.get('branch',b.id).contentUpdatedAt,date);
});
