import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {once} from 'node:events';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {createApp} from '../src/server.js';import {codexSample,codexTurn} from '../src/demo.js';import {savePreferences} from '../src/preferences.js';import {parse,renderNative} from '../src/transcript.js';import {recordPreview} from '../src/record-preview.js';
const lines=rows=>rows.map(r=>JSON.stringify(r)+'\n').join('');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-quick-')),store=new Store(path.join(root,'library')),roots={codex:path.join(root,'codex'),claude:path.join(root,'claude')},apps=[];fs.mkdirSync(path.join(roots.codex,'sessions'),{recursive:true});t.after(async()=>{for(const app of apps)if(app.server.listening)await new Promise(resolve=>app.close(resolve));store.close();fs.rmSync(root,{recursive:true,force:true});});return{root,store,roots,apps};}
test('local renames work during sync and Trash rejects active paths', async t => {
 const f=fixture(t),app=createApp({root:path.join(f.root,'app'),roots:f.roots,guard:()=>{}});
 f.apps.push(app);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const base='http://127.0.0.1:'+app.server.address().port,headers={'X-Grove-Token':app.token,'Content-Type':'application/json'};
 const request=(route,method,body)=>fetch(base+'/api/'+route,{method,headers,body:JSON.stringify(body)});
 const parent=app.store.branch(null,'Parent','codex',codexSample(f.root,[['Setup','Ready'],['More','Done']]));
 const child=app.store.fork(parent.id,{name:'Inactive child',end:app.store.detail(parent.id).checkpoints[0].end});
 app.native.setActive(parent.id,f.root,true);app.native.apply([parent.id]);
 let release;const pending=app.autoSync.exclusive(()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
 try {
  assert.equal((await request('branches/'+parent.id,'PATCH',{name:'Renamed during sync'})).status,200);
  const graph=app.store.treeGraph(parent.id);
  assert.equal((await request('trees/'+parent.id,'POST',{version:graph.version,pathId:parent.id,nodeId:graph.nodes[0].id,action:'rename',name:'Renamed node'})).status,200);
  const current=app.store.treeGraph(parent.id),target={branchId:child.id,nodeId:'empty-'+child.id,version:current.version,cwd:f.root};
  const preview=await(await request('node-activation/check','POST',target)).json();
  const activated=await request('node-activation/activate','POST',{...target,contextAcknowledgement:preview.fingerprint});assert.equal(activated.status,201);const continuation=(await activated.json()).branch;
  assert.notEqual(continuation.id,child.id);assert.ok(app.store.instances().some(i=>i.branchId===continuation.id&&i.applied));
  assert.equal((await request('manage','POST',{action:'deactivate',branchIds:[continuation.id]})).status,200);
  assert.equal((await request('trash','POST',{itemIds:[parent.id],view:'active:codex'})).status,409);
  assert.equal((await request('manage','POST',{action:'deactivate',branchIds:[parent.id]})).status,200);
  const ready=app.store.treeGraph(parent.id);
  assert.equal((await request('trash','POST',{branchIds:[parent.id],nodeId:ready.nodes.find(n=>n.endBranchIds.includes(parent.id)).id,version:ready.version})).status,202);
  assert.equal(app.store.cleanupDeferred,true);
 } finally {release();await pending;}
 assert.equal(app.store.listing('active:codex').items.length,0);
 assert.ok(app.store.collections().items.some(i=>i.sessions.some(s=>s.id===child.id)));
});
test('fresh startup stays empty until Update, streams actual completion, and enables the local timer afterward',async t=>{
 const f=fixture(t),file=path.join(f.roots.codex,'sessions','sample.jsonl');fs.writeFileSync(file,codexSample(f.root,[['Question','Answer']]));
 const app=createApp({root:path.join(f.root,'app'),roots:f.roots,guard:()=>{}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{if(app.server.listening)await new Promise(resolve=>app.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,boot=await(await fetch(base+'/api/bootstrap')).json();assert.equal(boot.items.length,0);assert.equal(boot.update.nextRunAt,null);assert.equal(boot.cloud.started,false);
 const headers={'X-Grove-Token':boot.token,'Content-Type':'application/json'},controller=new AbortController();const stream=await fetch(base+'/api/events',{headers,signal:controller.signal});const reader=stream.body.getReader();let events='';const consume=(async()=>{try{for(;;){const r=await reader.read();if(r.done)break;events+=Buffer.from(r.value).toString();}}catch{}})();
 const r=await(await fetch(base+'/api/collect',{method:'POST',headers,body:'{}'})).json();assert.equal(r.discovered,1);await new Promise(r=>setTimeout(r,10));controller.abort();await consume;assert.match(events,/"state":"running"/);assert.match(events,/"state":"success"/);
 const status=await(await fetch(base+'/api/status',{headers})).json();assert.equal(status.update.started,true);assert.ok(status.update.nextRunAt>Date.now());
 const closing=await fetch(base+'/api/events',{headers}),ended=closing.text();await new Promise(resolve=>app.close(resolve));await ended;
});
test('native automation provenance is excluded by default and can be explicitly displayed without losing history',t=>{
 const f=fixture(t),rows=codexSample(f.root,[['Do the scheduled work','Done']]).trim().split('\n').map(JSON.parse),file=path.join(f.roots.codex,'sessions','scheduled.jsonl');rows[0].payload.thread_source='automation';fs.writeFileSync(file,lines(rows));
 const db=new DatabaseSync(path.join(f.roots.codex,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,title TEXT,archived INTEGER,source TEXT,thread_source TEXT,rollout_path TEXT)');db.prepare('INSERT INTO threads VALUES(?,?,0,?,?,?)').run(rows[0].payload.id,'Scheduled task','vscode','automation',file);db.close();
 const native=new Native(f.store,{roots:f.roots,guard:()=>{}});assert.equal(native.refreshLocal().discovered,0);savePreferences(f.store,{showScheduledSessions:true});assert.equal(native.refreshLocal().discovered,1);assert.equal(f.store.collections().items.length,1);
 const original=fs.readFileSync(file,'utf8');savePreferences(f.store,{showScheduledSessions:false});assert.equal(f.store.collections().items.length,0);native.refreshLocal();assert.equal(f.store.all('branch').length,1);assert.equal(fs.readFileSync(file,'utf8'),original);savePreferences(f.store,{showScheduledSessions:true});native.refreshLocal();assert.equal(f.store.collections().items.length,1);
});
test('forks have a selectable empty endpoint, inherit compaction policy, and preserve opaque reasoning exactly on activation',t=>{
 const f=fixture(t),first=codexSample(f.root,[['Before compact','Reply']]).trim().split('\n').map(JSON.parse),opaque={type:'response_item',payload:{type:'reasoning',summary:[],encrypted_content:'preserved-secret-opaque-bytes'}};
 const raw=lines([...first,{type:'compacted',payload:{message:'Summary',replacement_history:[{type:'message',role:'user',content:[{type:'input_text',text:'Summary'}]}]}},...codexTurn('After compact','Ready'),opaque]);const branch=f.store.branch(null,'Main','codex',raw),event=f.store.treeGraph(branch.id).paths[0].context.compactions[0];
 // Include opaque records inside the completed checkpoint rather than beyond it.
 const rows=parse(raw,'codex').records.map(r=>r.value);const reasoning=rows.pop();rows.splice(rows.length-1,0,reasoning);f.store.ingest(branch.id,lines(rows),branch.head,{});const head=f.store.get('branch',branch.id).head;
 for(const enabled of [true,false]){f.store.setCompaction(branch.id,{eventId:event.id,enabled,head});const child=f.store.fork(branch.id,{name:'Fork',end:f.store.detail(branch.id).checkpoints.at(-1).end});const graph=f.store.treeGraph(branch.id),p=graph.paths.find(p=>p.branchId===child.id),empty=graph.nodes.find(n=>n.id===p.nodeIds.at(-1));assert.equal(empty.empty,true);assert.equal(empty.count,0);assert.ok(empty.endBranchIds.includes(child.id));assert.equal(p.context.compactions[0].enabled,enabled);
 const native=new Native(f.store,{roots:f.roots,guard:()=>{}});native.setActive(child.id,f.root,true);native.apply([child.id]);const instance=f.store.instances().find(i=>i.branchId===child.id&&i.applied),built=parse(fs.readFileSync(instance.file,'utf8'),'codex');assert.equal(built.context.compactions.length,enabled?1:0);assert.ok(built.messages.some(m=>m.text==='Before compact'));assert.deepEqual(built.records.find(r=>r.value?.payload?.type==='reasoning').value,opaque);
 }
});
test('record preview bounds rendering and distinguishes unreadable reasoning without modifying the source',()=>{
 const record={type:'response_item',payload:{type:'reasoning',summary:[],encrypted_content:'x'.repeat(2000000)}};const preview=recordPreview(record);assert.equal(preview.opaque,true);assert.ok(preview.text.length<500);assert.equal(record.payload.encrypted_content.length,2000000);
 const large={payload:{output:'y'.repeat(30000)}};const a=recordPreview(large),b=recordPreview(large,a.next);assert.equal(a.text.length,12000);assert.equal(b.next,24000);
});
