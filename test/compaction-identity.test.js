import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {parse,renderNative} from '../src/transcript.js';import {codexSample,codexTurn} from '../src/demo.js';import {hash} from '../src/util.js';
const lines=rows=>rows.map(v=>JSON.stringify(v)+'\n').join('');
const payload={message:'Retained context',replacement_history:[{type:'compaction',encrypted_content:'opaque-same-result'}],first_window_id:'first',previous_window_id:'previous',window_id:'result'};
const marker=(value=payload,timestamp='2026-01-01T00:00:00Z')=>({type:'compacted',timestamp,payload:value});
const raw=(result=payload)=>codexSample('/fixture',[['Shared question','Shared answer']])+lines([marker(result)])+lines(codexTurn('Same following question','Same following answer'));
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-compaction-id-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return store;}
function family(s,result=payload){const a=s.branch(null,'Parent','codex',raw()),rewritten=lines(raw(result).trim().split('\n').map((v,i)=>({...JSON.parse(v),timestamp:'2026-02-02T00:00:00Z',ordinal:i+300}))),b=s.branch(null,'Fork','codex',rewritten);s.put('branch',{...b,parentId:a.id,forkRevision:a.head,forkEnd:s.get('revision',b.head).refs.length,forkParentEnd:s.get('revision',a.head).refs.length});return {a,b};}

test('compaction identity ignores physical timestamps, ordinals and payload key order, retaining full result data',()=>{
 const a=parse(raw(),'codex').context.compactions[0],rewritten=lines(raw().trim().split('\n').map((v,i)=>{const r=JSON.parse(v);return {...r,ordinal:i+77,timestamp:'2030-01-01T00:00:00Z',...(r.type==='compacted'?{payload:Object.fromEntries(Object.entries(r.payload).reverse())}:{})};})),b=parse(rewritten,'codex').context.compactions[0];
 assert.equal(a.id,b.id);assert.notEqual(a.legacyId,b.legacyId);
 for(const different of [{...payload,window_id:'other'},{...payload,replacement_history:[{type:'compaction',encrypted_content:'different-result'}]},{...payload,unknown_future_field:'meaningful'}])assert.notEqual(parse(raw(different),'codex').context.compactions[0].id,a.id);
 const events=parse(codexSample('/fixture',[['Before','Reply']])+lines([marker(),marker()]),'codex').context.compactions;
 assert.notEqual(events[0].id,events[1].id,'two real occurrences are not collapsed');
 const expanded=parse(renderNative(codexSample('/fixture',[['Before','Reply']])+lines([marker(),marker()]),'codex','new-id','/fixture','Fork',{disabled:[events[1].id]}),'codex');assert.equal(expanded.context.compactions.length,1);assert.equal(expanded.context.compactions[0].id,events[0].id);
});

test('a shared compaction is one control that atomically changes all inherited copies',t=>{
 const s=setup(t),{a,b}=family(s),before=[s.raw(a.head),s.raw(b.head)],g=s.treeGraph(a.id,'in-use'),events=g.paths.map(p=>p.context.compactions[0]);
 assert.equal(new Set(events.map(e=>e.id)).size,1);assert.equal(new Set(events.map(e=>e.groupId)).size,1);assert.equal(events[0].groupSize,2);
 const result=s.setCompaction(b.id,{eventId:events[1].id,enabled:false,head:b.head,version:g.version});assert.equal(result.changedPaths,2);
 for(const p of s.treeGraph(a.id,'in-use').paths){assert.equal(p.context.compactions[0].enabled,false);assert.equal(p.context.compactions[0].groupMixed,false);assert.deepEqual(s.get('branch',p.branchId).contextPolicy.disabled,[events[0].id]);}
 assert.deepEqual([s.raw(a.head),s.raw(b.head)],before,'control changes never rewrite stored history');
 const child=s.fork(a.id,{name:'Later fork',end:s.detail(a.id).checkpoints.at(-1).end});assert.deepEqual(child.contextPolicy.disabled,[events[0].id]);
});

test('old per-copy decisions survive reading and display mixed until an explicit shared choice',t=>{
 const s=setup(t),{a,b}=family(s),event=s.parsed(a.head,'codex').context.compactions[0],legacy={disabled:[event.legacyId]};s.put('branch',{...a,contextPolicy:legacy});
 for(const branch of s.all('branch'))s.summary(branch.head,branch.agent);
 const before=s.db.prepare('SELECT total_changes() n').get().n,g=s.treeGraph(a.id,'in-use');assert.equal(s.db.prepare('SELECT total_changes() n').get().n,before,'reading mixed settings never silently normalizes user decisions');
 assert.deepEqual(s.get('branch',a.id).contextPolicy,legacy);assert.ok(g.paths.every(p=>p.context.compactions[0].groupMixed));
 assert.equal(parse(renderNative(s.raw(a.head),'codex','new-id','/fixture','Expanded',legacy),'codex').context.compactions.length,0,'legacy Off still applies to native materialization');
 s.setCompaction(a.id,{eventId:event.legacyId,head:a.head,enabled:true,version:g.version});for(const id of [a.id,b.id])assert.deepEqual(s.get('branch',id).contextPolicy?.disabled||[],[]);
});

test('different compacted results split inherited context even when all visible messages match',t=>{
 const s=setup(t),{a,b}=family(s,{...payload,replacement_history:[{type:'compaction',encrypted_content:'other-result'}]}),g=s.treeGraph(a.id,'in-use'),left=g.paths.find(p=>p.branchId===a.id),right=g.paths.find(p=>p.branchId===b.id);
 assert.equal(left.messages[0].id,right.messages[0].id,'pre-compaction context remains shared');assert.notEqual(left.messages.at(-1).id,right.messages.at(-1).id,'post-compaction histories are separate');
 assert.notEqual(left.nodeIds.at(-1),right.nodeIds.at(-1));assert.notEqual(left.context.compactions[0].groupId,right.context.compactions[0].groupId);
 s.setCompaction(a.id,{eventId:left.context.compactions[0].id,head:a.head,enabled:false,version:g.version});assert.equal(s.treeGraph(a.id).paths.find(p=>p.branchId===b.id).context.compactions[0].enabled,true);
});

test('stale group changes and partial failures leave every copy unchanged',t=>{
 const s=setup(t),{a,b}=family(s),g=s.treeGraph(a.id,'in-use'),event=g.paths[0].context.compactions[0];s.put('branch',{...s.get('branch',b.id),contextPolicy:{disabled:[event.id]}});
 assert.throws(()=>s.setCompaction(a.id,{eventId:event.id,head:a.head,enabled:false,version:g.version}),/Conversation changed/);assert.equal(s.get('branch',a.id).contextPolicy,undefined);
 const edit=s.edit.bind(s);let count=0;s.edit=(...args)=>{if(++count===2)throw Error('Synthetic write failure');return edit(...args);};
 // Both paths change when the mixed group is explicitly enabled after marking A off.
 s.put('branch',{...s.get('branch',a.id),contextPolicy:{disabled:[event.id]}});const version=s.treeGraph(a.id,'in-use').version;
 assert.throws(()=>s.setCompaction(a.id,{eventId:event.id,head:a.head,enabled:true,version}),/Synthetic write failure/);for(const id of [a.id,b.id])assert.deepEqual(s.get('branch',id).contextPolicy.disabled,[event.id]);
});

test('missing compaction result identity never silently merges two path controls',t=>{
 const s=setup(t),a=s.branch(null,'A','codex',raw({message:'',replacement_history:[]})),b=s.fork(a.id,{name:'B',end:s.detail(a.id).checkpoints.at(-1).end}),g=s.treeGraph(a.id,'in-use');
 assert.equal(g.paths.length,2);assert.ok(g.paths.every(p=>p.context.compactions[0].shareable===false));assert.notEqual(g.paths[0].context.compactions[0].groupId,g.paths[1].context.compactions[0].groupId);
});

test('shared choices synchronize across devices while archived copies retain their old decision',t=>{
 const s=setup(t),other=setup(t),{a,b}=family(s),archived=s.fork(a.id,{name:'Archived copy',end:s.detail(a.id).checkpoints.at(-1).end});s.put('branch',{...archived,archived:true});
 const g=s.treeGraph(a.id,'in-use'),event=g.paths[0].context.compactions[0];assert.equal(event.groupSize,2);
 s.setCompaction(a.id,{eventId:event.id,enabled:false,head:a.head,version:g.version});assert.equal(s.get('branch',archived.id).contextPolicy,undefined);
 other.merge(s.exportGraph(),Object.fromEntries(s.db.prepare('SELECT hash,body FROM objects').all().map(r=>[r.hash,r.body])));
 const remote=other.treeGraph(a.id,'in-use');assert.equal(remote.paths.length,2);assert.ok(remote.paths.every(p=>p.context.compactions[0].id===event.id&&!p.context.compactions[0].enabled));
 s.put('branch',{...s.get('branch',archived.id),archived:false});assert.ok(s.treeGraph(a.id,'in-use').paths.every(p=>p.context.compactions[0].groupMixed),'restoring a differently configured copy is visible, not silently overwritten');
});

test('legacy Off survives prefix activation and a later fork using stable policy IDs',async t=>{
 const {policyForCompactions}=await import('../src/compaction-identity.js'),s=setup(t),a=s.branch(null,'Parent','codex',raw()),event=s.parsed(a.head,'codex').context.compactions[0];
 s.put('branch',{...a,contextPolicy:{disabled:[event.legacyId]}});
 const b=s.fork(a.id,{name:'Child',end:s.detail(a.id).checkpoints.at(-1).end});assert.deepEqual(b.contextPolicy.disabled,[event.id]);
 const beforeCompaction=s.parsed(a.head,'codex',event.line-1);assert.deepEqual(policyForCompactions(s.get('branch',a.id).contextPolicy,beforeCompaction.context.compactions),{disabled:[]});
 const rewritten=lines(s.raw(b.head).trim().split('\n').map(v=>({...JSON.parse(v),timestamp:'2040-01-01T00:00:00Z'})));
 assert.equal(parse(renderNative(rewritten,'codex','materialized','/fixture','Child',b.contextPolicy),'codex').context.compactions.length,0,'newly written timestamps do not resurrect a disabled compaction');
});

test('native integer payloads beyond JavaScript precision cannot alias to the same compaction',()=>{
 const source=raw({...payload,native_counter:'replace-me'}),one=source.replace('"replace-me"','9007199254740992'),two=source.replace('"replace-me"','9007199254740993');
 assert.notEqual(parse(one,'codex').context.compactions[0].id,parse(two,'codex').context.compactions[0].id);
 const plain=source.replace('"replace-me"','1000'),equivalent=source.replace('"replace-me"','1.000e3');assert.equal(parse(plain,'codex').context.compactions[0].id,parse(equivalent,'codex').context.compactions[0].id,'equivalent numeric spellings normalize without losing precision');
});


test('frozen fork context stays distinct when a parent revision replaces its compaction result',t=>{
 const s=setup(t),a=s.branch(null,'Parent','codex',raw()),b=s.fork(a.id,{name:'Frozen child',end:s.detail(a.id).checkpoints.at(-1).end});
 const revision=s.revision(raw({...payload,window_id:'new-parent-window'}),a.head,{operation:'context-replacement'});s.put('branch',{...s.get('branch',a.id),head:revision.id});
 const graph=s.treeGraph(a.id),left=graph.paths.find(p=>p.branchId===a.id),right=graph.paths.find(p=>p.branchId===b.id);
 assert.equal(left.messages[0].id,right.messages[0].id);assert.notEqual(left.messages.at(-1).id,right.messages.at(-1).id);assert.notEqual(left.nodeIds.at(-1),right.nodeIds.at(-1));
});

test('old named-node assignments survive adding compaction identity to message prefixes',t=>{
 const s=setup(t),{a,b}=family(s);let prefix='';const assignments={};
 for(const m of s.parsed(a.head,'codex').messages){prefix=hash(prefix+JSON.stringify([m.role,m.text]));if(m.line>s.parsed(a.head,'codex').context.compactions[0].line)assignments[a.id+':'+prefix.slice(0,24)]={id:'legacy-label',name:'My preserved node',nameOrigin:'manual'};}
 s.put('layout',{id:'old-layout',rootId:a.id,assignments});s.put('branch',{...s.get('branch',a.id),layoutHead:'old-layout'});
 const graph=s.treeGraph(a.id);for(const p of graph.paths)assert.ok(p.nodeIds.some(id=>graph.nodes.find(n=>n.id===id).name==='My preserved node'));
});
