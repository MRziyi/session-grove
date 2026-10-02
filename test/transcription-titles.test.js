import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {Intelligence} from '../src/intelligence.js';import {transcriptionPlan,TranscriptionTitles} from '../src/transcription-titles.js';import {codexSample,codexTurn} from '../src/demo.js';import {requestSpec} from '../src/intelligence-api.js';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-transcription-')),store=new Store(root),requests=[],renames=[],enabled=new Set();fs.writeFileSync(path.join(root,'intelligence.json'),JSON.stringify({apiKey:'fixture',classify:false,nameNodes:false,nameTranscripts:false}));const adapter={capabilities:()=>({supported:true,client:'Codex VS Code'}),instances:id=>enabled.has(id)?[{nativeId:id,title:'Client original'}]:[],ready:id=>enabled.has(id),rename:async(id,name,options)=>{assert.ok(options.validate());renames.push({id,name});return {nativeIds:[id],refresh:'sent'};}};const smart=new Intelligence(store,{transcriptions:adapter,request:async(_key,kind,e)=>{requests.push({kind,e});return {name:'Completed path'};}});const flush=async()=>{for(let n=0;n<100&&smart.data.jobs.some(j=>!j.waitingForClient)&&!smart.error;n++){clearTimeout(smart.timer);await smart.run();await smart.pending;}clearTimeout(smart.timer);};t.after(async()=>{smart.close();await smart.pending;store.close();fs.rmSync(root,{recursive:true,force:true});});return{root,store,smart,requests,renames,enabled,adapter,flush};}
const append=(store,b,question,reply)=>{const head=store.get('branch',b.id).head;store.ingest(b.id,store.raw(head)+codexTurn(question,reply).map(v=>JSON.stringify(v)+'\n').join(''),head,{});};
test('transcription naming is opt-in, new-node driven and excludes the changing tail',async t=>{
 const f=setup(t),b=f.store.branch(null,'Client original','codex',codexSample(f.root,[['Initial request','Completed result'],['Tail request','Tail result']]));f.enabled.add(b.id);f.smart.observe();await f.flush();assert.equal(f.requests.length,0);
 await f.smart.save({nameTranscripts:true});await f.flush();assert.equal(f.requests.length,0,'enabling does not bulk rename existing paths');
 append(f.store,b,'Tail keeps changing','Newest tail answer');f.smart.observe();await f.flush();assert.equal(f.requests.length,0);
 f.store.put('branch',{...f.store.get('branch',b.id),transcriptionNameOrigin:'manual'});const c=f.store.fork(b.id,{name:'Child',end:f.store.detail(b.id).checkpoints[0].end});assert.equal(f.store.get('branch',c.id).transcriptionNameOrigin,null);f.store.put('branch',{...f.store.get('branch',b.id),transcriptionNameOrigin:null});f.smart.observe();await f.flush();assert.equal(f.requests.length,1);assert.equal(f.requests[0].kind,'transcript');assert.deepEqual(f.requests[0].e.nodes,[{user_requests:['Initial request'],assistant_result:'Completed result'}]);assert.equal(f.store.get('branch',b.id).name,'Client original');
 for(let n=0;n<3;n++){append(f.store,b,'More '+n,'Unfinished-tail prose '+n);f.smart.observe();await f.flush();}assert.equal(f.requests.length,1);
 assert.ok(transcriptionPlan(f.store,c.id).completedNodes>=1);
});
test('failed client application retries its cached result without another model request',async t=>{
 const f=setup(t),b=f.store.branch(null,'Native','codex',codexSample(f.root,[['First','Done'],['Tail','Reply']]));f.enabled.add(b.id);await f.smart.save({nameTranscripts:true});let fail=true;f.adapter.rename=async()=>{if(fail)throw Error('Client unavailable');return {nativeIds:[b.id],refresh:'sent'};};f.store.fork(b.id,{name:'Fork',end:f.store.detail(b.id).checkpoints[0].end});f.smart.observe();await f.flush();assert.equal(f.requests.length,1);assert.ok(f.smart.error);fail=false;f.smart.retry();await f.flush();assert.equal(f.requests.length,1);assert.equal(f.smart.error,null);assert.ok(f.store.get('branch',b.id).transcriptionNaming);
});
test('completed evidence caps assistant prose and preserves the human requests',async t=>{
 const f=setup(t),user='Human instructions '.repeat(1000),b=f.store.branch(null,'Native','codex',codexSample(f.root,[[user,'Reply '.repeat(3000)],['Tail','Later']]));f.store.fork(b.id,{name:'Fork',end:f.store.detail(b.id).checkpoints[0].end});const plan=transcriptionPlan(f.store,b.id),input=JSON.parse(requestSpec('transcript',plan.evidence).input);assert.equal(input.completed_nodes[0].user_requests[0],user.trim());assert.ok(input.completed_nodes[0].assistant_result.length<300);assert.ok(!JSON.stringify(input).includes('Later'));
});
test('client rename uses official RPC and verifies persistence before updating Grove',async t=>{
 const f=setup(t),b=f.store.branch(null,'Grove alias','codex',codexSample(f.root,[['Hello','Reply']]));f.store.put('branch',{...b,sessionName:'Tree title',sessionNameOrigin:'manual'});f.store.local('instances',[{id:'copy',branchId:b.id,nativeId:'thread',agent:'codex',applied:true,title:'Client original',observedTitle:'Client original'}]);const calls=[];let title='Client original';const manager=new TranscriptionTitles(f.store,{roots:{codex:f.root}},{support:()=>({supported:true}),binary:()=>'/fixture',refresh:async()=>({status:'sent'}),clientFactory:()=>({init:async()=>{},close:async()=>{},request:async(method,params)=>{calls.push(method);if(method==='thread/read')return {thread:{name:title}};assert.equal(method,'thread/name/set');title=params.name;return {};}})});manager.ready=()=>true;
 await manager.rename(b.id,'Native new',{expected:{thread:'Client original'}});assert.equal(title,'Native new');assert.equal(f.store.get('branch',b.id).transcriptionTitle,'Native new');assert.equal(f.store.get('branch',b.id).sessionName,'Tree title');assert.equal(f.store.instances()[0].observedTitle,'Native new');assert.deepEqual(calls,['thread/read','thread/name/set','thread/read','thread/read']);
});
test('manual client changes win and a failed refresh restores the old native title',async t=>{
 const f=setup(t),b=f.store.branch(null,'Alias','codex',codexSample(f.root,[['Question','Answer']]));f.store.local('instances',[{id:'copy',branchId:b.id,nativeId:'thread',agent:'codex',applied:true,title:'Original'}]);let title='Original',writes=0;const manager=new TranscriptionTitles(f.store,{roots:{codex:f.root}},{support:()=>({supported:true}),binary:()=>'/fixture',refresh:async()=>({status:'unavailable'}),clientFactory:()=>({init:async()=>{},close:async()=>{},request:async(method,p)=>{if(method==='thread/read')return {thread:{name:title}};writes++;title=p.name;return {};}})});manager.ready=()=>true;
 await assert.rejects(manager.rename(b.id,'Proposed'),/refresh is unavailable/);assert.equal(title,'Original');assert.equal(writes,2);assert.equal(f.store.get('branch',b.id).transcriptionTitle,undefined);
 title='My client name';await assert.rejects(manager.rename(b.id,'Proposed'),e=>e.code==='CLIENT_TITLE_CHANGED');assert.equal(writes,2);assert.equal(f.store.get('branch',b.id).transcriptionNameOrigin,'manual');
});

test('compaction closes a node once; subsequent tail appends reuse its completed evidence',async t=>{
 const f=setup(t),b=f.store.branch(null,'Native','codex',codexSample(f.root,[['Before compact','Completed outcome']]));f.enabled.add(b.id);await f.smart.save({nameTranscripts:true});
 const head=f.store.get('branch',b.id).head,compact={type:'compacted',payload:{message:'Retained summary',replacement_history:[{type:'message',role:'user',content:[{type:'input_text',text:'Summary'}]}]}};
 f.store.ingest(b.id,f.store.raw(head)+JSON.stringify(compact)+'\n',head,{});f.smart.observe();await f.flush();assert.equal(f.requests.length,1);
 append(f.store,b,'After compact','Still the tail');f.smart.observe();await f.flush();assert.equal(f.requests.length,1,'a new empty/unfinished tail does not pay again for the same completed context');
});
test('two new paths share one in-flight naming request when their completed context is identical',async t=>{
 const f=setup(t),b=f.store.branch(null,'Native','codex',codexSample(f.root,[['Shared','Result'],['Tail','Not included']]));f.enabled.add(b.id);await f.smart.save({nameTranscripts:true});const c=f.store.fork(b.id,{name:'Child',end:f.store.detail(b.id).checkpoints[0].end});f.enabled.add(c.id);f.smart.observe();clearTimeout(f.smart.timer);
 const one=f.smart.run(),two=f.smart.run();await Promise.all([one,two]);clearTimeout(f.smart.timer);assert.equal(f.requests.length,1);assert.equal(f.renames.length,2);
});
test('a missing client defers naming without spending a model request',async t=>{
 const f=setup(t),b=f.store.branch(null,'Native','codex',codexSample(f.root,[['Shared','Result'],['Tail','Reply']]));f.enabled.add(b.id);await f.smart.save({nameTranscripts:true});f.adapter.ready=()=>false;f.store.fork(b.id,{name:'Fork',end:f.store.detail(b.id).checkpoints[0].end});f.smart.observe();await f.flush();assert.equal(f.requests.length,0);assert.ok(f.smart.data.jobs.some(j=>j.waitingForClient));f.adapter.ready=()=>true;f.smart.retry();await f.flush();assert.equal(f.requests.length,1);
});

test('transcription observation shares trees and skips unchanged history across restart',async t=>{
 const f=setup(t),b=f.store.branch(null,'Native','codex',codexSample(f.root,[['First','Done'],['Tail','Reply']]));
 const child=f.store.fork(b.id,{name:'Child',end:f.store.detail(b.id).checkpoints[0].end});
 f.enabled.add(b.id);f.enabled.add(child.id);
 let builds=0;const original=f.store.treeGraph.bind(f.store);f.store.treeGraph=(...args)=>{builds++;return original(...args);};
 await f.smart.save({nameTranscripts:true});clearTimeout(f.smart.timer);assert.equal(builds,1,'one graph for both native paths');
 f.smart.observe();clearTimeout(f.smart.timer);assert.equal(builds,1);
 f.smart.close();
 const restarted=new Intelligence(f.store,{transcriptions:f.adapter,canApply:()=>false});t.after(()=>restarted.close());
 assert.equal(builds,1,'saved signature survives startup');
 append(f.store,b,'Changed','New answer');restarted.observe();clearTimeout(restarted.timer);assert.equal(builds,2,'changed history is examined');
 const fork=f.store.fork(b.id,{name:'New fork',end:f.store.detail(b.id).checkpoints[1].end});f.enabled.add(fork.id);
 restarted.observe();clearTimeout(restarted.timer);assert.equal(builds,3,'new membership invalidates the tree');
});
