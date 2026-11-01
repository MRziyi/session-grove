import {listenForTests} from '../scripts/test-server.js';
import {request} from 'node:http';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createApp} from '../src/server.js';
test('localhost and forwarded domains/ports serve the app and API without address restrictions or redirects',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-address-')),app=createApp({root:path.join(root,'library'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
 await listenForTests(app.server);t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const port=app.server.address().port;
 const call=(route,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:route,method,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);});
 for(const host of ['localhost:'+port,'localhost:8742','grove.example:8443','tunnel.example']){
  const headers={Host:host,Origin:'https://'+host,'Sec-Fetch-Site':'cross-site'};
  for(const method of ['GET','HEAD']){const r=await call('/?from=forward',{method,headers});assert.equal(r.status,200);assert.equal(r.headers.location,undefined);}
  assert.equal((await call('/app.js',{headers})).status,200);
  const boot=await call('/api/bootstrap',{headers});assert.equal(boot.status,200);
  const token=JSON.parse(boot.body).token;assert.ok(token);
  assert.equal((await call('/api/status',{headers:{...headers,'X-Grove-Token':token}})).status,200);
  assert.equal((await call('/api/status',{headers})).status,403);
  assert.equal((await call('/api/settings/timers',{method:'POST',headers:{...headers,'X-Grove-Token':token,'Content-Type':'application/json'},body:JSON.stringify({localUpdateEnabled:false})})).status,200);
 }
});
