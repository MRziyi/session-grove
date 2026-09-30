import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGroups, selectRange } from '../web/library-view.js';
test('projects sort by latest conversation and keep each project contiguous',()=>{
    const groups=projectGroups([{id:'a',projectId:'p',updatedAt:'2026-01-01'},{id:'b',projectId:'q',updatedAt:'2026-02-01'},{id:'c',projectId:'p',updatedAt:'2026-03-01'}],[{id:'p',name:'P'},{id:'q',name:'Q'}]);
    assert.deepEqual(groups.map(g=>g.id),['p','q']);assert.deepEqual(groups[0].items.map(i=>i.id),['c','a']);
});
test('clicking the same single chat twice clears it; shift still extends ranges',()=>{
    assert.deepEqual(selectRange(3,null,3),{start:null,end:null});assert.deepEqual(selectRange(3,3,3),{start:null,end:null});
    assert.deepEqual(selectRange(3,null,8),{start:3,end:8});assert.deepEqual(selectRange(3,8,9,true),{start:3,end:9});
});

test('inactive project boundaries include the recent edge and keep unknown dates visible',async()=>{
 const {inactiveProject}=await import('../web/library-view.js');const at=Date.parse('2026-09-28T12:00:00Z');
 for(const days of [7,15,30,60]){assert.equal(inactiveProject(new Date(at-days*86400000).toISOString(),days,at),false);assert.equal(inactiveProject(new Date(at-days*86400000-1).toISOString(),days,at),true);}
 assert.equal(inactiveProject(undefined,30,at),false);
});

test('project folding defaults to a week and supports count limits without reordering',async()=>{
 const {foldedItems}=await import('../web/library-view.js'),at=Date.parse('2026-09-28T12:00:00Z');const items=[0,2,7,8,30].map((days,id)=>({id,updatedAt:new Date(at-days*86400000).toISOString()}));
 assert.deepEqual(foldedItems(items,{},at).map(i=>i.id),[0,1,2]);assert.equal(foldedItems(items,{projectFoldMode:'count',projectFoldCount:4},at).length,4);assert.equal(foldedItems(items,{projectFoldMode:'none'},at).length,5);
});
test('pending names follow depth and Fork selects the preceding completed node',async()=>{
 const {pendingLabels,forkBeforeNode}=await import('../web/library-view.js'),nodes=[{id:'a',depth:0,chatIds:['1','2']},{id:'b',depth:1,chatIds:['3','4']},{id:'c',depth:1,chatIds:[]},{id:'d',depth:2,chatIds:[]}];
 assert.deepEqual([...pendingLabels(nodes).values()],['1','2.1','2.2','3.1']);const p={nodeIds:['a','b','d'],messages:[{id:'1',line:2},{id:'2',line:3},{id:'3',line:6},{id:'4',line:7}],checkpoints:[{end:4},{end:8}]};
 assert.equal(forkBeforeNode(p,nodes[0]),null);assert.equal(forkBeforeNode(p,nodes[1]).end,4);assert.equal(forkBeforeNode(p,nodes[3]).end,8);
 p.checkpoints=[{end:8}];assert.equal(forkBeforeNode(p,nodes[1]),null,'never invent a tool-completion boundary');
});

test('Pull and Push share pending, active, complete and failed stage semantics', async () => {
    const { transferStages } = await import('../web/library-view.js');
    assert.deepEqual(transferStages(null), { pull: 'pending', push: 'pending' });
    assert.deepEqual(transferStages({ direction: 'push', state: 'running' }), { pull: 'running', push: 'pending' });
    assert.deepEqual(transferStages({ direction: 'push', step: 'pull', state: 'running' }), { pull: 'running', push: 'pending' });
    assert.deepEqual(transferStages({ direction: 'push', step: 'push', state: 'running' }), { pull: 'complete', push: 'running' });
    assert.deepEqual(transferStages({ direction: 'push', step: 'push', state: 'error' }), { pull: 'complete', push: 'failed' });
    assert.deepEqual(transferStages({ direction: 'pull', step: 'pull', state: 'success' }), { pull: 'complete', push: 'pending' });
    assert.deepEqual(transferStages({ direction: 'push', step: 'push', state: 'success' }), { pull: 'complete', push: 'complete' });
});

test('older projects use the session fold threshold, not an independent project age',async()=>{
 const {olderProject}=await import('../web/library-view.js'),at=Date.parse('2026-09-30T12:00:00Z'),items=[{updatedAt:'2026-09-20T12:00:00Z'},{updatedAt:'2026-09-21T12:00:00Z'}];
 assert.equal(olderProject(items,{projectFoldMode:'time',projectFoldDays:7},at),true);
 assert.equal(olderProject(items,{projectFoldMode:'time',projectFoldDays:14},at),false);
 assert.equal(olderProject(items,{projectFoldMode:'count',projectFoldCount:1},at),false);
 assert.equal(olderProject(items,{projectFoldMode:'none'},at),false);assert.equal(olderProject([],{},at),false);
});
