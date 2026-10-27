import test from 'node:test';import assert from 'node:assert/strict';
import {writeGraphParts,graphPartsReader} from '../src/git-graph.js';import {hash} from '../src/util.js';

function encode(graph){const data=new Map(),manifest=writeGraphParts(graph,(part,text)=>data.set(part.hash,text),{targetBytes:150});return {data,manifest};}
test('graph parts preserve exact canonical JSON, array order and Unicode text',()=>{
 const graph={schema:3,projects:[{id:'p',name:'汉字 \u2028 \u2029'}],branches:[{id:'root',parentId:null}],nodes:[],layouts:[],revisions:Array.from({length:12},(_,i)=>({id:'r'+i,parent:i?'r'+(i-1):null,refs:[hash('record'+i)]})),retention:{schema:1,ranges:{r0:1},extras:{}}},e=encode(graph),reader=graphPartsReader(e.manifest);
 assert.ok(e.manifest.parts.length>1);for(const part of e.manifest.parts)reader.append(part,e.data.get(part.hash));
 assert.equal(JSON.stringify(reader.finish()),JSON.stringify(graph));
});
test('graph part readers reject missing, modified, unsafe and mislabelled data',()=>{
 const e=encode({schema:3,projects:[{id:'p'}],branches:[],revisions:[]}),part=e.manifest.parts[0];
 assert.throws(()=>graphPartsReader(e.manifest).finish(),/Missing Git graph part/);
 assert.throws(()=>graphPartsReader(e.manifest).append(part,e.data.get(part.hash).replace('p','q')),/integrity/);
 assert.throws(()=>graphPartsReader({...e.manifest,parts:[{...part,hash:'../escape'}]}),/Invalid Git graph part/);
 assert.throws(()=>graphPartsReader({...e.manifest,fields:[...e.manifest.fields,e.manifest.fields[0]]}),/Invalid Git graph field/);
 const raw=JSON.stringify(['unknown',{id:'x'}])+'\n',wrong={hash:hash(raw),bytes:Buffer.byteLength(raw),rows:1},manifest={...e.manifest,parts:[wrong]};assert.throws(()=>graphPartsReader(manifest).append(wrong,raw),/Invalid Git graph row/);
 const count={...part,rows:2},counts={...e.manifest,parts:[count]};assert.throws(()=>graphPartsReader(counts).append(count,e.data.get(part.hash)),/row count/);
});

test('compact graph parts retain canonical identities with parent-prefix deltas',()=>{
 const refs=Array.from({length:1000},(_,i)=>hash('reference '+i)),graph={schema:3,projects:[],branches:[],nodes:[],layouts:[],revisions:[{id:'parent',parent:null,refs},{id:'child',parent:'parent',refs:[...refs,hash('tail')]}]},parts=new Map(),manifest=writeGraphParts(graph,(part,text)=>parts.set(part.hash,text),{compact:true,targetBytes:8000}),reader=graphPartsReader(manifest);
 assert.equal(manifest.schema,2);for(const part of manifest.parts)reader.append(part,parts.get(part.hash));assert.equal(JSON.stringify(reader.finish()),JSON.stringify(graph));assert.ok([...parts.values()].join('').length<JSON.stringify(graph).length*.6);
});
