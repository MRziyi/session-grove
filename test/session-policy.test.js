import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { parse } from '../src/transcript.js';
import { codexSample, codexTurn } from '../src/demo.js';
import { hash } from '../src/util.js';
import { activationInfo } from '../src/activation.js';
function setup(t) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-policy-'))), store = new Store(path.join(root, 'library'));
    const roots = { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') }, cwd = path.join(root, 'work');
    fs.mkdirSync(cwd); fs.mkdirSync(path.join(roots.codex, 'sessions'), { recursive: true });
    const native = new Native(store, { roots, guard: () => {} });
    t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); }); return { root, store, native, roots, cwd };
}
const lines = values => values.map(v => JSON.stringify(v) + '\n').join('');
test('primary display name wins; guardians and empty logs are excluded by metadata and previous imports become unmanaged', t => {
    const { store, native, roots, cwd } = setup(t), data = [];
    for (const [label, source, pairs] of [['normal', 'vscode', [['Question', 'Answer']]], ['guardian', { subagent: { other: 'guardian' } }, [['The following is the Codex agent history', 'Internal analysis']]], ['empty', 'vscode', []]]) {
        let raw = codexSample(cwd, pairs), rows = raw.trim().split('\n').map(JSON.parse); rows[0].payload.source = source; raw = lines(rows);
        const id = parse(raw, 'codex').nativeId, file = path.join(roots.codex, 'sessions', label + '.jsonl'); fs.writeFileSync(file, raw); data.push({ id, file, raw, source, label });
    }
    const old = store.branch(null, 'Old imported guardian', 'codex', data[1].raw);
    store.local('instances', [{ id: 'old-instance', branchId: old.id, agent: 'codex', root: roots.codex, file: data[1].file, nativeId: data[1].id, cwd, desired: true, applied: true, adopted: true, baseline: null, baseRevision: old.head, observedHash: hash(data[1].raw), title: old.name }]);
    const db = new DatabaseSync(path.join(roots.codex, 'state_5.sqlite'));
    db.exec('CREATE TABLE threads (id TEXT,title TEXT,name TEXT,source TEXT,archived INTEGER,rollout_path TEXT,cwd TEXT)');
    for (const d of data) db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?)').run(d.id, 'Internal preview '.repeat(100), d.label === 'normal' ? 'My named conversation' : null, typeof d.source === 'string' ? d.source : JSON.stringify(d.source), 0, d.file, cwd);
    db.close(); const result = native.refreshLocal();
    assert.equal(result.discovered, 1); assert.equal(store.collections().activeCounts.codex, 1);
    assert.equal(store.listing('active:codex').items[0].name, 'My named conversation');
    assert.equal(store.get('branch', old.id).excluded, 'agent-owned'); assert.equal(native.plan().operations.length, 0);
    assert.equal(store.snapshot().branches.some(b => b.id === old.id), false);
    assert.equal(fs.readFileSync(data[1].file, 'utf8'), data[1].raw);
});
function compacted(cwd) {
    const values = codexSample(cwd, [['Original context marker', 'Original answer']]).trim().split('\n').map(JSON.parse);
    values[0].payload.history_mode = 'paginated';
    return lines([...values, { type: 'world_state', payload: { full: true, state: { permissions: { source: 'must-not-replay' } } } }, { type: 'compacted', payload: { message: 'Readable summary marker', replacement_history: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Readable summary marker' }] }] } }, ...codexTurn('Post compact question', 'Post compact answer')]);
}
test('compaction preview is per path; cold apply rebuilds a native copy, preserving original history and capturing new suffixes', t => {
    const { store, native, roots, cwd } = setup(t), raw = compacted(cwd), file = path.join(roots.codex, 'sessions', 'original.jsonl'); fs.writeFileSync(file, raw); native.refreshLocal();
    const b = store.all('branch').find(b => !b.synthetic), graph = store.treeGraph(b.id), event = graph.paths[0].context.compactions[0];
    const sibling = store.fork(b.id, { name: 'Other path', end: store.detail(b.id).checkpoints.at(-1).end });
    store.setCompaction(b.id, { eventId: event.id, enabled: false, head: b.head });
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    let g = store.treeGraph(b.id); assert.equal(g.paths.find(p => p.branchId === b.id).context.compactions[0].enabled, false); assert.equal(g.paths.find(p => p.branchId === sibling.id).context.compactions[0].enabled, true);
    assert.equal(g.paths.find(p => p.branchId === b.id).contextPending, true);
    assert.equal(activationInfo(store, native, b.id, cwd, {}).basis, 'expanded-history-estimate');
    native.setActive(b.id, cwd, true); native.apply([b.id]);
    const live = store.instances().find(i => i.branchId === b.id && i.applied), parked = store.instances().find(i => i.branchId === b.id && !i.applied);
    assert.ok(live && parked); assert.equal(fs.readFileSync(parked.file, 'utf8'), raw);
    let p = parse(fs.readFileSync(live.file, 'utf8'), 'codex'); assert.equal(p.meta.history_mode, 'legacy'); assert.equal(p.context.compactions.length, 0); assert.ok(p.messages.some(m => m.text === 'Original context marker'));
    assert.ok(!p.records.some(r => r.value?.type === 'world_state')); assert.equal(store.raw(store.get('branch', b.id).head), raw);
    fs.appendFileSync(live.file, lines(codexTurn('Continued in expanded context', 'Complete'))); native.collect();
    const current = store.get('branch', b.id); assert.ok(store.raw(current.head).includes('Continued in expanded context')); assert.equal(store.treeGraph(b.id).paths.find(p => p.branchId === b.id).contextPending, false);
    store.setCompaction(b.id, { eventId: event.id, enabled: true, head: current.head }); native.setActive(b.id, cwd, true); native.apply([b.id]);
    const now = store.instances().find(i => i.branchId === b.id && i.applied); p = parse(fs.readFileSync(now.file, 'utf8'), 'codex');
    assert.equal(p.context.compactions.length, 1); assert.equal(p.context.compactions[0].summary, 'Readable summary marker'); assert.equal(p.messages.length, 6);
});
test('context policies synchronize through metadata ancestry and reject stale choices', t => {
    const a = setup(t), b = setup(t), project = a.store.project('Project'), session = a.store.branch(project.id, 'Main', 'codex', compacted(a.cwd));
    const copy = () => b.store.merge(a.store.exportGraph(), Object.fromEntries(a.store.db.prepare('SELECT * FROM objects').all().map(r => [r.hash, r.body])));
    copy(); const event = a.store.detail(session.id).checkpoints;
    const e = a.store.treeGraph(session.id).paths[0].context.compactions[0];
    a.store.setCompaction(session.id, { eventId: e.id, head: session.head, enabled: false }); copy();
    assert.deepEqual(b.store.get('branch', session.id).contextPolicy.disabled, [e.id]);
    assert.throws(() => a.store.setCompaction(session.id, { eventId: e.id, head: 'stale', enabled: true }), /changed/);
});
