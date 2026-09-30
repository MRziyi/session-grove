// Explicitly selected library history, isolated native home; no model turns.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {parse,renderNative} from '../src/transcript.js';import {connect} from '../src/codex-rpc.js';import {hash,id} from '../src/util.js';import {claudeSample} from '../src/demo.js';import {forkSession,getSessionMessages} from '@anthropic-ai/claude-agent-sdk';
const [library,branchId]=process.argv.slice(2);assert(library&&branchId,'Pass library path and selected branch ID.');
const db=new DatabaseSync(path.join(library,'grove.sqlite'),{readOnly:true});
const b=JSON.parse(db.prepare('SELECT body FROM entities WHERE id=?').get(branchId).body),r=JSON.parse(db.prepare('SELECT body FROM entities WHERE id=?').get(b.head).body);
const source=r.refs.map(h=>db.prepare('SELECT body FROM objects WHERE hash=?').get(h).body).join('');db.close();
const p=parse(source,'codex');assert(p.checkpoints.length>2);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-node-native-')),home=path.join(root,'codex'),store=new Store(path.join(root,'library')),native=new Native(store,{roots:{codex:home,claude:path.join(root,'claude')},guard:()=>{}});
let client;const report={codexVersion:execFileSync(process.env.CODEX_BIN||'codex',['--version'],{encoding:'utf8'}).trim(),claudeSdk:'0.3.283',modelTurnsSubmitted:0,originalFilesChanged:false};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>hash(JSON.stringify(canonical(v)) ?? 'undefined');
const payloads=(raw,type)=>parse(raw,'codex').records.filter(r=>r.value?.type===type).map(r=>r.value.payload);
try{
 const full=p.records.slice(0,p.checkpoints.at(-1).end).map(r=>r.raw).join('');
 const parent=store.branch(null,'Source','codex',full);native.setActive(parent.id,root,true);native.apply([parent.id]);const origin=store.instances().find(i=>i.branchId===parent.id);
 client=connect(process.env.CODEX_BIN||'codex',home);await client.init();
 const resume=threadId=>client.request('thread/resume',{threadId,excludeTurns:true,cwd:root,approvalPolicy:'on-request',sandbox:'read-only'});
 await resume(origin.nativeId);
 const checkpoint=p.checkpoints[Math.floor(p.checkpoints.length/2)];
 const forked=await client.request('thread/fork',{threadId:origin.nativeId,lastTurnId:checkpoint.turnId,excludeTurns:true,cwd:root,approvalPolicy:'on-request',sandbox:'read-only'});
 const state=new DatabaseSync(path.join(home,'state_5.sqlite'),{readOnly:true}),file=state.prepare('SELECT rollout_path FROM threads WHERE id=?').get(forked.thread.id).rollout_path;state.close();
 await client.close();client=null;
 const child=store.fork(parent.id,{name:'Grove checkpoint',end:checkpoint.end});native.setActive(child.id,root,true);native.apply([child.id]);const projected=store.instances().find(i=>i.branchId===child.id),groveRaw=fs.readFileSync(projected.file,'utf8');
 // Native fork may use paginated parent references. Resume/read expands them.
 const {readCodexHistory,codexFiles}=await import('../src/codex-history.js');const expanded=readCodexHistory(file,codexFiles(home));
 const expectedItems=payloads(expanded,'response_item'),actualItems=payloads(groveRaw,'response_item');
 console.log(JSON.stringify({phase:'codex-boundary',nativeItems:expectedItems.length,groveItems:actualItems.length,commonPrefix:actualItems.findIndex((v,i)=>digest(v)!==digest(expectedItems[i]))}));
 const mismatch=actualItems.findIndex((v,i)=>digest(v)!==digest(expectedItems[i]));
 if(mismatch>=0)console.log(JSON.stringify({phase:'payload-difference',index:mismatch,type:actualItems[mismatch].type,fields:[...new Set([...Object.keys(actualItems[mismatch]),...Object.keys(expectedItems[mismatch]||{})])].filter(k=>digest(actualItems[mismatch][k])!==digest(expectedItems[mismatch]?.[k]))}));
 report.codexCompletedBoundary={modelHistoryIdentical:digest(expectedItems)===digest(actualItems),nativeItems:expectedItems.length,groveItems:actualItems.length};
 const differences=[];
 for(let i=0;i<actualItems.length;i++) for(const key of new Set([...Object.keys(actualItems[i]),...Object.keys(expectedItems[i]||{})])) if(digest(actualItems[i][key])!==digest(expectedItems[i]?.[key]))differences.push({type:actualItems[i].type,key,nativeType:expectedItems[i]?.[key]===null?'null':typeof expectedItems[i]?.[key],groveType:actualItems[i][key]===null?'null':typeof actualItems[i][key]});
 report.codexCompletedBoundary.differences=[...new Map(differences.map(d=>[JSON.stringify(d),d])).values()];
 const normalized=items=>items.map(item=>{const value={...item};if(value.type==='reasoning'&&value.content==null)delete value.content;return value;});
 report.codexCompletedBoundary.normalizedModelHistoryIdentical=digest(normalized(expectedItems))===digest(normalized(actualItems));
 const nativeMeta=parse(expanded,'codex').meta,groveMeta=parse(groveRaw,'codex').meta;
 report.codexCompletedBoundary.promptMetadataIdentical=['base_instructions','developer_instructions','dynamic_tools'].every(k=>digest(nativeMeta[k])===digest(groveMeta[k]));
 report.codexCompletedBoundary.worldStateIdentical=digest(payloads(expanded,'world_state'))===digest(payloads(groveRaw,'world_state'));
 assert.ok(report.codexCompletedBoundary.normalizedModelHistoryIdentical);assert.ok(report.codexCompletedBoundary.promptMetadataIdentical);assert.ok(report.codexCompletedBoundary.worldStateIdentical);
 const cp=p.checkpoints.find(c=>c.end>100),next=p.messages.find(m=>m.line>cp.end),end=Number(process.argv[4]) || next?.line;
 assert(end);const mid=store.fork(parent.id,{name:'Atomic message prefix',end,nodeBoundary:true});native.setActive(mid.id,root,true);native.apply([mid.id]);const midInstance=store.instances().find(i=>i.branchId===mid.id);
 client=connect(process.env.CODEX_BIN||'codex',home);await client.init();await resume(midInstance.nativeId);
 const actual=fs.readFileSync(midInstance.file,'utf8'),expected=p.records.slice(0,end).map(r=>r.raw).join('');assert.equal(digest(payloads(actual,'response_item')),digest(payloads(expected,'response_item')));
 report.codexIntermediateMessage={resumedByNativeClient:true,selectedModelHistoryIdentical:true,nativeForkBoundary:'lastTurnId',exactlyNativeTurnFork:false};
 await client.close();client=null;
 const rows=claudeSample(root,[['First','Answer'],['Second','Later answer']]).trim().split('\n').map(JSON.parse),session=rows[0].sessionId;
 const normalize=entries=>{const ids=new Map(entries.map(r=>[r.uuid,r.forkedFrom?.messageUuid||'<generated>']));const walk=(v,k)=>k==='timestamp'?'<timestamp>':k==='sessionId'?'<session>':typeof v==='string'?(ids.get(v)||v):Array.isArray(v)?v.map(x=>walk(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,walk(x,k)])):v;return entries.map(v=>walk(v));};
 report.claude=[];
 for(const end of [1,2,3]){
  let forked;const title='Prefix check';await forkSession(session,{title,upToMessageId:rows[end-1].uuid,sessionStore:{load:async()=>rows,append:async(_key,entries)=>{forked=entries;}}});
  const raw=rows.slice(0,end).map(r=>JSON.stringify(r)+'\n').join('');const output=renderNative(raw,'claude',id(),root,title,null,null,true).trim().split('\n').map(JSON.parse);
  const expected=await getSessionMessages(session,{sessionStore:{load:async()=>forked}}),actual=await getSessionMessages(session,{sessionStore:{load:async()=>output}});
  const semantic=x=>x.map(m=>[m.type,m.message]);assert.equal(digest(semantic(actual)),digest(semantic(expected)));
  assert.equal(digest(normalize(output)),digest(normalize(forked)));
  report.claude.push({messages:end,messagePayloadsIdentical:true,normalizedRecordsIdentical:digest(normalize(output))===digest(normalize(forked))});
 }
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/node-fork-equivalence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await client?.close();store.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
