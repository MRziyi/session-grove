import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {codexSample,claudeSample,codexTurn} from '../src/demo.js';
import {stageTrash,restoreTrash,expireTrash,cleanupLocal,isTrashed} from '../src/trash.js';import {savePreferences} from '../src/preferences.js';
async function setup(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'grove-local-test-'))),stores=[];t.after(()=>{stores.forEach(s=>s.close());fs.rmSync(root,{recursive:true,force:true});});return {root,device:name=>{const store=new Store(path.join(root,name));stores.push(store);return {store};}};}
import {execFileSync} from 'node:child_process';
import {GitCloud} from '../src/git-cloud.js';import {AutoSync} from '../src/auto-sync.js';
test('failed cleanup requires manual retry and its reason survives checks and restart', async t => {
    const e = await syncFixture(t), a = e.device('cleanup-failure'), auto = new AutoSync(a.store, () => e.config);
    t.after(() => auto.close());
    await assert.rejects(auto.exclusive(async () => { auto.progress({ phase: 'Uploading records', completed: 12, total: 100 }); throw Object.assign(new Error('Test write lock expired'), { requiresReview: true }); }), /lock expired/);
    assert.equal(auto.status().needsReview.cleanup, true); assert.equal(auto.status().nextRunAt, null); assert.equal(auto.retryTimer, undefined);
    await auto.exclusive(async () => ({ checked: true }));
    assert.match(auto.status().error, /lock expired/);
    assert.equal(auto.status().lastFailure.progress.phase, 'Uploading records');
    const restarted = new AutoSync(a.store, () => e.config); t.after(() => restarted.close());
    assert.equal(restarted.status().needsReview.cleanup, true); assert.match(restarted.status().error, /lock expired/);
});

test('opening a cached local project does not wait behind an unrelated cloud transfer', async t => {
    const env = await syncFixture(t), a = env.device('a'), project = a.store.project('Local'), item = branch(a.store, project.id, 'Ready');
    const auto = new AutoSync(a.store, () => env.config); t.after(() => auto.close()); auto.unlock(env.pass);
    await auto.flush('both', true); let release;
    const busy = auto.exclusive(() => new Promise(resolve => { release = resolve; }));
    await new Promise(resolve => setImmediate(resolve)); let timer;
    try { await Promise.race([auto.openProject(project.id, '', { check: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Local project blocked on cloud')), 100); })]); }
    finally { clearTimeout(timer); release(); await busy; }
    assert.equal(a.store.listing(project.id).items[0].id, item.id);
});

test('cloud cache writes remain durable after a cached object is edited in place',async t=>{
    const e=await syncFixture(t),a=e.device('cache');a.store.local('cloud:test',{heads:{},ack:{}});const c=a.store.local('cloud:test');c.ack.example='updated';a.store.local('cloud:test',c);assert.equal(JSON.parse(a.store.db.prepare("SELECT body FROM local WHERE key='cloud:test'").get().body).ack.example,'updated');
    const before=a.store.cloudVersion;a.store.local('cloud:test',c);assert.equal(a.store.cloudVersion,before);
});


test('local changes start one stable countdown; disabled auto Push and empty schedules stay idle',async t=>{
 const e=await syncFixture(t),a=e.device('timer'),auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());auto.unlock(e.pass);
 auto.schedule([]);assert.equal(auto.status().nextRunAt,null);
 const b=branch(a.store,null,'New');auto.schedule([b.id]);const at=auto.status().nextRunAt;
 auto.schedule([b.id]);assert.equal(auto.status().nextRunAt,at);assert.equal(auto.timer,undefined);
 const {savePreferences}=await import('../src/preferences.js');savePreferences(a.store,{autoUploadEnabled:false});auto.configureTimer();auto.schedule([b.id]);
 assert.equal(auto.status().nextRunAt,null);auto.run=()=>assert.fail('Disabled upload must not start a transfer');await auto.flush('queued');
});


test('old implicit upload preferences do not opt into the new automatic pipeline', async t => {
 const {preferences}=await import('../src/preferences.js'),e=await syncFixture(t),a=e.device('opt-in');
 a.store.local('preferences',{autoUploadEnabled:true,autoUploadMinutes:1});assert.equal(preferences(a.store).autoUploadEnabled,false);
 savePreferences(a.store,{autoUploadEnabled:true});assert.equal(preferences(a.store).autoUploadEnabled,true);
 savePreferences(a.store,{autoUploadEnabled:false});assert.equal(preferences(a.store).autoUploadEnabled,false);
});

test('unavailable automatic upload timers skip all-library fingerprint work',async t=>{
 const e=await setup(t),a=e.device('lazy-timer'),auto=new AutoSync(a.store,()=>({url:'git@example.invalid:test/data.git'}));t.after(()=>auto.close());
 auto.cloud.dirtyIds=()=>assert.fail('An unavailable timer must not scan sync graphs');auto.reconcileTimer();
 savePreferences(a.store,{autoUploadEnabled:true});auto.running=true;auto.reconcileTimer();auto.running=false;auto.unlocked=false;auto.reconcileTimer();
 auto.unlocked=true;auto.reconcileTimer(true);assert.ok(auto.interval);auto.reconcileTimer(false);assert.equal(auto.interval,null);
});


test('backend project directory and content listing agree through archive and restore',async t=>{
 const e=await syncFixture(t),a=e.device('directory');const p=a.store.project('Project'),empty=a.store.project('Empty');const b=branch(a.store,p.id,'Session');
 const check=()=>{const data=a.cloud.decorate(a.store.snapshot());for(const p of data.projectDirectory){const list=a.cloud.listing(p.id);assert.equal(p.itemCount,list.itemCount);assert.equal(p.sessionCount,list.sessionCount);}return data;};
 assert.equal(check().projectDirectory.some(p=>p.id===empty.id),false);assert.equal(check().projectDirectory.find(v=>v.id===p.id).itemCount,1);
 a.store.edit(b.id,{archived:true});assert.equal(check().projectDirectory.some(v=>v.id===p.id),false);assert.equal(check().projectAvailability.find(v=>v.id===p.id).state,'filtered');
 a.store.edit(b.id,{archived:false});assert.equal(check().projectDirectory.find(v=>v.id===p.id).itemCount,1);
});

async function syncFixture(t){
 const e=await setup(t),url=path.join(e.root,'remote.git');
 execFileSync('git',['init','--bare','-b','main',url],{stdio:'pipe',windowsHide:true});
 fs.appendFileSync(path.join(url,'config'),'\n[receive]\n\tautoGC = false\n');
 const config={url,allowLocal:true};
 return {...e,config,pass:'',device:name=>{const d=e.device(name);return {...d,cloud:new GitCloud(d.store,()=>config)};}};
}
function branch(store,projectId,title){return store.branch(projectId,title,'codex',codexSample('/work',[[title,'Ready']]));}
