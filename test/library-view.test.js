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
