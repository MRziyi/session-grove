import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { codexSample, codexTurn } from '../src/demo.js';
const fixture = t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-workspace-')));
    const store = new Store(path.join(root, 'library')), cwd = path.join(root, 'work'); fs.mkdirSync(cwd);
    const roots = { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') };
    fs.mkdirSync(path.join(roots.codex, 'sessions'), { recursive: true });
    const native = new Native(store, { roots, guard: () => {} });
    t.after(() => { store.close(); fs.rmSync(root, { force: true, recursive: true }); });
    return { store, cwd, native, roots };
};
const pairs = count => Array.from({ length: count }, (_, i) => [`Question ${i}`, `Answer ${i}`]);
const copy = (a, b) => b.merge(a.exportGraph(), Object.fromEntries(a.db.prepare('SELECT * FROM objects').all().map(v => [v.hash, v.body])));
const edit = (store, branch, positions, action, name) => {
    const g = store.treeGraph(branch.id), p = g.paths.find(p => p.branchId === branch.id);
    return store.organize(branch.id, { version: g.version, pathId: branch.id, chatIds: positions.map(i => p.messages[i].id), action, name });
};
test('session and shared node edits reorder lists without changing transcript timestamps', t => {
    const { store, cwd } = fixture(t);
    const first = store.branch(null, 'Older', 'codex', codexSample(cwd, pairs(2)));
    const child = store.fork(first.id, { name: 'Child', end: store.detail(first.id).checkpoints[0].end });
    const other = store.branch(null, 'Recent', 'codex', codexSample(cwd, [['Other', 'Reply']]));
    for (const b of [first, child, other]) store.put('branch', { ...b, contentUpdatedAt: b.id === other.id ? '2026-01-02' : '2026-01-01' });
    assert.equal(store.collections().items.find(i => i.id === first.id).updatedAt, '2026-01-01');
    store.edit(first.id, { name: 'Renamed session' });
    assert.ok(store.collections().items.find(i => i.id === first.id).updatedAt > '2026-01-02');
    const version = store.version;
    store.edit(first.id, { name: 'Renamed session' }); assert.equal(store.version, version);
    const graph = store.treeGraph(first.id), node = graph.nodes.find(n => n.branchIds.includes(first.id) && n.branchIds.includes(child.id));
    store.organize(first.id, { version: graph.version, pathId: first.id, nodeId: node.id, action: 'rename', name: 'Shared setup' });
    for (const id of [first.id, child.id]) {
        assert.ok(store.get('branch', id).metadataUpdatedAt > '2026-01-02');
        assert.equal(store.get('branch', id).contentUpdatedAt, '2026-01-01');
    }
    const timestamp = store.get('branch', child.id).metadataUpdatedAt;
    const current = store.treeGraph(first.id);
    store.organize(first.id, { version: current.version, pathId: first.id, nodeId: current.nodes.find(n => n.name === 'Shared setup').id, action: 'rename', name: 'Shared setup' });
    assert.equal(store.get('branch', child.id).metadataUpdatedAt, timestamp);
    const remote = new Store(path.join(cwd, 'remote')); t.after(() => remote.close()); copy(store, remote);
    assert.equal(remote.get('branch', child.id).metadataUpdatedAt, timestamp);
});
test('logical nodes support arbitrary chat boundaries, internal Pending and neighboring repartition without native changes', t => {
    const { store, cwd } = fixture(t), b = store.branch(null, 'Draft', 'codex', codexSample(cwd, pairs(5))), raw = store.raw(b.head);
    edit(store, b, [0, 1, 2, 3, 4], 'combine', 'Context');
    edit(store, b, [5, 6, 7, 8, 9], 'combine', 'Writing');
    edit(store, b, [2, 3, 4], 'dissolve');
    let g = store.treeGraph(b.id);
    assert.deepEqual(g.nodes.map(n => [n.name, n.count]), [['Context', 2], [null, 3], ['Writing', 5]]);
    edit(store, b, [1, 2, 3, 4, 5], 'combine', 'Set up writing style');
    g = store.treeGraph(b.id);
    assert.deepEqual(g.nodes.map(n => [n.name, n.count]), [['Context', 1], ['Set up writing style', 5], ['Writing', 4]]);
    assert.equal(g.pendingCount, 0); assert.equal(store.raw(store.get('branch', b.id).head), raw);
    const appended = codexTurn('Next task', 'Finished').map(v => JSON.stringify(v) + '\n').join('');
    store.ingest(b.id, raw + appended, b.head, {});
    assert.deepEqual(store.treeGraph(b.id).nodes.map(n => n.count), [1, 5, 4, 2]);
    assert.equal(store.treeGraph(b.id).pendingCount, 2);
});
test('shared inferred prefix is Pending, counted once, and edits affect both paths', t => {
    const { store, native, roots, cwd } = fixture(t);
    for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(roots.codex, 'sessions', `${i}.jsonl`), codexSample(cwd, [...pairs(2), [`Direction ${i}`, `Answer ${i}`]]));
    native.refreshLocal(); const c = store.collections();
    assert.equal(c.items.length, 1); assert.equal(c.activeCounts.codex, 2); assert.equal(c.items[0].sessionIds.length, 2);
    let g = store.treeGraph(c.items[0].id); assert.equal(g.chatCount, 8); assert.equal(g.pendingCount, 8);
    assert.deepEqual(g.nodes.map(n => n.count), [4, 2, 2]);
    assert.equal(g.nodes[0].childIds.length, 2);
    const b = store.get('branch', g.paths[0].branchId);
    edit(store, b, [0, 1], 'combine', 'Setup context');
    g = store.treeGraph(b.id); assert.equal(g.nodes[0].name, 'Setup context'); assert.equal(g.nodes[0].branchIds.length, 2);
    assert.equal(g.paths[0].messages[0].id, g.paths[1].messages[0].id);
    assert.throws(() => edit(store, b, [3, 4], 'combine', 'Across fork'), /fork point/);
    assert.throws(() => edit(store, b, [0, 2], 'combine', 'Discontinuous'), /consecutive/);
});
test('stale edits fail and rewritten messages do not reuse unrelated annotations', t => {
    const { store, cwd } = fixture(t), b = store.branch(null, 'Main', 'codex', codexSample(cwd, pairs(3))), g = store.treeGraph(b.id);
    edit(store, b, [0], 'combine', 'Original');
    assert.throws(() => store.organize(b.id, { version: g.version, pathId: b.id, chatIds: [g.paths[0].messages[1].id], action: 'dissolve' }), /changed/);
    store.ingest(b.id, codexSample(cwd, [['Different', 'Entirely different']]), b.head, {});
    assert.equal(store.treeGraph(b.id).nodes[0].name, null);
});
test('native and project counts differ, query searches transcripts, groups sort by their most recent content', t => {
    const { store, native, cwd } = fixture(t), a = store.project('Chrono'), b = store.project('Other');
    const x = store.branch(a.id, 'First', 'codex', codexSample(cwd, [['unique needle', 'Ready']]));
    const y = store.fork(x.id, { name: 'Second', end: store.detail(x.id).checkpoints[0].end });
    const z = store.branch(b.id, 'Third', 'codex', codexSample(cwd, pairs(1)));
    for (const [s, time] of [[x, '2026-01-03'], [y, '2026-01-01'], [z, '2026-01-02']]) { store.put('branch', { ...s, contentUpdatedAt: time }); native.setActive(s.id, cwd, true); }
    assert.equal(store.collections().activeCounts.codex, 0, 'desired alone must not be Active');
    native.apply(); assert.equal(store.collections().activeCounts.codex, 3);
    assert.equal(store.listing('active:codex').items.length, 2);
    assert.equal(store.listing('active:codex').items[0].projectId, a.id);
    assert.equal(store.listing('active:codex', 'needle').items.length, 1);
    assert.equal(store.listing(a.id).itemCount, 1);
    fs.rmSync(store.instances().find(i => i.branchId === x.id).file); native.collect();
    assert.equal(store.collections().activeCounts.codex, 2);
});
test('move creates a nonempty project atomically and moves the entire family without changing activation', t => {
    const { store, cwd, native } = fixture(t), b = store.branch(null, 'Main', 'codex', codexSample(cwd, pairs(2)));
    const child = store.fork(b.id, { name: 'Child', end: store.detail(b.id).checkpoints[0].end });
    native.setActive(b.id, cwd, true); native.apply(); const before = store.instances();
    assert.throws(() => store.moveItems({ itemIds: [], projectName: 'Empty' }), /Select/); assert.equal(store.all('project').length, 0);
    assert.throws(() => store.moveItems({ itemIds: [b.id, 'missing'], projectName: 'Empty' })); assert.equal(store.all('project').length, 0);
    const moved = store.moveItems({ itemIds: [child.id], projectName: 'Chrono' });
    assert.ok(store.all('branch').every(v => v.projectId === moved.projectId)); assert.deepEqual(store.instances(), before);
});
test('native apply can target one session without accidentally applying another desired change', t => {
    const { store, cwd, native } = fixture(t), p = store.project('P');
    const a = store.branch(p.id, 'A', 'codex', codexSample(cwd, pairs(1))), b = store.branch(p.id, 'B', 'codex', codexSample(cwd, pairs(1)));
    native.setActive(a.id, cwd, true); native.setActive(b.id, cwd, true); native.apply([a.id]);
    assert.equal(store.instances().find(i => i.branchId === a.id).applied, true);
    assert.equal(store.instances().find(i => i.branchId === b.id).applied, false);
});
test('editable layouts synchronize with ancestry, preserve conflicts, and keep raw transcripts identical', t => {
    const { store: a, cwd } = fixture(t), { store: b } = fixture(t), p = a.project('Shared');
    const branch = a.branch(p.id, 'Main', 'codex', codexSample(cwd, pairs(3)));
    edit(a, branch, [0, 1, 2], 'combine', 'Stage one'); copy(a, b);
    assert.equal(b.treeGraph(branch.id).nodes[0].name, 'Stage one');
    edit(b, branch, [1], 'dissolve'); assert.equal(copy(b, a).conflicts, 0);
    assert.deepEqual(a.treeGraph(branch.id).nodes.map(n => n.count), [1, 1, 1, 3]);
    edit(a, branch, [1, 2], 'combine', 'Local'); edit(b, branch, [1, 2, 3], 'combine', 'Remote');
    assert.equal(copy(a, b).conflicts, 1); assert.equal(b.local('conflicts')[0].kind, 'layout');
    assert.ok(b.treeGraph(branch.id).nodes.some(n => n.name === 'Remote'));
    assert.equal(a.raw(a.get('branch', branch.id).head), b.raw(b.get('branch', branch.id).head));
});
test('native forks discovered after filing and organizing reuse the project tree and shared nodes', t => {
    const { store, native, roots, cwd } = fixture(t);
    const file = path.join(roots.codex, 'sessions', 'first.jsonl');
    fs.writeFileSync(file, codexSample(cwd, pairs(3))); native.refreshLocal();
    const original = store.all('branch')[0];
    edit(store, original, [0, 1], 'combine', 'Shared context');
    const projectId = store.moveItems({ itemIds: [original.id], projectName: 'Chrono' }).projectId;
    fs.writeFileSync(path.join(roots.codex, 'sessions', 'fork.jsonl'), codexSample(cwd, [...pairs(2), ['New direction', 'Explore']]));
    native.refreshLocal();
    const items = store.listing(projectId).items;
    assert.equal(items.length, 1); assert.equal(items[0].sessionIds.length, 2);
    const g = store.treeGraph(original.id);
    assert.equal(g.nodes[0].name, 'Shared context'); assert.equal(g.nodes[0].branchIds.length, 2);
    assert.equal(g.nodes.reduce((n, v) => n + v.count, 0), 8);
});
test('all Pending graph neighbors receive different automatic warm colors', t => {
    const { store, cwd } = fixture(t), b = store.branch(null, 'Main', 'codex', codexSample(cwd, pairs(4)));
    store.fork(b.id, { name: 'First', end: store.detail(b.id).checkpoints[0].end });
    store.fork(b.id, { name: 'Second', end: store.detail(b.id).checkpoints[2].end });
    const g = store.treeGraph(b.id);
    for (const e of g.edges) assert.notEqual(g.nodes.find(n => n.id === e.from).color, g.nodes.find(n => n.id === e.to).color);
});
test('divergent device continuations retain shared chat identities and remote suffix organization', t => {
    const { store: a, cwd } = fixture(t), { store: b } = fixture(t), p = a.project('Concurrent work');
    const branch = a.branch(p.id, 'Main', 'codex', codexSample(cwd, pairs(2)));
    copy(a, b);
    for (const [store, label] of [[a, 'Local direction'], [b, 'Remote direction']]) {
        store.ingest(branch.id, store.raw(branch.head) + codexTurn(label, 'Done').map(v => JSON.stringify(v) + '\n').join(''), branch.head, {});
        edit(store, branch, [4, 5], 'combine', label);
    }
    const remoteLayout = b.get('branch', branch.id).layoutHead;
    copy(b, a);
    const root = a.get('branch', branch.id);
    a.put('branch', { ...root, layoutHead: remoteLayout });
    const graph = a.treeGraph(branch.id);
    assert.equal(graph.paths.length, 2);
    assert.equal(graph.chatCount, 8);
    assert.ok(graph.nodes.some(n => n.name === 'Remote direction' && n.count === 2));
    assert.equal(graph.nodes[0].branchIds.length, 2);
});
test('node token estimates include recorded tool text without turning compaction into lost history', t => {
    const { store, cwd } = fixture(t);
    const raw = codexSample(cwd, [['Task', 'Ready']]) + [
        { type: 'compacted', payload: { message: 'Retain task goals.', replacement_history: [] } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read the report' }] } },
        { type: 'response_item', payload: { type: 'function_call', call_id: 'call-1', arguments: '{}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'x'.repeat(4000) } },
        { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Report read' }] } },
        { type: 'event_msg', payload: { type: 'task_complete' } }
    ].map(v => JSON.stringify(v) + '\n').join('');
    const b = store.branch(null, 'Compacted', 'codex', raw), g = store.treeGraph(b.id);
    assert.equal(g.chatCount, 4); assert.equal(g.nodes.length, 2); assert.equal(g.nodes[1].afterCompaction, true);
    assert.ok(g.nodes[1].tokens.recordedEstimate > 1000); assert.ok(g.nodes[1].tokens.estimate < 20);
    assert.equal(g.paths[0].context.compactions[0].summary, 'Retain task goals.');
});
test('in-use and archive projections keep complete prefixes but never expose the other paths', t => {
    const { store, cwd } = fixture(t), p = store.project('Paper');
    const root = store.branch(p.id, 'Main', 'codex', codexSample(cwd, pairs(3)));
    const child = store.fork(root.id, { name: 'Alternative', end: store.detail(root.id).checkpoints[0].end });
    store.ingest(child.id, store.raw(child.head) + codexTurn('Archived-only idea', 'Archived-only answer').map(v => JSON.stringify(v) + '\n').join(''), child.head, {});
    store.edit(child.id, { archived: true });
    const active = store.treeGraph(root.id, 'in-use'), archived = store.treeGraph(root.id, 'archived');
    assert.deepEqual(active.paths.map(p => p.branchId), [root.id]); assert.equal(active.chatCount, 6);
    assert.deepEqual(archived.paths.map(p => p.branchId), [child.id]); assert.equal(archived.chatCount, 4);
    assert.ok(!active.paths[0].messages.some(m => m.text.includes('Archived-only')));
    assert.ok(!archived.paths[0].messages.some(m => m.text.includes('Question 2')));
    assert.equal(active.nodes[0].id, archived.nodes[0].id);
    assert.equal(store.listing('archived').items[0].name, 'Alternative');
    assert.equal(store.listing(p.id).items[0].sessions.length, 1);
});
test('renaming Pending creates a real node, no-op rename stays clean, and archived nodes remain nameable', t => {
    const { store, cwd } = fixture(t), b = store.branch(null, 'Notes', 'codex', codexSample(cwd, pairs(2)));
    let g = store.treeGraph(b.id), options = { version: g.version, pathId: b.id, nodeId: g.nodes[0].id, action: 'rename', name: 'Set up context' };
    store.organize(b.id, options); g = store.treeGraph(b.id);
    assert.equal(g.pendingCount, 0); assert.equal(g.nodes[0].name, 'Set up context');
    const version = g.layoutHead; store.organize(b.id, { ...options, version: g.version }); assert.equal(store.treeGraph(b.id).layoutHead, version);
    assert.throws(() => edit(store, b, [0, 2], 'dissolve'), /consecutive/);
    store.edit(b.id, { archived: true }); g = store.treeGraph(b.id);
    store.organize(b.id, { ...options, version: g.version, name: 'Archived context' });
    assert.equal(store.treeGraph(b.id, 'archived').nodes[0].name, 'Archived context');
    assert.throws(() => edit(store, b, [0, 1], 'dissolve'), /Restore/);
});
test('immutable parsing and state caches invalidate on append and rollback; public state excludes native baselines', t => {
    const { store, native, cwd } = fixture(t), b = store.branch(null, 'Live', 'codex', codexSample(cwd, pairs(1)));
    native.setActive(b.id, cwd, true); native.apply();
    const before = store.snapshot(); assert.equal(before.instances[0].baseline, undefined);
    assert.equal(store.snapshot(), before);
    const raw = store.raw(b.head) + codexTurn('Next question', 'Next answer').map(v => JSON.stringify(v) + '\n').join('');
    store.ingest(b.id, raw, b.head, {}); assert.equal(store.treeGraph(b.id).chatCount, 4);
    const head = store.get('branch', b.id).head;
    assert.throws(() => store.transaction(() => { store.edit(b.id, { archived: true }); store.snapshot(); throw new Error('rollback'); }));
    assert.equal(store.get('branch', b.id).archived, false); assert.equal(store.get('branch', b.id).head, head);
});

test('native ancestry without a cutoff shares exact prose and preserves child annotations', t => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-native-prefix-')),store=new Store(root);
    t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
    const parent=store.branch(null,'Renamed parent','codex',codexSample('/work',[['Shared question','Shared answer'],['Parent suffix','Parent reply']]));
    const child=store.branch(null,'Different display name','codex',codexSample('/work',[['Shared question','Shared answer'],['Child suffix','Child reply']]));
    store.put('branch',{...child,parentId:parent.id,forkRevision:parent.head,forkEnd:0,forkParentEnd:0,nativeLinked:true,prefixUnavailable:true});
    const graph=store.treeGraph(parent.id),p=graph.paths.find(p=>p.branchId===parent.id),c=graph.paths.find(p=>p.branchId===child.id);
    assert.deepEqual(c.messages.slice(0,2).map(m=>m.id),p.messages.slice(0,2).map(m=>m.id));
    assert.notEqual(c.messages[2].id,p.messages[2].id);
    assert.equal(graph.nodes.filter(n=>n.branchIds.length===2).length,1);
});

test('native null/default serialization repairs a zero-length prefix without touching names or raw records',t=>{
    const {store}=fixture(t),raw=codexSample('/work',[['Shared','Answer'],['Parent tail','Done']]);
    const rows=raw.trim().split('\n').map(JSON.parse);rows.splice(2,0,{type:'response_item',payload:{type:'reasoning',summary:[],encrypted_content:'opaque'}});
    const parentRaw=rows.map(r=>JSON.stringify(r)+'\n').join(''),parent=store.branch(null,'Grove alias','codex',parentRaw);
    const childRaw=rows.map(r=>r.payload?.type==='reasoning'?{...r,payload:{...r.payload,content:null}}:r).map(r=>JSON.stringify(r)+'\n').join('');
    const child=store.branch(null,'Native title','codex',childRaw);store.put('branch',{...child,parentId:parent.id,forkRevision:parent.head,forkEnd:0,nativeLinked:true,prefixUnavailable:true});
    store.detectFamilies();assert.ok(store.get('branch',child.id).forkEnd>0);assert.equal(store.get('branch',child.id).prefixUnavailable,false);
    assert.equal(store.get('branch',parent.id).name,'Grove alias');assert.equal(store.raw(parent.head),parentRaw);assert.equal(store.raw(child.head),childRaw);
});
