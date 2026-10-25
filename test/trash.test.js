import {listenForTests} from '../scripts/test-server.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {once} from 'node:events';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {codexSample,claudeSample,codexTurn} from '../src/demo.js';
import {stageTrash,restoreTrash,expireTrash,cleanupLocal,isTrashed} from '../src/trash.js';import {savePreferences} from '../src/preferences.js';
async function setup(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'grove-local-test-'))),stores=[];t.after(()=>{stores.forEach(s=>s.close());fs.rmSync(root,{recursive:true,force:true});});return {root,device:name=>{const store=new Store(path.join(root,name));stores.push(store);return {store};}};}
test('whole-tree Trash keeps a local recovery copy only until its configurable expiry', async (t) => {
    const e = await setup(t),
        a = e.device('local');
    savePreferences(a.store, { trashRetentionDays: 7 });
    const b = a.store.branch(
        null,
        'Failed',
        'codex',
        codexSample(e.root, [['Discard me', 'Failed']]),
    );
    const entry = stageTrash(a.store, [b.id], [b.id]);
    cleanupLocal(a.store);
    assert.equal(a.store.collections().items.length, 0);
    assert.equal(a.store.exportGraph().branches.length, 0);
    assert.equal(a.store.db.prepare('SELECT count(*) n FROM objects').get().n, 0);
    assert.ok(fs.existsSync(path.join(a.store.root, 'trash', entry.id + '.json.gz')));
    expireTrash(a.store, Date.parse(entry.expiresAt) + 1);
    assert.ok(!fs.existsSync(path.join(a.store.root, 'trash', entry.id + '.json.gz')));
    assert.throws(() => restoreTrash(a.store, entry.id), /expired/);
});


test('failed native cleanup preserves a changed copy and successful cleanup removes only its target', async (t) => {
    const e = await setup(t),
        a = e.device('native');
    const { removeTrashNativeCopies } = await import('../src/trash-native.js');
    const b = a.store.branch(null, 'Discard', 'codex', codexSample(e.root, [['Discard', 'No']]));
    const roots = {
            codex: path.join(e.root, 'native-code'),
            claude: path.join(e.root, 'native-claude'),
        },
        native = new Native(a.store, { roots, guard: () => {} });
    native.setActive(b.id, e.root, true);
    native.apply([b.id]);
    const original = a.store.instances()[0],
        bytes = fs.readFileSync(original.file);
    stageTrash(a.store, [b.id], [b.id]);
    cleanupLocal(a.store);
    fs.appendFileSync(original.file, '\n');
    const blocked = removeTrashNativeCopies(a.store, native, [b.id]);
    assert.equal(blocked.removed, 0);
    assert.equal(blocked.blocked.length, 1);
    assert.ok(fs.existsSync(original.file));
    fs.writeFileSync(original.file, bytes);
    const result = removeTrashNativeCopies(a.store, native, [b.id]);
    assert.equal(result.removed, 1);
    assert.ok(!fs.existsSync(original.file));
    assert.equal(native.refreshLocal().discovered, 0);
});


test('finished native journals do not retain duplicate transcript snapshots; unfinished journals remain recoverable', async (t) => {
    const e = await setup(t),
        a = e.device('journals'),
        b = a.store.branch(null, 'Trash', 'codex', codexSample(e.root, [['Remove', 'Done']]));
    const folder = path.join(a.store.root, 'operations');
    fs.mkdirSync(folder);
    const name = '00000000-0000-4000-8000-000000000001.json',
        failed = '00000000-0000-4000-8000-000000000002.json';
    const data = {
        files: [
            {
                path: '/synthetic/session.jsonl',
                content: Buffer.from('transcript-secret').toString('base64'),
                afterHash: 'hash',
            },
        ],
        instancesBefore: [{ baseline: 'transcript-secret' }],
    };
    fs.writeFileSync(path.join(folder, name), JSON.stringify({ ...data, status: 'complete' }));
    fs.writeFileSync(path.join(folder, failed), JSON.stringify({ ...data, status: 'failed' }));
    stageTrash(a.store, [b.id], [b.id]);
    cleanupLocal(a.store);
    const done = JSON.parse(fs.readFileSync(path.join(folder, name)));
    assert.ok(done.backupsPruned);
    assert.equal(done.files[0].content, undefined);
    assert.equal(done.instancesBefore, undefined);
    assert.ok(JSON.parse(fs.readFileSync(path.join(folder, failed))).files[0].content);
});


test('shared logical labels remain intact when their parent path is discarded and a recovered path keeps its labels', async (t) => {
    const e = await setup(t),
        a = e.device('labels'),
        parent = a.store.branch(
            null,
            'Parent',
            'codex',
            codexSample(e.root, [
                ['Shared', 'Ready'],
                ['Bad suffix', 'Discard'],
            ]),
        );
    a.store.commitPending(parent.id, {
        name: 'Shared setup',
        revisionId: parent.head,
        expectedStart: 0,
        end: a.store.detail(parent.id).checkpoints[0].end,
    });
    const child = a.store.fork(parent.id, {
        name: 'Kept',
        end: a.store.detail(parent.id).checkpoints[0].end,
    });
    const before = a.store.treeGraph(parent.id);
    assert.ok(before.nodes.some((n) => n.name === 'Shared setup'));
    const entry = stageTrash(a.store, [parent.id]);
    cleanupLocal(a.store);
    assert.ok(a.store.treeGraph(child.id).nodes.some((n) => n.name === 'Shared setup'));
    const restored = restoreTrash(a.store, entry.id);
    assert.ok(
        a.store.treeGraph(restored.branchIds[0]).nodes.some((n) => n.name === 'Shared setup'),
    );
});


test('expired local recovery files are removed on service startup even if local updates are disabled', async t => {
    const e = await setup(t), a = e.device('expiry-startup');
    const b = a.store.branch(null, 'Expired', 'codex', codexSample(e.root, [['Expired', 'Discard']]));
    const entry = stageTrash(a.store, [b.id], [b.id]);
    a.store.local('trashEntries', [{ ...entry, expiresAt: new Date(Date.now() - 1000).toISOString() }]);
    savePreferences(a.store, { localUpdateEnabled: false });
    const { createApp } = await import('../src/server.js');
    const app = createApp({ root: a.store.root, roots: { codex: path.join(e.root, 'empty-codex'), claude: path.join(e.root, 'empty-claude') }, guard: () => {} });
    try{
        await listenForTests(app.server);
        assert.ok(!fs.existsSync(path.join(a.store.root, 'trash', entry.id + '.json.gz')));
        assert.ok(app.store.local('trashEntries')[0].expired);
    }finally{await new Promise(resolve=>app.close(resolve));}
});

test('opaque compaction context retains node labels through repeated recovery',async t=>{
 const e=await setup(t),{store}=e.device('opaque-recovery');
 const raw=codexSample(e.root,[['Before','Before answer']])+JSON.stringify({type:'compacted',payload:{message:'',replacement_history:[]}})+'\n'+codexTurn('After','After answer').map(r=>JSON.stringify(r)+'\n').join('');
 let branch=store.branch(null,'Opaque path','codex',raw),g=store.treeGraph(branch.id);
 assert.equal(g.paths[0].context.compactions[0].shareable,false);
 for(const [index,name]of [[0,'Before label'],[1,'After label']]){g=store.treeGraph(branch.id);store.organize(branch.id,{version:g.version,pathId:branch.id,nodeId:g.nodes[index].id,action:'rename',name});}
 const chats=store.treeGraph(branch.id).paths[0].messages.map(m=>m.id);
 for(let i=0;i<2;i++){const entry=stageTrash(store,[branch.id]),result=restoreTrash(store,entry.id);branch=store.get('branch',result.branchIds[0]);g=store.treeGraph(branch.id);assert.deepEqual(g.nodes.map(n=>n.name),['Before label','After label']);assert.deepEqual(g.paths[0].messages.map(m=>m.id),chats);}
});

test('legacy recovered compaction identities migrate without reviving dissolved labels',async t=>{
 const {hash}=await import('../src/util.js'),{gzipSync,gunzipSync}=await import('node:zlib');
 const e=await setup(t),{store}=e.device('legacy-opaque');
 const raw=codexSample(e.root,[['Before','Ready']])+JSON.stringify({type:'compacted',payload:{message:'',replacement_history:[]}})+'\n'+codexTurn('After','Result').map(r=>JSON.stringify(r)+'\n').join('');
 const original=store.branch(null,'Recovered once','codex',raw),branch=store.put('branch',{...original,chatIdentity:'original-chat-identity'}),g=store.treeGraph(branch.id),event=g.paths[0].context.compactions[0],assignments={};let prefix='';
 for(const m of g.paths[0].messages){prefix=hash(prefix+JSON.stringify([m.role,m.text]));if(m.line>event.line)assignments[branch.chatIdentity+':'+hash(prefix+hash(event.id+branch.id)).slice(0,24)]={id:'legacy-label',name:'Legacy after compact'};}
 const layout=store.put('layout',{id:'legacy-layout',rootId:branch.id,parent:null,createdAt:new Date().toISOString(),assignments});store.put('branch',{...branch,layoutHead:layout.id});
 assert.ok(store.treeGraph(branch.id).nodes.some(n=>n.name==='Legacy after compact'));
 const entry=stageTrash(store,[branch.id]),file=path.join(store.root,'trash',entry.id+'.json.gz'),backup=JSON.parse(gunzipSync(fs.readFileSync(file)));
 for(const layout of backup.graph.layouts)layout.assignments=assignments;
 fs.writeFileSync(file,gzipSync(Buffer.from(JSON.stringify(backup))));
 const restored=restoreTrash(store,entry.id),id=restored.branchIds[0];let graph=store.treeGraph(id);assert.ok(graph.nodes.some(n=>n.name==='Legacy after compact'),'old recovery backups retain legacy identity aliases');
 const node=graph.nodes.find(n=>n.name==='Legacy after compact');store.organize(id,{version:graph.version,pathId:id,chatIds:node.chatIds,action:'dissolve'});assert.ok(!store.treeGraph(id).nodes.some(n=>n.name==='Legacy after compact'));
 const second=restoreTrash(store,stageTrash(store,[id]).id);assert.ok(!store.treeGraph(second.branchIds[0]).nodes.some(n=>n.name==='Legacy after compact'),'an explicit Pending assignment wins over legacy labels');
});
