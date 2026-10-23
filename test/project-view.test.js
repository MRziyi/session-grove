import test from 'node:test';
import assert from 'node:assert/strict';
import {projectView} from '../src/project-view.js';
const session=(id,archived=false)=>({id,archived,updatedAt:'2026-01-01'});
test('project lifecycle distinguishes empty, filtered, archived and unavailable indexes',()=>{
 const data={projects:[{id:'empty',count:99},{id:'history'},{id:'archived',archived:true},{id:'cloud',count:10},{id:'work',count:0}],items:[{id:'a',projectId:'history',sessions:[session('a',true)]},{id:'b',projectId:'archived',sessions:[session('b')]},{id:'c',projectId:'work',sessions:[session('c'),session('d',true)]}]};
 let v=projectView(data,new Set(['cloud']));assert.deepEqual(v.availability.map(p=>p.state),['empty','filtered','archived','unloaded','available']);assert.deepEqual(v.directory.map(p=>[p.id,p.itemCount,p.sessionCount]),[['work',1,1]]);assert.equal(v.items[0].sessions.length,1);
 data.items[0].sessions[0].archived=false;v=projectView(data);assert.deepEqual(v.directory.map(p=>p.id),['history','work']);
 data.items=[];v=projectView(data);assert.equal(v.directory.length,0);assert.equal(data.projects.length,5,'empty metadata is retained for restores and moves');
});
test('native availability cannot erase saved project history; cloud-only entries need no native file',()=>{
 const data={projects:[{id:'p'}],items:[{id:'tree',projectId:'p',cloudState:'cloud',sessions:[session('a'),session('b')]}],instances:[{branchId:'a',missing:true}]};
 const v=projectView(data);assert.equal(v.directory[0].itemCount,1);assert.equal(v.directory[0].sessionCount,2);
 data.instances[0].missing=false;assert.deepEqual(projectView(data),v);
});

test('hidden or trashed membership is filtered history, not an empty project entity',()=>{
 const data={projects:[{id:'p'}],items:[],branches:[{id:'hidden',projectId:'p',trashed:true}]};
 const view=projectView(data);assert.equal(view.availability[0].state,'filtered');assert.equal(view.directory.length,0);
});
