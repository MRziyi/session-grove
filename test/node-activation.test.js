import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { codexSample, codexTurn, claudeSample } from '../src/demo.js';
import { activationInfo } from '../src/activation.js';
import { nodeActivation } from '../src/node-activation.js';
import { claudeTitle } from '../src/claude-title.js';
import { parse } from '../src/transcript.js';
import { estimateTokens } from '../src/context.js';
async function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-node-activate-'));
    const app = createApp({ root: path.join(root, 'library'), roots: { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') }, guard: () => {} });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    t.after(async () => { await new Promise(r => app.close(r)); fs.rmSync(root, { recursive: true, force: true }); });
    const api = async (route, body, method = 'POST') => { const response = await fetch('http://127.0.0.1:' + app.server.address().port + '/api/' + route, { method, headers: { 'X-Grove-Token': app.token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, value: await response.json() }; };
    return { app, root, api };
}
test('multiple compactions respect the selected window and zero usage does not erase its estimate', async t => {
    const {app,root}=await setup(t),store=app.store;
    const compact = summary => ({type:'compacted',payload:{message:summary,replacement_history:[]}});
    const zero = {type:'event_msg',payload:{type:'token_count',info:{last_token_usage:{input_tokens:0,output_tokens:0}}}};
    const second = codexTurn('Second question','Second answer'); second.splice(-1,0,zero);
    const rows = [compact('Earlier context summary'), ...second,compact('Later context summary'),...codexTurn('Third question','Third answer')];
    const b=store.branch(null,'Windows','codex',codexSample(root,[['First question','First answer']])+rows.map(v=>JSON.stringify(v)+'\n').join(''));
    let graph=store.treeGraph(b.id);
    const preview=()=>nodeActivation(store,app.native,{branchId:b.id,nodeId:graph.nodes[1].id,version:graph.version,cwd:root});
    let selected=preview();
    assert.equal(selected.parsed.context.compactions.length,1);
    assert.equal(selected.preview.estimated,estimateTokens('Earlier context summary')+estimateTokens('Second question')+estimateTokens('Second answer'));
    store.put('branch',{...store.get('branch',b.id),contextPolicy:{disabled:[selected.parsed.context.compactions[0].id]}});
    graph=store.treeGraph(b.id);selected=preview();
    assert.equal(selected.preview.estimated,['First question','First answer','Second question','Second answer'].reduce((n,s)=>n+estimateTokens(s),0));
    assert.doesNotMatch(selected.parsed.records.map(r=>r.raw).join(''),/Later context summary|Third question/);
});
test('a compaction inside an unfinished turn is excluded from the preceding node', async t => {
    const {app,root}=await setup(t),store=app.store;
    const rows=codexSample(root,[['Before compact','Earlier reply']]).trim().split('\n').map(JSON.parse);
    rows.pop(); // No task_complete checkpoint before the compaction.
    rows.push({type:'compacted',payload:{replacement_history:[{type:'compaction',encrypted_content:'opaque'}]}},...codexTurn('After compact','Later reply'));
    const b=store.branch(null,'Inside turn','codex',rows.map(v=>JSON.stringify(v)+'\n').join(''));
    const graph=store.treeGraph(b.id);
    const selected=nodeActivation(store,app.native,{branchId:b.id,nodeId:graph.nodes[0].id,version:graph.version,cwd:root});
    assert.equal(selected.parsed.context.compactions.length,0);
    assert.equal(selected.preview.estimated,estimateTokens('Before compact')+estimateTokens('Earlier reply'));
    assert.equal(selected.preview.complete,true);
    const last=nodeActivation(store,app.native,{branchId:b.id,nodeId:graph.nodes.at(-1).id,version:graph.version,cwd:root});
    assert.equal(last.preview.estimateIncomplete,true,'opaque summaries must not be represented as a complete token estimate');
});
test('fresh Codex and Claude node activations never require stopping clients', async t => {
    const {app,root,api}=await setup(t);
    app.native.guard=()=>{throw new Error('Client is running');};
    for(const [agent,sample] of [['codex',codexSample],['claude',claudeSample]]) {
        const b=app.store.branch(null,'New copy',agent,sample(root,[['Request','Response']]));
        const graph=app.store.treeGraph(b.id),selection={branchId:b.id,nodeId:graph.nodes[0].id,version:graph.version,cwd:root};
        const check=(await api('node-activation/check',selection)).value;
        const result=await api('node-activation/activate',{...selection,contextAcknowledgement:check.fingerprint});
        assert.equal(result.status,201,JSON.stringify(result.value));
        const instance=app.store.instances().find(i=>i.branchId===result.value.branch.id);
        assert.ok(fs.existsSync(instance.file));
        app.native.setActive(instance.branchId,null,false);
        assert.throws(()=>app.native.apply([instance.branchId]),/Client is running/,'rewriting an existing file still requires protection');
    }
});
test('activate an internal node includes it, preserves suffixes, labels native title, and attaches new work', async t => {
    const { app, root, api } = await setup(t), store = app.store;
    const b = store.branch(null, 'My session', 'codex', codexSample(root, [['Setup', 'Ready'], ['Existing later question', 'Long later answer. '.repeat(100)]]));
    let graph = store.treeGraph(b.id);
    store.organize(b.id, { version: graph.version, pathId: b.id, chatIds: graph.paths[0].messages.slice(0, 2).map(m => m.id), action: 'combine', name: 'Setup node' });
    graph = store.treeGraph(b.id); const sourceRaw = store.raw(b.head), node = graph.nodes.find(n => n.name === 'Setup node');
    const target = { branchId: b.id, nodeId: node.id, version: graph.version, cwd: root };
    const preview = (await api('node-activation/check', target)).value;
    assert.equal(preview.title, '[Grove] My session · Setup node'); assert.equal(preview.complete, true);
    assert.ok(preview.estimated < activationInfo(store, app.native, b.id, root).estimated);
    assert.equal(store.all('branch').length, 1, 'preview creates no branch');
    assert.equal((await api('node-activation/activate', { ...target, contextAcknowledgement: 'stale' })).status, 409);
    const response = await api('node-activation/activate', { ...target, contextAcknowledgement: preview.fingerprint }); assert.equal(response.status, 201);
    const child = response.value.branch, instance = store.instances().find(i => i.branchId === child.id && i.applied);
    assert.equal(child.parentId, b.id); assert.equal(instance.title, preview.title);
    assert.equal(store.detail(child.id).messages.length, 2); assert.equal(store.raw(b.head), sourceRaw);
    const index = fs.readFileSync(path.join(root, 'codex', 'session_index.jsonl'), 'utf8'); assert.ok(index.includes(preview.title));
    graph = store.treeGraph(b.id);
    store.organize(b.id, { version: graph.version, pathId: child.id, nodeId: 'empty-' + child.id, action: 'rename', name: 'Next work' });
    assert.equal(store.treeGraph(b.id).nodes.find(n => n.id === 'empty-' + child.id).name, 'Next work');
    fs.appendFileSync(instance.file, codexTurn('New continuation', 'New response').map(v => JSON.stringify(v) + '\n').join(''));
    app.native.refreshLocal();
    assert.equal(store.get('branch', child.id).name, 'My session');
    graph = store.treeGraph(b.id); const route = graph.paths.find(p => p.branchId === child.id);
    assert.deepEqual(route.messages.map(m => m.text), ['Setup', 'Ready', 'New continuation', 'New response']);
    assert.equal(route.nodeIds[0], node.id); assert.equal(store.raw(store.get('branch', b.id).head), sourceRaw);
    assert.equal(graph.nodes.find(n => n.id === route.nodeIds.at(-1)).name, 'Next work');
    assert.equal((await api('manage',{action:'deactivate',branchIds:[child.id]})).status,200);
    assert.ok(store.treeGraph(b.id).nodes.some(n=>n.id===route.nodeIds.at(-1)&&n.count===2),'a continuation with new chats survives deactivation');
    assert.equal((await api('trash', { branchIds: [b.id], nodeId: node.id, version: graph.version })).status, 409);
});
test('terminal activation forks without changing the source and Claude receives the exact title', async t => {
    const { app, root, api } = await setup(t), b = app.store.branch(null, 'Claude session', 'claude', claudeSample(root, [['Question', 'Answer']]));
    let graph = app.store.treeGraph(b.id);
    app.store.organize(b.id, { version: graph.version, pathId: b.id, nodeId: graph.nodes[0].id, action: 'rename', name: 'Final node' });
    graph = app.store.treeGraph(b.id); const target = { branchId: b.id, nodeId: graph.nodes[0].id, version: graph.version, cwd: root };
    const preview = (await api('node-activation/check', target)).value;
    const response = await api('node-activation/activate', { ...target, contextAcknowledgement: preview.fingerprint }); assert.equal(response.status, 201);
    assert.notEqual(response.value.branch.id, b.id); assert.equal(app.store.all('branch').length, 2);
    const instance = app.store.instances().find(i => i.branchId === response.value.branch.id && i.applied);
    assert.equal(claudeTitle(parse(fs.readFileSync(instance.file, 'utf8'), 'claude').records).title, '[Grove] Claude session · Final node');
});
test('node previews reject stale selections and accept intermediate message boundaries', async t => {
    const { app, root } = await setup(t), store = app.store, b = store.branch(null, 'Boundary', 'codex', codexSample(root, [['Question', 'Answer']]));
    let graph = store.treeGraph(b.id);
    store.organize(b.id, { version: graph.version, pathId: b.id, chatIds: [graph.paths[0].messages[0].id], action: 'combine', name: 'User message only' });
    graph = store.treeGraph(b.id);
    const target = { branchId: b.id, nodeId: graph.nodes[0].id, version: graph.version, cwd: root };
    assert.equal(nodeActivation(store, app.native, target).preview.readiness, 'ready');
    assert.equal(nodeActivation(store, app.native, target).preview.complete, true);
    store.edit(b.id, { name: 'Renamed' }); assert.throws(() => nodeActivation(store, app.native, target), /changed/);
});
test('Trash listing does not compute the library graph or cloud directory', async t => {
    const { app, api } = await setup(t);
    app.store.snapshot = app.autoSync.listing = app.autoSync.decorate = () => { throw Error('Full library traversal'); };
    const result = await api('trash', null, 'GET'); assert.equal(result.status, 200); assert.deepEqual(result.value, { trashEntries: [], trashNative: [] });
});
test('switching tools from an internal node converts only its prefix and previews the native title', async t => {
    const { app, root, api } = await setup(t), store = app.store;
    const b = store.branch(null, 'Portable session', 'codex', codexSample(root, [['Keep this prefix', 'Prefix answer'], ['EXCLUDED_SUFFIX', 'EXCLUDED_ANSWER']]));
    let graph = store.treeGraph(b.id);
    store.organize(b.id, { version: graph.version, pathId: b.id, action: 'combine', name: 'Portable node', chatIds: graph.paths[0].messages.slice(0, 2).map(m => m.id) });
    graph = store.treeGraph(b.id);
    const options = { branchId: b.id, nodeId: graph.nodes[0].id, version: graph.version, cwd: root, target: 'claude', mode: 'messages' };
    const preview = (await api('conversion-check', options)).value;
    assert.equal(preview.title, '[Grove] Portable session · Portable node');
    const response = await api('convert', { ...options, fingerprint: preview.fingerprint, contextAcknowledgement: preview.budget.fingerprint });
    assert.equal(response.status, 201);
    const child = response.value.branch, raw = store.raw(child.head);
    assert.ok(raw.includes('Keep this prefix')); assert.ok(!raw.includes('EXCLUDED_SUFFIX'));
    assert.equal(store.instances().find(i => i.branchId === child.id && i.applied).title, preview.title);
});

test('root and internal commentary nodes activate only their own prefix before a turn ends', async t => {
    const {app,root,api}=await setup(t),store=app.store;
    const rows=codexSample(root,[['Question','Final response']]).trim().split('\n').map(JSON.parse);
    const final=rows.findIndex(r=>r.type==='response_item'&&r.payload.role==='assistant');
    rows.splice(final,0,{type:'response_item',payload:{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'Intermediate thought'}]}},{type:'event_msg',payload:{type:'agent_message',message:'Final response',phase:'final_answer'}});
    const branch=store.branch(null,'Mid-turn','codex',rows.map(r=>JSON.stringify(r)+'\n').join(''));
    let graph=store.treeGraph(branch.id);store.organize(branch.id,{version:graph.version,pathId:branch.id,chatIds:graph.paths[0].messages.slice(0,2).map(m=>m.id),action:'combine',name:'Root prefix'});
    graph=store.treeGraph(branch.id);const node=graph.nodes.find(n=>n.name==='Root prefix'),selection={branchId:branch.id,nodeId:node.id,version:graph.version,cwd:root};
    const check=await api('node-activation/check',selection);assert.equal(check.value.complete,true);assert.equal(check.value.createsContinuation,true);
    const result=await api('node-activation/activate',{...selection,contextAcknowledgement:check.value.fingerprint});assert.equal(result.status,201,JSON.stringify(result.value));
    const fork=result.value.branch;assert.notEqual(fork.id,branch.id);
    assert.deepEqual(store.detail(fork.id).messages.map(m=>m.text),['Question','Intermediate thought']);
    const instance=store.instances().find(i=>i.branchId===fork.id);
    assert.doesNotMatch(fs.readFileSync(instance.file,'utf8'),/Final response/);
    assert.match(store.raw(branch.head),/Final response/);
});

test('Claude intermediate nodes materialize their prefix without the later reply', async t => {
    const {app,root,api}=await setup(t),store=app.store;
    const rows=claudeSample(root,[['Question','Intermediate'],['Later question','Later reply']]).trim().split('\n').map(JSON.parse);
    rows[1].message.stop_reason=null;
    const branch=store.branch(null,'Claude prefix','claude',rows.map(r=>JSON.stringify(r)+'\n').join(''));
    let graph=store.treeGraph(branch.id);store.organize(branch.id,{version:graph.version,pathId:branch.id,chatIds:graph.paths[0].messages.slice(0,2).map(m=>m.id),action:'combine',name:'First node'});
    graph=store.treeGraph(branch.id);const selection={branchId:branch.id,nodeId:graph.nodes[0].id,version:graph.version,cwd:root};
    const check=(await api('node-activation/check',selection)).value;assert.equal(check.complete,true);
    const result=await api('node-activation/activate',{...selection,contextAcknowledgement:check.fingerprint});assert.equal(result.status,201,JSON.stringify(result.value));
    const instance=store.instances().find(i=>i.branchId===result.value.branch.id);
    const raw=fs.readFileSync(instance.file,'utf8');assert.match(raw,/Intermediate/);assert.doesNotMatch(raw,/Later question|Later reply/);
});

test('deactivation removes only the empty activation placeholder and preserves explicit forks',async t=>{
    const {app,root,api}=await setup(t),store=app.store;
    for(const agent of ['codex','claude']){
        const b=store.branch(null,'Placeholder '+agent,agent,(agent==='codex'?codexSample:claudeSample)(root,[['Question','Answer']]));
        const graph=store.treeGraph(b.id),target={branchId:b.id,nodeId:graph.nodes.at(-1).id,version:graph.version,cwd:root};
        const preview=(await api('node-activation/check',target)).value;
        const activated=await api('node-activation/activate',{...target,contextAcknowledgement:preview.fingerprint});
        assert.equal(activated.status,201);const child=activated.value.branch,empty='empty-'+child.id;
        assert.ok(store.treeGraph(b.id).nodes.some(n=>n.id===empty));
        const deactivated=await api('manage',{action:'deactivate',branchIds:[child.id]});assert.equal(deactivated.status,200);
        assert.ok(!store.treeGraph(b.id).nodes.some(n=>n.id===empty));
        assert.equal(store.treeGraph(b.id).chatCount,2);
        // Explicit, unactivated forks still have their editable endpoint.
        const fork=store.fork(b.id,{name:'Deliberate fork',end:store.parsed(b.head,agent).checkpoints.at(-1).end});
        assert.ok(store.treeGraph(b.id).nodes.some(n=>n.id==='empty-'+fork.id));
    }
});

test('unused mid-turn continuation with a settings-only append deactivates through the native archive API',async t=>{
 const {app,root}=await setup(t),store=app.store;
 const {archiveNative}=await import('../src/native-archive.js'),{DatabaseSync}=await import('node:sqlite');
 const raw=codexSample(root,[['Question','Boundary answer']]).trim().split('\n').slice(0,-1).join('\n')+'\n';
 const source=store.branch(null,'Internal boundary','codex',raw),child=store.fork(source.id,{name:'Unused',end:store.parsed(source.head,'codex').records.length,nodeBoundary:true});store.put('branch',{...child,activationNodeName:'Boundary'});
 app.native.setActive(child.id,root,true,{nodeName:'Boundary'});app.native.apply([child.id]);const instance=store.instances().find(i=>i.branchId===child.id);
 fs.appendFileSync(instance.file,JSON.stringify({type:'event_msg',payload:{type:'thread_settings_applied'}})+'\n');app.native.collect();
 assert.ok(store.instances().find(i=>i.id===instance.id).pending);assert.equal(store.treeGraph(source.id).nodes.find(n=>n.id==='empty-'+child.id).count,0);
 const db=new DatabaseSync(path.join(app.native.roots.codex,'state_5.sqlite'));db.exec('CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,archived INTEGER,rollout_path TEXT)');db.prepare('INSERT OR REPLACE INTO threads(id,archived,rollout_path) VALUES(?,0,?)').run(instance.nativeId,instance.file);db.close();
 await archiveNative(store,app.native,[child.id],{archiveBranches:false,executable:'fixture',clientFactory:()=>({init:async()=>{},close:async()=>{},request:async(method)=>{assert.equal(method,'thread/archive');const d=new DatabaseSync(path.join(app.native.roots.codex,'state_5.sqlite'));d.prepare('UPDATE threads SET archived=1 WHERE id=?').run(instance.nativeId);d.close();}})});
 assert.equal(store.instances().find(i=>i.id===instance.id).applied,false);assert.ok(!store.treeGraph(source.id).nodes.some(n=>n.id==='empty-'+child.id));assert.equal((store.local('trashEntries')||[]).length,0);
});
test('discard previews native deactivation and the confirmed request completes all remaining work',async t=>{
 const {app,root,api}=await setup(t),store=app.store,{treeSnapshot}=await import('../src/cloud.js'),{hash}=await import('../src/util.js');
 const source=store.branch(null,'Keep source','codex',codexSample(root,[['Keep','Original']]));app.native.setActive(source.id,root,true);app.native.apply([source.id]);
 const baseline=treeSnapshot(store,source.id),cloud=app.autoSync.cloud;cloud.useSavedCache();const c=cloud.cache();c.ack[source.id]=hash(JSON.stringify(baseline));cloud.save(c);cloud.rememberBaseline(source.id,baseline);
 const graph=store.treeGraph(source.id),target={branchId:source.id,nodeId:graph.nodes[0].id,version:graph.version,cwd:root},check=(await api('node-activation/check',target)).value;
 const child=(await api('node-activation/activate',{...target,contextAcknowledgement:check.fingerprint})).value.branch;
 const selections=cloud.pendingItems(),preview=await api('synchronize/discard',{selections});assert.equal(preview.status,200);assert.equal(preview.value.confirmationRequired,true);assert.deepEqual(preview.value.sessions.map(s=>s.branchId),[child.id]);assert.ok(store.find('branch',child.id));
 const result=await api('synchronize/discard',{selections,confirmation:preview.value.confirmation});assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.discarded,1);assert.ok(!store.find('branch',child.id));assert.ok(store.instances().some(i=>i.branchId===source.id&&i.applied));assert.equal(cloud.pendingItems().length,0);
});
test('unused continuation exception never permits a newly started turn or unfinished tool',async t=>{
 const {app,root}=await setup(t),store=app.store,{readyToDeactivate}=await import('../src/native-readiness.js');
 const source=store.branch(null,'Source','codex',codexSample(root,[['Original','Answer']]));
 const child=store.fork(source.id,{name:'Child',end:store.parsed(source.head,'codex').records.length});store.put('branch',{...child,activationNodeName:'Pending'});
 const base=store.raw(child.head),instance={branchId:child.id};assert.equal(readyToDeactivate(store,instance),true);
 store.ingest(child.id,base+JSON.stringify({type:'event_msg',payload:{type:'task_started',turn_id:'new'}})+'\n',child.head,{});assert.equal(readyToDeactivate(store,instance),false);
});
test('discard waits for an existing operation instead of requiring the user to retry',async t=>{
 const {app,root,api}=await setup(t),b=app.store.branch(null,'Queued discard','codex',codexSample(root,[['Draft','Answer']]));
 const selections=app.autoSync.cloud.pendingItems();let release;const transfer=app.autoSync.exclusive(()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));
 try{
  const request=api('synchronize/discard',{selections});
  let state;for(let i=0;i<50;i++){state=(await api('status',null,'GET')).value.discardOperation;if(state?.phase==='Waiting for current operation')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(state?.phase,'Waiting for current operation');assert.ok(app.store.find('branch',b.id));release();await transfer;
  const result=await request;assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.discarded,1);assert.ok(!app.store.find('branch',b.id));
 }finally{release?.();await transfer;}
});
