import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readCodexHistory, codexFiles, supportedHistory } from '../src/codex-history.js';
import { codexSample, codexTurn } from '../src/demo.js';
import { parse, renderNative } from '../src/transcript.js';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { hash } from '../src/util.js';
const lines = rows => rows.map(v => JSON.stringify(v) + '\n').join('');
test('older paginated forks without ordinals retain native ancestry even after the parent history changes', t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-older-fork-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const rows=codexSample(root,[['Shared question','Shared answer'],['Next question','Next answer']]).trim().split('\n').map(JSON.parse);rows[0].payload.history_mode='paginated';rows.forEach((r,i)=>r.ordinal=i);
 const parent=store.branch(null,'Parent','codex',lines(rows));
 const childRows=structuredClone(rows);childRows[0].payload.id=randomUUID();childRows[0].payload.forked_from_id=rows[0].payload.id;
 const child=store.branch(null,'Child','codex',lines(childRows));store.detectFamilies();assert.equal(store.get('branch',child.id).parentId,parent.id);
 const changed=codexSample(root,[['Edited prefix','Different answer']]).trim().split('\n').map(JSON.parse);changed[0].payload.id=rows[0].payload.id;changed[0].payload.history_mode='paginated';changed.forEach((r,i)=>r.ordinal=i);store.ingest(parent.id,lines(changed),parent.head,{});
 const otherRows=structuredClone(childRows);otherRows[0].payload.id=randomUUID();const other=store.branch(null,'Later child','codex',lines(otherRows));store.detectFamilies();const b=store.get('branch',other.id);assert.equal(b.parentId,parent.id);assert.equal(b.prefixUnavailable,true);assert.equal(b.forkEnd,0);assert.equal(store.treeGraph(parent.id).paths.length,3);
});
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-paginated-')),home=path.join(root,'codex'),dir=path.join(home,'sessions'),store=new Store(path.join(root,'library'));fs.mkdirSync(dir,{recursive:true});
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const parentRows=codexSample(root,[['Shared context','Context understood']]).trim().split('\n').map(JSON.parse);parentRows[0].payload.history_mode='paginated';parentRows.forEach((v,i)=>v.ordinal=i);
 const parentId=parentRows[0].payload.id,childId=randomUUID(),windowId=randomUUID(),cut=parentRows.length;
 const parentFile=path.join(dir,`rollout-${parentId}.jsonl`),oldFile=path.join(dir,`rollout-${childId}.jsonl`),currentFile=path.join(dir,`rollout-${childId}_${windowId}.jsonl`);
 fs.writeFileSync(parentFile,lines(parentRows));
 const metadata={...parentRows[0].payload,id:childId,session_id:childId,forked_from_id:parentId,forked_from_ordinal_exclusive:cut};
 const oldRows=[{type:'session_meta',ordinal:cut,payload:{...metadata,history_base:{thread_id:parentId,end_ordinal_exclusive:cut,end_byte_offset:Buffer.byteLength(lines(parentRows))}}},{type:'event_msg',ordinal:cut+1,payload:{type:'thread_settings_applied',thread_id:childId}}];
 const oldPrefix=lines(oldRows);fs.writeFileSync(oldFile,oldPrefix+lines(codexTurn('Unselected earlier version','Earlier answer').map((v,i)=>({...v,ordinal:cut+2+i}))));
 const childRows=[{type:'session_meta',ordinal:cut+2,payload:{...metadata,history_base:{thread_id:childId,end_ordinal_exclusive:cut+2,end_byte_offset:Buffer.byteLength(oldPrefix)}}},...codexTurn('Selected suffix','Current answer').map((v,i)=>({...v,ordinal:cut+3+i}))];fs.writeFileSync(currentFile,lines(childRows));
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,name TEXT,archived INTEGER,rollout_path TEXT,source TEXT,cwd TEXT,archived_at INTEGER)');for(const [id,name,file]of [[parentId,'Parent',parentFile],[childId,'Native fork',currentFile]])db.prepare('INSERT INTO threads(id,title,name,archived,rollout_path,source,cwd) VALUES(?,?,?,0,?,?,?)').run(id,name,name,file,'vscode',root);db.close();
 return {root,home,store,parentRows,parentId,childId,childRows,parentFile,oldFile,currentFile,oldPrefix,windowId};
}
test('resolve linked fork and edited-version segments exactly, ignoring discarded suffix and duplicate native rows',t=>{
 const f=fixture(t),before=[f.parentFile,f.oldFile,f.currentFile].map(file=>hash(fs.readFileSync(file))),raw=readCodexHistory(f.currentFile,codexFiles(f.home)),p=parse(raw,'codex');
 assert.equal(raw,lines(f.parentRows)+f.oldPrefix+lines(f.childRows));assert.equal(p.nativeId,f.childId);assert.equal(p.messages.length,4);assert.ok(supportedHistory(p));assert.ok(!raw.includes('Unselected earlier version'));
 const native=new Native(f.store,{roots:{codex:f.home,claude:path.join(f.root,'claude')},guard:()=>{}});assert.equal(native.refreshLocal().errors.length,0);
 const list=f.store.listing('active:codex');assert.equal(list.itemCount,1);assert.equal(list.items[0].kind,'tree');assert.equal(list.sessionCount,2);
 const graph=f.store.treeGraph(list.items[0].id);assert.equal(graph.paths.length,2);assert.equal(graph.chatCount,4);assert.ok(graph.paths.every(p=>p.canRewriteContext));
 assert.deepEqual([f.parentFile,f.oldFile,f.currentFile].map(file=>hash(fs.readFileSync(file))),before);
});
test('existing suffix-only imports are repaired once without duplicate sessions or native changes',t=>{
 const f=fixture(t),raw=fs.readFileSync(f.currentFile,'utf8'),old=f.store.branch(null,'Native fork','codex',raw);
 f.store.local('instances',[{id:randomUUID(),branchId:old.id,agent:'codex',nativeId:f.childId,root:f.home,cwd:f.root,file:f.currentFile,adopted:true,applied:true,desired:true,baseRevision:old.head,observedHash:hash(raw),baseline:null,title:'Native fork'}]);
 const native=new Native(f.store,{roots:{codex:f.home,claude:path.join(f.root,'claude')},guard:()=>{}});native.refreshLocal();assert.equal(f.store.detail(old.id).messages.length,4);assert.equal(f.store.listing('active:codex').itemCount,1);assert.equal(native.refreshLocal().updates.length,0);
});
test('unresolved byte references fail closed; context-window UUID references resolve',t=>{
 const f=fixture(t);assert.throws(()=>readCodexHistory(f.currentFile,[f.currentFile]),/prefix is missing/);
 const newId=randomUUID(),rows=parse(readCodexHistory(f.currentFile,codexFiles(f.home)),'codex').records.map(r=>r.value),last=rows.at(-1).ordinal+1;
 const file=path.join(path.dirname(f.currentFile),`rollout-${newId}.jsonl`);fs.writeFileSync(file,lines([{type:'session_meta',ordinal:last,payload:{...f.childRows[0].payload,id:newId,session_id:newId,history_base:{thread_id:f.windowId,end_ordinal_exclusive:last,end_byte_offset:fs.statSync(f.currentFile).size}}}]));
 assert.equal(parse(readCodexHistory(file,codexFiles(f.home)),'codex').messages.length,4);
});
test('self-contained paginated materialization preserves model items and exposes per-path compaction',t=>{
 const f=fixture(t),rows=parse(readCodexHistory(f.currentFile,codexFiles(f.home)),'codex').records.map(r=>r.value);rows.push({type:'compacted',ordinal:rows.length,payload:{message:'Summary',replacement_history:[{type:'compaction',encrypted_content:'opaque-preserved'}]}});rows.push(...codexTurn('After compact','Done').map((v,i)=>({...v,ordinal:rows.length+i})));
 const raw=lines(rows),project=f.store.project('Work'),b=f.store.branch(project.id,'Main','codex',raw),p=parse(raw,'codex'),event=p.context.compactions[0];
 f.store.setCompaction(b.id,{head:b.head,eventId:event.id,enabled:false});assert.equal(f.store.treeGraph(b.id).paths[0].canRewriteContext,true);
 const output=parse(renderNative(raw,'codex',randomUUID(),f.root,'Continued',{disabled:[event.id]}),'codex');assert.equal(output.context.compactions.length,0);assert.equal(supportedHistory(output),true);assert.ok(output.records.filter(r=>r.value.type==='session_meta').every(r=>!r.value.payload.history_base));
 assert.deepEqual(output.records.filter(r=>r.value.type==='response_item').map(r=>r.value.payload),p.records.filter(r=>r.value.type==='response_item').map(r=>r.value.payload));assert.equal(f.store.raw(b.head),raw);
});

test('deactivating a paginated parent keeps its native prefix reachable by active children',t=>{
 const f=fixture(t),native=new Native(f.store,{roots:{codex:f.home,claude:path.join(f.root,'claude')},guard:()=>{}});native.refreshLocal();const parent=f.store.all('branch').find(b=>!b.synthetic&&f.store.parsed(b.head,'codex').nativeId===f.parentId),expected=readCodexHistory(f.currentFile,codexFiles(f.home));
 native.setActive(parent.id,null,false);native.apply([parent.id]);assert.equal(readCodexHistory(f.currentFile,codexFiles(f.home)),expected);assert.equal(f.store.collections().activeCounts.codex,1);native.refreshLocal();assert.equal(f.store.collections().activeCounts.codex,1);
});

test('authoritative native pointers link already summarized sessions without parsing or hashing their prefix again',t=>{
 const f=fixture(t),native=new Native(f.store,{roots:{codex:f.home,claude:path.join(f.root,'claude')},guard:()=>{}}),infer=f.store.detectFamilies;
 f.store.detectFamilies=()=>({grouped:0});native.refreshLocal();f.store.detectFamilies=infer;
 for(const b of f.store.all('branch'))f.store.summary(b.head,b.agent);
 const before=f.store.db.prepare('SELECT COUNT(*) AS n FROM objects').get().n,original=f.store.parsed;f.store.parsed=()=>{throw new Error('Unexpected full-history parse');};
 const result=f.store.detectFamilies();f.store.parsed=original;assert.equal(result.trustedLinks,1);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM objects').get().n,before);
});

test('restart reuses verified summaries and file stamps without reading unchanged history bodies',t=>{
 const f=fixture(t),roots={codex:f.home,claude:path.join(f.root,'claude')},native=new Native(f.store,{roots,guard:()=>{}});native.refreshLocal();native.refreshLocal();
 const reopened=new Store(f.store.root);t.after(()=>reopened.close());const next=new Native(reopened,{roots,guard:()=>{}});reopened.raw=()=>{throw new Error('Unchanged history should not be read again');};
 assert.equal(next.refreshLocal().errors.length,0);assert.equal(reopened.snapshot().items.length,1);assert.ok(reopened.snapshot().instances.every(i=>!('summaryJson' in i)&&!('baseline' in i)));
});
