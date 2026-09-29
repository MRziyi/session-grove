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
