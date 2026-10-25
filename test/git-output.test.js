import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {GitRemote} from '../src/git-remote.js';import {GitCloud} from '../src/git-cloud.js';import {hash} from '../src/util.js';

test('offline baseline lookup reads graphs above the generic Git limit without corrupting Unicode',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-large-baseline-')),remote=new GitRemote(root,'git@example.invalid:fixture.git');
 try{
  await remote.init();
  const id='large-tree',graph={schema:3,projects:[],branches:[{id}],revisions:[],note:'中文😀'.repeat(30000)+'x'.repeat(33*1024*1024)};
  const raw=JSON.stringify(graph),ack=hash(raw),folder=path.join(root,'trees',hash(id));fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'graph.json'),raw);
  await remote.run(['add','.']);await remote.run(['commit','-m','Synthetic large baseline']);
  const head=(await remote.run(['rev-parse','HEAD'])).stdout,blob=(await remote.run(['rev-parse','HEAD:trees/'+hash(id)+'/graph.json'])).stdout;
  await assert.rejects(remote.run(['cat-file','blob',blob]),error=>error.code==='GIT_OUTPUT_LIMIT');
  let saved;
  const cloud=Object.assign(Object.create(GitCloud.prototype),{store:{local:()=>null},connection:{remote},readConfig:()=>({url:remote.url}),cache:()=>({ack:{[id]:ack},gitHead:head}),read:()=>null,connect:async()=>{throw Error('Offline lookup must not initialize Git');},rememberBaseline:(_id,value)=>{saved=value;}});
  const run=remote.run.bind(remote);remote.run=(args,options)=>{assert.ok(!['fetch','push','ls-remote'].includes(args[0]));return run(args,options);};
  const restored=await cloud.undoBaseline(id);assert.equal(hash(JSON.stringify(restored)),ack);assert.equal(restored.note,graph.note);assert.equal(saved,restored);
 }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
