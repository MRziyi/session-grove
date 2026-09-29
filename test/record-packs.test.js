import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadPacks } from '../src/record-packs.js';
import { hash } from '../src/util.js';
test('a slow first pack does not prevent free slots from sending later packs',async()=>{
 const rows=new Map(Array.from({length:1536},(_,i)=>{const body=JSON.stringify({i,text:'x'.repeat(128)})+'\n';return[hash(body),body];})),remote=new Map();
 let release,count=0,active=0,maxActive=0,fifthWhileFirstBlocked=false;const gate=new Promise(r=>release=r);
 const dav={put:async(key,body)=>{remote.set(key,body);count++;active++;maxActive=Math.max(maxActive,active);if(count===1)await gate;else if(count===5){fifthWhileFirstBlocked=true;release();}active--;return true;},get:async key=>remote.get(key)};
 const timeout=setTimeout(()=>release(),1000);
 const result=await uploadPacks({objectStatement:{get:h=>({body:rows.get(h)})}},dav,null,[...rows.keys()],{},()=>{},()=>{});clearTimeout(timeout);
 assert.equal(fifthWhileFirstBlocked,true);assert.ok(maxActive<=4);assert.equal(result.uploaded,rows.size);assert.equal(result.packs.length,6);
});
