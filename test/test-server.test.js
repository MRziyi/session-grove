import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {randomInt} from 'node:crypto';
import {listenForTests} from '../scripts/test-server.js';
test('test servers avoid blocked ports and retry collisions without closing app resources',async()=>{
 const first=http.createServer((req,res)=>res.end('first')),second=http.createServer((req,res)=>res.end('second'));let closes=0;
 second.on('close',()=>closes++);
 try{
  await listenForTests(first);let attempts=0;
  const port=first.address().port;
  await listenForTests(second,{choosePort:()=>attempts++===0?port:randomInt(20000,65000)});
  assert.equal(closes,0);assert.equal(await(await fetch('http://127.0.0.1:'+second.address().port)).text(),'second');
  assert.ok(attempts>=2);
  await assert.rejects(listenForTests(http.createServer(),{choosePort:()=>6667}),/safe high range/);
 }finally{await Promise.all([first,second].map(server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})));}
});
