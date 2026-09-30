// Explicit local corpus acceptance. No private transcript or title is printed.
// Usage: node scripts/real-workspace-audit.js /path/to/snapshot [output-directory]
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {rootOf,treeMembers} from '../src/organization.js';import {nodeActivation} from '../src/node-activation.js';import {prepareConversion,createConversion} from '../src/conversion.js';import {stageTrashAsync,restoreTrashAsync,cleanupLocal,isTrashed} from '../src/trash.js';import {repairLegacyRecoveries} from '../src/recovery-lineage.js';import {hash} from '../src/util.js';
const source=path.resolve(process.argv[2]||''),root=process.argv[3]?path.resolve(process.argv[3]):fs.mkdtempSync(path.join(os.tmpdir(),'grove-real-audit-'));
assert.ok(process.argv[2]&&fs.existsSync(path.join(source,'grove.sqlite')),'Pass a consistent real-library snapshot.');assert.notEqual(source,root);
fs.mkdirSync(root,{recursive:true});const library=path.join(root,'library');fs.mkdirSync(library,{recursive:true});
fs.copyFileSync(path.join(source,'grove.sqlite'),path.join(library,'grove.sqlite'),fs.constants.COPYFILE_FICLONE);
for(const name of ['device.json','trash'])if(fs.existsSync(path.join(source,name)))fs.cpSync(path.join(source,name),path.join(library,name),{recursive:true});
const store=new Store(library),native=new Native(store,{roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
store.local('instances',[]);store.local('localUpdateStarted',false);store.local('syncStarted',false);
const report={sourceBranches:store.all('branch').length,sourceProjects:store.all('project').length,checks:[],failures:[],rejections:[],repair:repairLegacyRecoveries(store),metrics:[]};
const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
const check=async(name,fn)=>{const at=performance.now();try{const result=await fn();report.checks.push({name,ms:Math.round(performance.now()-at),...result});}catch(e){report.failures.push({name,message:e.message,stack:e.stack});}save();};
const digestPath=p=>hash(JSON.stringify(p.messages.map(({role,text})=>[role,text])));
const initial=store.listing('projects').items;let treeGraphs=[];
try{
 for(const [index,item] of initial.entries())await check('read-tree-'+index,async()=>{
  const graph=store.treeGraph(item.id);assert.ok(graph.paths.length);assert.equal(new Set(graph.paths.map(p=>p.branchId)).size,graph.paths.length);
  for(const p of graph.paths){assert.ok(p.nodeIds.every(id=>graph.nodes.some(n=>n.id===id)));assert.equal(new Set(p.messages.map(m=>m.id)).size,p.messages.length);}
  treeGraphs.push({item,paths:graph.paths.map(p=>({branchId:p.branchId,digest:digestPath(p),nodes:p.nodeIds.length}))});
  return {paths:graph.paths.length,nodes:graph.nodes.length,chats:graph.chatCount};
 });
 console.log(JSON.stringify({phase:'read',trees:treeGraphs.length,failures:report.failures.length}));
 // Every real path: root, middle and endpoint preview, plus stale/missing-node rejection.
 for(const [index,{item,paths}] of treeGraphs.entries())await check('activation-preview-'+index,async()=>{
  const graph=store.treeGraph(item.id);let previews=0,complete=0;
  for(const p of graph.paths)for(const nodeId of new Set([p.nodeIds[0],p.nodeIds[Math.floor(p.nodeIds.length/2)],p.nodeIds.at(-1)])){
   try{const selected=nodeActivation(store,native,{branchId:p.branchId,nodeId,version:graph.version,cwd:root});previews++;if(selected.preview.complete)complete++;}
   catch(error){report.rejections.push({operation:'preview',tree:index,reason:error.message});}
  }
  const p=graph.paths[0];assert.throws(()=>nodeActivation(store,native,{branchId:p.branchId,nodeId:p.nodeIds[0],version:'stale',cwd:root}),/changed/);
  assert.throws(()=>nodeActivation(store,native,{branchId:p.branchId,nodeId:'missing',version:graph.version,cwd:root}),/Select a node/);
  return {previews,complete};
 });
 console.log(JSON.stringify({phase:'preview',failures:report.failures.length}));
 // Materialize real prefixes from all multi-path families and standalone examples.
 const representatives=treeGraphs.filter(({paths},index)=>paths.length>1||index<3);
 for(const [index,{item}] of representatives.entries())await check('native-roundtrip-'+index,async()=>{
  let graph=store.treeGraph(item.id);const p=graph.paths.find(p=>p.agent==='codex'&&p.canActivate)||graph.paths.find(p=>p.canActivate);if(!p)return {unavailable:'No supported complete native path'};
  let activated=0;const chosen=[...new Set([p.nodeIds[0],p.nodeIds[Math.floor(p.nodeIds.length/2)],p.nodeIds.at(-1)])];
  for(const nodeId of chosen){
   graph=store.treeGraph(item.id);const selected=nodeActivation(store,native,{branchId:p.branchId,nodeId,version:graph.version,cwd:root});if(!selected.preview.complete){report.rejections.push({operation:'activate-incomplete',tree:index,node:nodeId});continue;}
   const before=hash(store.raw(selected.branch.head)),continuation=store.fork(p.branchId,{name:'Acceptance continuation',end:selected.end,revisionId:selected.branch.head,nodeBoundary:selected.nodeBoundary});
   native.setActive(continuation.id,root,true,{nodeName:selected.preview.nodeName});native.apply([continuation.id]);
   const instance=store.instances().find(i=>i.branchId===continuation.id);assert.ok(instance.applied&&fs.existsSync(instance.file));
   const expected=store.parsed(continuation.head,continuation.agent).messages.filter(m=>m.role!=='tool').map(m=>[m.role,m.text]);
   const {parse}=await import('../src/transcript.js');assert.deepEqual(parse(native.history(instance.file,continuation.agent),continuation.agent).messages.filter(m=>m.role!=='tool').map(m=>[m.role,m.text]),expected);
   native.setActive(continuation.id,root,true);native.apply([continuation.id]);assert.equal(store.instances().filter(i=>i.branchId===continuation.id).length,1);
   native.setActive(continuation.id,null,false);native.apply([continuation.id]);assert.ok(!store.instances().some(i=>i.branchId===continuation.id&&i.applied));assert.equal(hash(store.raw(selected.branch.head)),before);activated++;
  }
  return {activated};
 });
 console.log(JSON.stringify({phase:'native',failures:report.failures.length}));
 for(const [index,{item}] of representatives.entries())await check('move-organize-convert-'+index,async()=>{
  const graph=store.treeGraph(item.id),p=graph.paths.find(p=>p.canActivate)||graph.paths[0],before=new Map(graph.paths.map(p=>[p.branchId,digestPath(p)]));
  const destination=store.project('Acceptance destination '+index),old=store.get('branch',item.id).projectId;
  store.moveItems({itemIds:[item.id],projectId:destination.id});assert.ok(treeMembers(store,item.id).every(b=>b.projectId===destination.id));
  store.moveItems({itemIds:[item.id],projectId:old||'00000000-0000-4000-8000-000000000001'});
  assert.throws(()=>store.moveItems({itemIds:[item.id],projectId:'missing'}));
  const archived=store.project('Archived destination');store.put('project',{...archived,archived:true});assert.throws(()=>store.moveItems({itemIds:[item.id],projectId:archived.id}));
  const current=store.treeGraph(item.id);if(current.nodes.length){const n=current.nodes[0];store.organize(item.id,{action:'rename',pathId:n.branchIds[0],nodeId:n.id,name:'Acceptance node',version:current.version});const next=store.treeGraph(item.id);assert.ok(next.nodes.some(n=>n.name==='Acceptance node'));assert.throws(()=>store.organize(item.id,{action:'rename',pathId:n.branchIds[0],nodeId:n.id,name:'stale',version:current.version}));}
  let conversions=0;const b=store.get('branch',p.branchId),checkpoints=store.parsed(b.head,b.agent).checkpoints,end=checkpoints.at(-1)?.end;
  if(end)for(const mode of ['messages','lean','full']){
   const opts={target:b.agent==='codex'?'claude':'codex',mode,cwd:root,end};
   try{const prepared=prepareConversion(store,b.id,opts);assert.throws(()=>createConversion(store,b.id,{...opts,fingerprint:'stale'}),/changed/);const result=createConversion(store,b.id,{...opts,fingerprint:prepared.preview.fingerprint});assert.ok(store.parsed(result.branch.head,result.branch.agent).complete);conversions++;}
   catch(error){report.rejections.push({operation:'conversion',tree:index,mode,reason:error.message});}
  }
  for(const path of store.treeGraph(item.id).paths)if(before.has(path.branchId))assert.equal(digestPath(path),before.get(path.branchId));return {conversions};
 });
 console.log(JSON.stringify({phase:'organization',failures:report.failures.length}));
 // Trash/restore each actual original family, including its new inactive continuations.
 // No full-library cleanup is repeated per restored entry.
 for(const [index,{item}] of treeGraphs.entries())await check('trash-restore-'+index,async()=>{
  const before=store.treeGraph(item.id),members=before.paths.map(p=>p.branchId),digests=before.paths.map(digestPath).sort(),phases=[];let last=performance.now(),maxGap=0;const heartbeat=setInterval(()=>{const at=performance.now();maxGap=Math.max(maxGap,at-last);last=at;},10);
  const onProgress=async p=>{phases.push({phase:p.phase,completed:p.completed,total:p.total,at:performance.now()});};
  try{
   const entry=await stageTrashAsync(store,members,[item.id],{onProgress});assert.ok(members.every(id=>isTrashed(store,id)));
   const start=performance.now(),restored=await restoreTrashAsync(store,entry.id,{onProgress}),restoreMs=Math.round(performance.now()-start),after=store.treeGraph(restored.branchIds[0]);
   assert.equal(after.paths.length,before.paths.length);assert.deepEqual(after.paths.map(digestPath).sort(),digests);assert.ok(restored.branchIds.every(id=>!store.instances().some(i=>i.branchId===id)));
   assert.deepEqual(after.nodes.filter(n=>n.name).map(n=>n.name).sort(),before.nodes.filter(n=>n.name).map(n=>n.name).sort());
   await assert.rejects(restoreTrashAsync(store,entry.id),/expired/);
   report.metrics.push({tree:index,paths:members.length,restoreMs,maxHeartbeatGapMs:Math.round(maxGap),backupBytes:fs.statSync(path.join(store.root,'trash',entry.id+'.json.gz')).size,phases:[...new Set(phases.map(p=>p.phase))]});return {paths:members.length,restoreMs};
  }finally{clearInterval(heartbeat);}
 });
 console.log(JSON.stringify({phase:'restore',failures:report.failures.length}));
 await check('all-restored-trees-remain-readable-after-cleanup',async()=>{cleanupLocal(store);for(const i of store.listing('projects').items){const g=store.treeGraph(i.id);assert.ok(g.paths.length);}return {trees:store.listing('projects').items.length};});
}finally{save();store.close();}
console.log(JSON.stringify({report:path.join(root,'report.json'),checks:report.checks.length,failures:report.failures.map(f=>({name:f.name,message:f.message})),rejections:report.rejections.length}));
process.exitCode=report.failures.length?1:0;
