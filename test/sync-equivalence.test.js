import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {codexSample} from '../src/demo.js';import {metadata} from '../src/organization.js';import {samePolicy,equivalentLayouts,reconcileEquivalentConflicts} from '../src/sync-equivalence.js';import {conflictItems,resolveConflicts} from '../src/conflicts.js';import {changeSnapshot,sessionChanges} from '../src/session-changes.js';import {hash} from '../src/util.js';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-equivalence-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return store;}
const copy=(a,b)=>b.merge(a.exportGraph(),Object.fromEntries(a.db.prepare('SELECT hash,body FROM objects').all().map(r=>[r.hash,r.body])));
function layout(s,b,id,groups){const chats=s.treeGraph(b.id).paths[0].messages.map(m=>m.id),assignments=Object.fromEntries(chats.map((chat,i)=>[chat,{id:groups[i],name:'Same title',nameOrigin:'manual'}]));s.put('layout',{id,rootId:b.id,parent:null,assignments});s.put('branch',{...s.get('branch',b.id),layoutHead:id});return assignments;}
test('context policy compares behavior rather than empty defaults, key order or disabled-set order',()=>{
 for(const a of [undefined,null,{}, {disabled:[]}])for(const b of [undefined,null,{}, {disabled:[]}])assert.ok(samePolicy(a,b));
 assert.ok(samePolicy({disabled:['b','a','a']},{disabled:['a','b']}));assert.ok(!samePolicy({disabled:['a']},{disabled:['b']}));assert.ok(!samePolicy({disabled:[],future:true},{disabled:[],future:false}));
});
test('Pull does not manufacture branch conflicts or pending context changes for an empty policy',t=>{
 const a=fixture(t),b=fixture(t),session=a.branch(null,'Session','codex',codexSample('/fixture',[['Q','A']]));copy(a,b);b.put('branch',{...b.get('branch',session.id),contextPolicy:{disabled:[]}});assert.equal(copy(b,a).conflicts,0);assert.equal(a.get('branch',session.id).contextPolicy,undefined);
 const graph=a.exportGraph(),before=changeSnapshot(graph);before.branches[session.id].context=hash(JSON.stringify({disabled:[]}));assert.equal(sessionChanges(before,changeSnapshot(graph),a).some(c=>c.kind==='context-changed'),false);assert.equal(changeSnapshot(b.exportGraph()).branches[session.id].context,hash(JSON.stringify({disabled:[]})),'persisted baseline fingerprints retain their legacy representation');
});
test('equivalent independently identified nodes join both layout lineages and retain local node identities',t=>{
 const a=fixture(t),b=fixture(t),session=a.branch(null,'Session','codex',codexSample('/fixture',[['Q1','A1'],['Q2','A2']]));copy(a,b);const assignments=layout(a,session,'left',['x','x','y','y']);layout(b,session,'right',['p','p','q','q']);
 const remote=b.get('layout','right');remote.assignments=Object.fromEntries(Object.entries(remote.assignments).map(([k,{id,name,nameOrigin}])=>[k,{nameOrigin,name,id}]));b.put('layout',remote);
 assert.equal(copy(b,a).conflicts,0);const merged=a.get('layout',a.get('branch',session.id).layoutHead);assert.deepEqual(merged.assignments,assignments);assert.equal(merged.parent,'left');assert.deepEqual(merged.mergeParents,['right']);
 const head=merged.id;assert.equal(copy(b,a).conflicts,0);assert.equal(a.get('branch',session.id).layoutHead,head);assert.equal(copy(a,b).conflicts,0);assert.equal(copy(b,a).conflicts,0);
});
test('same titles cannot hide different grouping; preview includes counts and message boundaries',t=>{
 const a=fixture(t),b=fixture(t),session=a.branch(null,'Session','codex',codexSample('/fixture',[['First user','First reply'],['Second user','Second reply']]));copy(a,b);layout(a,session,'left',['x','x','y','y']);layout(b,session,'right',['p','p','p','p']);
 assert.equal(equivalentLayouts(a.get('layout','left'),b.get('layout','right')),false);assert.equal(copy(b,a).conflicts,1);const changes=conflictItems(a)[0].changes;assert.ok(changes.some(c=>c.previousCount!==c.currentCount));assert.ok(changes.some(c=>c.previousMessages.length&&c.currentMessages.length));assert.ok(changes.every(c=>c.previous==='Same title'&&c.current==='Same title'));assert.deepEqual(changes.find(c=>c.previousCount===4).previousMessages.map(m=>m.text),['First user','Second reply']);assert.equal(reconcileEquivalentConflicts(a),0);
});
test('existing false conflicts are repaired atomically without replacing labels, raw history or client titles',t=>{
 const s=fixture(t),b=s.branch(null,'Session','codex',codexSample('/fixture',[['Question','Answer']]));s.put('branch',{...b,transcriptionTitle:'Manual client title'});const current=s.get('branch',b.id),raw=s.raw(b.head);s.local('conflicts',[{kind:'branch',local:current,remote:{...current,contextPolicy:{disabled:[]},transcriptionTitle:'Remote client title'}},{kind:'branch',local:current,remote:metadata(current,{name:'Genuinely different'})}]);
 assert.equal(reconcileEquivalentConflicts(s),1);assert.equal(s.local('conflicts').length,1);assert.equal(s.get('branch',b.id).transcriptionTitle,'Manual client title');assert.equal(s.raw(b.head),raw);assert.equal(s.get('branch',b.id).name,'Session');
});
test('naming provenance differences remain reviewable and explicit Pending is equivalent to unset',()=>{
 const a={rootId:'r',assignments:{chat:{id:'a',name:'Title',nameOrigin:'manual'},pending:null}},b={rootId:'r',assignments:{chat:{id:'b',name:'Title',nameOrigin:'automatic'}}};assert.equal(equivalentLayouts(a,b),false);b.assignments.chat.nameOrigin='manual';assert.equal(equivalentLayouts(a,b),true);
});
test('equal counts of disabled compactions expose distinct choices instead of identical summaries',t=>{
 const s=fixture(t),b=s.branch(null,'Session','codex',codexSample('/fixture',[['Question','Reply']])),a='a'.repeat(64),other='b'.repeat(64);s.put('branch',{...b,contextPolicy:{disabled:[a]}});const local=s.get('branch',b.id);s.local('conflicts',[{kind:'branch',local,remote:{...local,contextPolicy:{disabled:[other]}}}]);
 const change=conflictItems(s)[0].changes[0];assert.equal(change.previous,change.current);assert.notDeepEqual(change.previousDetails,change.currentDetails);assert.equal(reconcileEquivalentConflicts(s),0);
});
test('a real name conflict excludes UUID-only groups and keeping current prevents repeat Pull conflicts',async t=>{
 const a=fixture(t),b=fixture(t),session=a.branch(null,'Session','codex',codexSample('/fixture',[['Q1','A1'],['Q2','A2']]));copy(a,b);const assignments=layout(a,session,'left',['x','x','y','y']);layout(b,session,'right',['p','p','q','q']);const r=b.get('layout','right');for(const value of Object.values(r.assignments))if(value.id==='q')value.name='Other title';b.put('layout',r);
 assert.equal(copy(b,a).conflicts,1);const items=conflictItems(a);assert.equal(items[0].changes.length,1);assert.equal(items[0].changes[0].previous,'Other title');assert.equal(items[0].changes[0].current,'Same title');
 const raw=a.raw(session.head);await resolveConflicts(a,{collect:()=>({errors:[]})},items.map(({id,version})=>({id,version})),'current');assert.deepEqual(a.get('layout',a.get('branch',session.id).layoutHead).assignments,assignments);assert.equal(a.raw(session.head),raw);assert.equal(copy(b,a).conflicts,0);assert.equal(copy(a,b).conflicts,0);assert.equal(copy(b,a).conflicts,0);
});
