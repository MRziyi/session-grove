import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {once} from 'node:events';
import {createApp} from '../src/server.js';import {codexSample} from '../src/demo.js';
test('whole-tree Trash requires every active path to stop and streams real backup stages',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-trash-progress-')),app=createApp({root:path.join(root,'library'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const store=app.store,parent=store.branch(null,'Parent','codex',codexSample(root,[['Question','Answer'],['Later','Done']])),child=store.fork(parent.id,{name:'Child',end:store.detail(parent.id).checkpoints[0].end});
 for(const b of [parent,child])app.native.setActive(b.id,root,true);app.native.apply();
 const base='http://127.0.0.1:'+app.server.address().port,headers={'Content-Type':'application/json','X-Grove-Token':app.token};
 const post=(route,body)=>fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await post('trash',{itemIds:[parent.id]})).status,409);assert.equal(store.local('trashEntries'),null);
 assert.equal((await post('manage',{action:'deactivate',branchIds:[parent.id]})).status,200);
 assert.equal((await post('trash',{itemIds:[parent.id]})).status,409,'an active descendant still blocks the entire tree');
 assert.equal((await post('manage',{action:'deactivate',branchIds:[child.id]})).status,200);
 const stop=new AbortController(),response=await fetch(base+'/api/events',{headers,signal:stop.signal}),reader=response.body.getReader();
 let received='',finished=false,sawDuringWork=false;
 const stream=(async()=>{try{for(;;){const {value,done}=await reader.read();if(done)break;received+=new TextDecoder().decode(value);if(!finished&&received.includes('Preparing recovery paths'))sawDuringWork=true;}}catch{}})();
 const moved=await post('trash',{itemIds:[parent.id]});assert.equal(moved.status,202);finished=true;await new Promise(r=>setTimeout(r,20));stop.abort();await stream;
 assert.ok(sawDuringWork,'progress is delivered before the request completes');
 for(const phase of ['Preparing recovery paths','Copying recovery records','Saving recovery backup','Updating Trash','Removing unused local records'])assert.ok(received.includes(phase),phase);
 const status=await(await fetch(base+'/api/status',{headers})).json();assert.equal(status.trashOperation.state,'success');assert.equal(store.local('trashEntries').length,1);
});

test('Trash carries its own snapshot version when a newer status response follows it',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-trash-version-')),app=createApp({root:path.join(root,'library'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,headers={'X-Grove-Token':app.token},before=await(await fetch(base+'/api/trash',{headers})).json();assert.equal(typeof before.stateVersion,'string');
 const {stageTrash}=await import('../src/trash.js'),b=app.store.branch(null,'Concurrent recovery','codex',codexSample(root,[['Keep','Reply']])),entry=stageTrash(app.store,[b.id],[b.id]);
 const status=await(await fetch(base+'/api/status',{headers})).json(),after=await(await fetch(base+'/api/trash',{headers})).json();assert.notEqual(before.stateVersion,status.stateVersion);assert.equal(after.stateVersion,status.stateVersion);assert.ok(after.trashEntries.some(e=>e.id===entry.id));assert.ok(!before.trashEntries.some(e=>e.id===entry.id));
});
