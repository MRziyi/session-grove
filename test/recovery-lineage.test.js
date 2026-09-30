import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {codexSample} from '../src/demo.js';import {stageTrash,restoreTrash,cleanupLocal} from '../src/trash.js';import {repairLegacyRecoveries} from '../src/recovery-lineage.js';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-lineage-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return store;}
test('legacy transcript-only recovery reconnects by recorded identity and verified history, once',t=>{
 const store=setup(t),parent=store.branch(null,'Original','codex',codexSample('/work',[['Shared question','Shared answer'],['Parent question','Parent answer']])),child=store.fork(parent.id,{name:'Child',end:store.detail(parent.id).checkpoints[0].end});
 const graph=store.treeGraph(parent.id),p=graph.paths.find(p=>p.branchId===child.id);store.organize(parent.id,{action:'combine',pathId:child.id,version:graph.version,chatIds:p.messages.map(m=>m.id),name:'Shared name'});
 const helper=store.branch(null,'Old helper','codex',store.raw(child.head)),entry=stageTrash(store,[helper.id],[helper.id]);
 for(const key of ['trashEntries','trashPending'])store.local(key,store.local(key).map(e=>e.id===entry.id?{...e,branchIds:[...e.branchIds,child.id]}:e));store.invalidate();cleanupLocal(store);
 const restored=restoreTrash(store,entry.id),id=restored.branchIds[0],raw=store.raw(store.get('branch',id).head);assert.notEqual(store.treeGraph(id).id,parent.id);
 assert.deepEqual(repairLegacyRecoveries(store).repaired,[id]);assert.equal(store.treeGraph(id).id,parent.id);assert.equal(store.raw(store.get('branch',id).head),raw);assert.ok(store.treeGraph(id).nodes.some(n=>n.name==='Shared name'&&n.branchIds.length===2));assert.deepEqual(repairLegacyRecoveries(store).repaired,[]);assert.equal(store.local('recoveryLineageRepairs').length,1);
});
test('same titles never justify reconnecting unrelated recovery history',t=>{
 const store=setup(t),parent=store.branch(null,'Same title','codex',codexSample('/work',[['Original','Answer']])),child=store.fork(parent.id,{name:'Same title',end:store.detail(parent.id).checkpoints[0].end}),helper=store.branch(null,'Same title','codex',codexSample('/work',[['Unrelated','Different']])),entry=stageTrash(store,[helper.id],[helper.id]);
 for(const key of ['trashEntries','trashPending'])store.local(key,store.local(key).map(e=>e.id===entry.id?{...e,branchIds:[...e.branchIds,child.id]}:e));store.invalidate();
 const restored=restoreTrash(store,entry.id);assert.deepEqual(repairLegacyRecoveries(store).repaired,[]);assert.notEqual(store.treeGraph(restored.branchIds[0]).id,parent.id);
});
