import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRevisionRefs, decodeRevisionRefs } from '../src/revision-wire.js';
import { hash } from '../src/util.js';
test('wire reference sharing restores exact arrays, including fork metadata differences',()=>{
 const refs=Array.from({length:1000},(_,i)=>hash(String(i))),graph={schema:3,branches:[{head:'child',forkRevision:'parent'}],revisions:[{id:'append',parent:'child',refs:[hash('meta'),...refs.slice(1),hash('new')]},{id:'child',parent:null,refs:[hash('meta'),...refs.slice(1)]},{id:'parent',parent:null,refs}]};
 const packed=encodeRevisionRefs(graph);assert.deepEqual(decodeRevisionRefs(packed),graph);assert.ok(JSON.stringify(packed).length<JSON.stringify(graph).length/2);
});
test('malformed and cyclic encoded references fail closed',()=>{
 assert.throws(()=>decodeRevisionRefs({revisions:[{id:'a',refs:{base:'a',prefix:0,patches:[],tail:[]}}]}),/Cyclic/);
 assert.throws(()=>decodeRevisionRefs({revisions:[{id:'a',refs:[]},{id:'b',refs:{base:'a',prefix:1,patches:[],tail:[]}}]}),/prefix/);
});
