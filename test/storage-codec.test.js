import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {hash} from '../src/util.js';import {codexSample,codexTurn} from '../src/demo.js';
import {packRevisions,unpackRevisions} from '../src/revision-codec.js';import {packStorage,unpackStorage} from '../src/storage-codec.js';
import {optimizeStorage} from '../src/storage-maintenance.js';import {treeSnapshot,graphFingerprint} from '../src/cloud-view.js';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-storage-codec-')),s=new Store(root);t.after(()=>{s.close();fs.rmSync(root,{recursive:true,force:true});});return s;}
test('revision deltas preserve ordering, truncation, rewrites and independent arrays',()=>{
 const refs=Array.from({length:180},(_,i)=>hash('r'+i)),rows=[{id:'c',parent:'b',refs:[...refs.slice(0,100),hash('rewrite')],source:{kind:'rewrite'}},{id:'a',parent:null,refs,source:{kind:'root'}},{id:'b',parent:'a',refs:refs.slice(0,130),source:{kind:'fork'}}],packed=packRevisions(rows),decoded=unpackRevisions(packed);
 assert.equal(JSON.stringify(decoded),JSON.stringify(rows));decoded[2].refs[0]='changed';assert.equal(decoded[1].refs[0],refs[0]);assert.ok(JSON.stringify(packed).length<JSON.stringify(rows).length*.6);
 const bad=structuredClone(packed);bad[0].prefix=10000;assert.throws(()=>unpackRevisions(bad),/prefix/);const cycle=structuredClone(packed);cycle[0].base='c';assert.throws(()=>unpackRevisions(cycle),/cycle/);
});
test('packed native records retain exact UTF-8 bytes and reject damaged frames',()=>{
 const raw=JSON.stringify({type:'response_item',payload:{type:'function_call_output',output:('汉字\u2028quoted " text\\path\n').repeat(6000)}})+'\n',packed=packStorage(raw);assert.ok(packed instanceof Uint8Array);assert.equal(unpackStorage(packed),raw);
 const damaged=Buffer.from(packed);damaged[damaged.length-1]^=1;assert.throws(()=>unpackStorage(damaged));assert.throws(()=>unpackStorage(Buffer.from('unknown storage frame')));
});
test('rewriting a parent revision freezes encoded child history and clears stale parse views',t=>{
 const s=fixture(t),raw=codexSample('/fixture',Array.from({length:20},(_,i)=>['Q'+i,'A'+i])),b=s.branch(null,'Root','codex',raw),first=s.get('revision',b.head);s.ingest(b.id,raw+codexTurn('Tail','Done').map(r=>JSON.stringify(r)+'\n').join(''),b.head,{});const child=s.get('branch',b.id).head,before=s.raw(child);
 assert.equal(s.db.prepare("SELECT typeof(body) t FROM entities WHERE id=?").get(child).t,'blob');s.treeGraph(b.id);const other=s.branch(null,'Replacement','codex',codexSample('/fixture',[['Different','Reply']]));s.put('revision',{...first,refs:s.get('revision',other.head).refs});
 assert.equal(s.raw(child),before);assert.notEqual(s.raw(first.id),raw);const received=s.get('revision',child);received.refs[0]='mutated';assert.equal(s.raw(child),before);
 const parentRaw=s.raw(first.id),track=s.storage.trackRevision.bind(s.storage);s.storage.trackRevision=()=>{throw Error('Synthetic dependency index failure');};
 try{assert.throws(()=>s.put('revision',{...first,refs:s.get('revision',child).refs}),/dependency index failure/);}finally{s.storage.trackRevision=track;}
 assert.equal(s.raw(first.id),parentRaw);assert.equal(s.raw(child),before);
});
test('storage migration preserves graphs and bytes, serves reads, and is idempotent',async t=>{
 const s=fixture(t),raw=codexSample('/fixture',[['Question','Text '.repeat(12000)]]),b=s.branch(null,'Stored tree','codex',raw);
 for(let i=0;i<6;i++){const prev=s.get('branch',b.id);s.ingest(b.id,s.raw(prev.head)+codexTurn('Next '+i,'Result '+i).map(r=>JSON.stringify(r)+'\n').join(''),prev.head,{});}
 const head=s.get('branch',b.id).head,expectedRaw=s.raw(s.get('branch',b.id).head);for(const row of s.all('revision'))s.db.prepare('UPDATE entities SET body=? WHERE id=?').run(JSON.stringify(row),row.id);for(const row of s.db.prepare('SELECT hash,body FROM objects').all())s.db.prepare('UPDATE objects SET body=? WHERE hash=?').run(unpackStorage(row.body),row.hash);s.storage.clear();
 const graph=treeSnapshot(s,b.id),fingerprint=graphFingerprint(graph),key='git-undo:fixture:'+b.id;s.db.prepare('INSERT INTO local(key,body) VALUES (?,?)').run(key,JSON.stringify({ack:fingerprint,graph}));let progress=0,blocked=false;const phases=[];
 const result=await optimizeStorage(s,{onProgress:async p=>{phases.push(p);progress++;assert.ok(s.snapshot().items.length);try{s.edit(b.id,{name:'Cannot write during packing'});}catch(e){blocked=e.status===409;}}});
 assert.ok(result.afterBytes<result.beforeBytes);assert.ok(progress>0&&blocked);assert.ok(phases.some(p=>p.phase==='Copying storage recovery copy'&&p.total>0&&p.unit==='bytes'));assert.equal(result.recoveryCopyVerified,true);assert.equal(result.backupFile,null);assert.deepEqual(fs.readdirSync(path.join(s.root,'storage-backups')),[]);s.invalidate();assert.equal(s.raw(head),expectedRaw);
 assert.equal(graphFingerprint(treeSnapshot(s,b.id)),fingerprint);assert.equal(graphFingerprint(s.local(key).graph),fingerprint);const again=await optimizeStorage(s,{backup:false});assert.equal(again.alreadyOptimized,true);assert.equal(again.changedObjects,0);assert.equal(again.changedEntities,0);assert.equal(s.get('branch',b.id).name,'Stored tree');
});
test('persisted conversation views match uncached graphs and recover from cache damage',t=>{
 const s=fixture(t),b=s.branch(null,'View','codex',codexSample('/fixture',[['First','Done'],['Next','Result']])),expected=s.treeGraph(b.id);s.graphProjections=null;s.invalidate();const original=s.objectStatement.get;s.objectStatement.get=()=>assert.fail('A saved view must not read raw tool records');assert.deepEqual(s.treeGraph(b.id),expected);s.objectStatement.get=original;
 s.db.prepare('UPDATE conversation_views SET body=?').run('broken cache');s.graphProjections=null;s.invalidate();assert.deepEqual(s.treeGraph(b.id),expected);
});
