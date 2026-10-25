import {listenForTests} from '../scripts/test-server.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.js';
import {codexSample} from '../src/demo.js';

test('smart organization waits for sync and discards work already completed by incoming metadata',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-smart-sync-'));
 fs.writeFileSync(path.join(root,'intelligence.json'),JSON.stringify({apiKey:'synthetic-only',classify:true,nameNodes:false}));
 const app=createApp({root,roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});let calls=0;
 app.intelligence.request=async()=>{calls++;throw Error('Must not rename completed incoming metadata');};
 await listenForTests(app.server);
 try{
  const barrier=Promise.withResolvers(),busy=app.autoSync.exclusive(()=>barrier.promise);await new Promise(r=>setImmediate(r));
  const b=app.store.branch(null,'Native title','codex',codexSample(root,[['Request','Reply']]));
  app.intelligence.observe();await app.intelligence.run();assert.equal(calls,0);assert.ok(app.intelligence.data.jobs.length);
  app.store.put('branch',{...b,sessionName:'Complete remote title',sessionNameOrigin:'automatic',sessionAutomaticName:{name:'Complete remote title',at:'2025-01-01'}});
  barrier.resolve();await busy;await app.intelligence.run();await app.intelligence.pending;
  assert.equal(calls,0);assert.equal(app.store.get('branch',b.id).sessionName,'Complete remote title');
 }finally{await new Promise(resolve=>app.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});

test('Git-only startup ignores old credentials and retired endpoints cannot reactivate a provider',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-git-only-'));
    const names=['webdav.json','sync-key.txt','sync-settings-pending.json','trash-cleanup.json'];
    for(const name of names)fs.writeFileSync(path.join(root,name),'untouched synthetic legacy data');
    const app=createApp({root,roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
    try{
        await listenForTests(app.server);
        const base='http://127.0.0.1:'+app.server.address().port;
        const headers={'X-Grove-Token':app.token};
        const response=await fetch(base+'/api/settings',{headers});assert.equal(response.status,200);
        const settings=await response.json();assert.equal(settings.provider,'git');assert.equal(settings.verified,false);
        for(const route of ['/api/webdav','/api/settings/recover','/api/cloud/check','/api/synchronize/plan','/api/synchronize/start']){
            const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Grove-Token':app.token},body:'{}'});
            assert.equal(response.status,404,route);await response.body.cancel();
        }
        assert.equal((await fetch(base+'/api/webdav',{headers})).status,404);
        for(const name of names)assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'untouched synthetic legacy data');
    }finally{await new Promise(resolve=>app.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
