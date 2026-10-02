import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Cloud,treeSnapshot,graphFingerprint} from '../src/cloud.js';
import {codexSample} from '../src/demo.js';
import {hash} from '../src/util.js';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-resources-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return store;}

test('status fingerprints preserve sync bytes without retaining export graphs',t=>{
    const s=setup(t),b=s.branch(null,'Unicode 测试','codex',codexSample('/fixture',[['Question','Answer']])),cloud=new Cloud(s,()=>({}));
    const graph=treeSnapshot(s,b.id),expected=hash(JSON.stringify(graph));
    assert.equal(graphFingerprint(graph),expected);
    assert.equal(graphFingerprint({...graph,optional:undefined,retention:{schema:1,ranges:{},extras:{}}}),hash(JSON.stringify({...graph,optional:undefined,retention:{schema:1,ranges:{},extras:{}}})));
    s.invalidate();assert.deepEqual(cloud.dirtyIds(),[b.id]);
    assert.equal(s.memoCache.get('fingerprint:'+b.id),expected);
    assert.ok(![...s.memoCache.keys()].some(k=>k==='exportGraph'||k==='cloud-snapshot-index'||k.startsWith('cloud-tree:')));
    const build=s.buildExportGraph;s.buildExportGraph=()=>{throw Error('Unchanged status must not export history');};assert.deepEqual(cloud.dirtyIds(),[b.id]);s.buildExportGraph=build;
    const existing=treeSnapshot(s,b.id);cloud.dirtyIds();assert.equal(treeSnapshot(s,b.id),existing,'an export owned by another operation stays cached');
    cloud.useSavedCache();const cache=cloud.cache();cache.ack[b.id]=expected;s.local(cloud.cacheKey||'cloud:no-vault',cache);assert.deepEqual(cloud.dirtyIds(),[]);
    s.put('branch',{...s.get('branch',b.id),name:'Changed'});assert.deepEqual(cloud.dirtyIds(),[b.id]);
});

test('unchanged entity writes do not invalidate projections or modify SQLite',t=>{
    const s=setup(t),b=s.branch(null,'Same','codex',codexSample('/fixture',[['Question','Answer']]));
    const view=s.collections(),version=s.version,changes=()=>s.db.prepare('SELECT total_changes() n').get().n,before=changes();
    s.put('branch',s.get('branch',b.id));assert.equal(changes(),before);assert.equal(s.version,version);assert.equal(s.collections(),view);
    s.put('branch',{...b,name:'Different'});assert.equal(changes(),before+1);assert.notEqual(s.collections(),view);
});

test('family inference excludes other working directories before parsing their tool histories',t=>{
    const s=setup(t),project=s.project('Filed');
    s.branch(project.id,'Other','codex',codexSample('/other',[['Shared initial question','Shared answer'],['Next','Reply']]));
    const a=s.branch(null,'Candidate A','codex',codexSample('/candidate',[['Shared initial question','Shared answer'],['Next','Reply']]));
    s.branch(null,'Candidate B','codex',codexSample('/candidate',[['Shared initial question','Shared answer'],['Next','Reply'],['Suffix','Final']]));
    // Native discovery persists these summaries before family inference runs.
    for(const branch of s.all('branch'))s.summary(branch.head,branch.agent);
    const original=s.parsed.bind(s);s.parsed=(...args)=>{const parsed=original(...args);assert.notEqual(parsed.cwd,'/other');return parsed;};
    assert.ok(s.detectFamilies().grouped>0);assert.ok(s.get('branch',a.id).parentId);
});

test('tree projections stay identical when raw parse results cannot be cached',t=>{
    const s=setup(t),b=s.branch(null,'Root','codex',codexSample('/fixture',[['First','Done'],['Next','Result']]));
    s.fork(b.id,{name:'Fork',end:s.detail(b.id).checkpoints[0].end});
    const expected=s.treeGraph(b.id);s.invalidate();
    const original=s.parsed.bind(s),reads=new Map();
    s.parsed=(revision,agent,end)=>{s.parseCache.clear();s.parseBytes=0;const key=agent+':'+revision+':'+end;reads.set(key,(reads.get(key)||0)+1);return original(revision,agent,end);};
    assert.deepEqual(s.treeGraph(b.id),expected);
    assert.ok([...reads.values()].every(n=>n===1),'each revision/prefix is projected once even without a raw parse cache');
});

test('async tree loading yields measured path progress and never caches a mixed revision',async t=>{
 const s=setup(t),b=s.branch(null,'Root','codex',codexSample('/fixture',[['First','Done'],['Next','Result']]));
 s.fork(b.id,{name:'Fork',end:s.detail(b.id).checkpoints[0].end});
 const expected=s.treeGraph(b.id,'in-use');s.invalidate();let ticked=false;setImmediate(()=>{ticked=true;});const progress=[];
 const actual=await s.treeGraphAsync(b.id,'in-use',{onProgress:async p=>{progress.push(p);await new Promise(r=>setImmediate(r));}});
 assert.equal(ticked,true);assert.deepEqual(actual,expected);assert.ok(progress.some(p=>p.completed===1&&p.total===2));
 s.invalidate();let changed=false;
 await assert.rejects(s.treeGraphAsync(b.id,'in-use',{onProgress:async()=>{if(!changed){changed=true;s.put('branch',{...s.get('branch',b.id),name:'Updated during load'});}}}),/Session changed while loading/);
 assert.ok(!s.memoCache.has('graph:'+b.id));assert.equal((await s.treeGraphAsync(b.id,'in-use')).name,'Updated during load');
});
