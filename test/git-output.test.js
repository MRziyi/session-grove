import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {GitRemote} from '../src/git-remote.js';import {GitCloud} from '../src/git-cloud.js';import {hash} from '../src/util.js';

test('Git cache preserves hashed graph parts in long library paths without global configuration',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-long-cache-'));
 const directory=path.join(root,'Library with spaces '.repeat(3).trim(),'git-cache',hash('synthetic remote'));
 const remote=new GitRemote(directory,'git@example.invalid:fixture.git');
 try{
  await remote.init();await remote.run(['config','core.longpaths','false']);
  const name='trees/'+hash('tree')+'/graph/'+hash('part')+'.jsonl',file=path.join(directory,name),raw='{"name":"Unicode \u4e2d\u6587","records":[]}\n';
  assert.ok(file.length>260);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw);
  await remote.run(['add','--all']);await remote.run(['commit','-m','Synthetic long-path graph part']);
  fs.unlinkSync(file);
  // A fresh offline reader must work without init or rewriting checkout config.
  const offline=new GitRemote(directory,remote.url);await offline.run(['reset','--hard','HEAD']);
  assert.equal(fs.readFileSync(file,'utf8'),raw);
  const extra=path.join(path.dirname(file),hash('interrupted')+'.jsonl');fs.writeFileSync(extra,raw);
  await offline.run(['clean','-fd']);assert.equal(fs.existsSync(extra),false);
  assert.equal((await offline.run(['status','--porcelain'])).stdout,'');
  assert.equal((await offline.run(['config','--local','--get','core.longpaths'])).stdout,'false');
 }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

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
