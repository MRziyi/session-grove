import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connect } from '../src/codex-rpc.js';
import { archiveNative, codexBinary } from '../src/native-archive.js';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { codexSample } from '../src/demo.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-archive-check-')),home=path.join(root,'codex');fs.mkdirSync(home);
const executable=process.argv[2]||codexBinary(),store=new Store(path.join(root,'library')),native=new Native(store,{roots:{codex:home,claude:path.join(root,'claude')},guard:()=>{}});let client;
try{
client=connect(executable,home);await client.init();await client.request('thread/list',{limit:1});await client.close();client=null;
const b=store.branch(null,'Archive test','codex',codexSample(root,[['Keep this exact context','Ready']]));native.setActive(b.id,root,true);native.apply([b.id]);const instance=store.instances()[0],original=fs.readFileSync(instance.file);
await archiveNative(store,native,[b.id],{executable});assert.equal(store.get('branch',b.id).archived,true);assert.equal(store.instances()[0].applied,false);assert.deepEqual(fs.readFileSync(store.instances()[0].file),original);
client=connect(executable,home);await client.init();const list=await client.request('thread/list',{archived:true,limit:100});assert.ok(list.data.some(t=>t.id===instance.nativeId));const active=await client.request('thread/list',{archived:false,limit:100});assert.ok(!active.data.some(t=>t.id===instance.nativeId));
console.log('Native archive passed: official Codex archive, identical bytes, correct native list visibility, no model requests.');
}finally{await client?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
