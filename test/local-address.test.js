import {request} from 'node:http';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {once} from 'node:events';import {createApp} from '../src/server.js';
test('localhost navigation redirects to the canonical address without relaxing API or origin checks',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-address-')),app=createApp({root:path.join(root,'library'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const port=app.server.address().port,base='http://127.0.0.1:'+port,host='localhost:'+port;
 const call=(route,{method='GET',headers={}}={})=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:route,method,headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});req.on('error',reject);req.end();});
 for(const method of ['GET','HEAD']){const r=await call('/?from=bookmark',{method,headers:{Host:host},redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.location,base+'/?from=bookmark');}
 assert.equal((await call('/')).status,200);
 assert.equal((await call('/api/bootstrap',{headers:{Host:host}})).status,403);
 assert.equal((await call('/',{headers:{Host:'evil.example:'+port},redirect:'manual'})).status,403);
 assert.equal((await call('/api/bootstrap',{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await call('/',{method:'POST',headers:{Host:host}})).status,403);
});
