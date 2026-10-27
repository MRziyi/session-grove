import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {DatabaseSync,backup} from 'node:sqlite';import {gunzipSync} from 'node:zlib';
import {Store} from '../src/store.js';import {codexSample} from '../src/demo.js';import {storageUsage,storageCleanupPlan,validateCleanupPlan,storageUpgrade} from '../src/storage-usage.js';import {optimizeStorage} from '../src/storage-maintenance.js';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-storage-usage-')),s=new Store(root);t.after(()=>{s.close();fs.rmSync(root,{recursive:true,force:true});});return s;}
function file(s,name,body){const p=path.join(s.root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);return p;}
test('usage measures local files by purpose without following links or changing the library',async t=>{
 const s=fixture(t);file(s,'git-cache/check/blob','git');file(s,'transfer-cache/old','temporary');file(s,'trash/keep','trash');file(s,'logs/log','log');const changes=s.db.prepare('SELECT total_changes() n').get().n;
 const usage=await storageUsage(s);assert.equal(usage.categories.git,3);assert.equal(usage.categories.temporary,9);assert.equal(usage.categories.trash,5);assert.ok(usage.categories.database>0);assert.equal(usage.totalBytes,Object.values(usage.categories).reduce((a,b)=>a+b));assert.equal(s.db.prepare('SELECT total_changes() n').get().n,changes);
 if(process.platform!=='win32'){fs.symlinkSync(path.join(s.root,'trash'),path.join(s.root,'git-cache/link'));assert.equal((await storageUsage(s)).categories.git,3);}
});
test('upgrade detection distinguishes legacy large revisions from fresh packed writes',t=>{
 const s=fixture(t),b=s.branch(null,'Large','codex',codexSample('/fixture',Array.from({length:200},(_,i)=>['Q'+i,'A'+i])));assert.equal(storageUpgrade(s),false);
 const r=s.get('revision',b.head);s.db.prepare('UPDATE entities SET body=? WHERE id=?').run(JSON.stringify(r),r.id);delete s.storageUpgradeCandidate;assert.equal(storageUpgrade(s),true);s.local('storage-encoding',{schema:1});assert.equal(storageUpgrade(s),false);
});
test('legacy libraries with a short reference vector and a large native record also receive the upgrade action',t=>{
 const s=fixture(t),b=s.branch(null,'Attachment','codex',codexSample('/fixture',[['Question','Reply '.repeat(5000)]]));assert.ok(s.get('revision',b.head).refs.length<32);
 for(const row of s.db.prepare('SELECT hash FROM objects').all()){const raw=s.objectStatement.get(row.hash).body;s.db.prepare('UPDATE objects SET body=? WHERE hash=?').run(raw,row.hash);}
 assert.equal(storageUpgrade(s),true);
});
test('temporary cleanup requires the reviewed version and preserves all authoritative data',async t=>{
 const s=fixture(t),b=s.branch(null,'Keep','codex',codexSample('/fixture',[['Question','Answer']])),raw=s.raw(b.head);file(s,'transfer-cache/old','unused bytes');file(s,'git-cache/keep','offline history');file(s,'trash/keep','recovery');const plan=await storageCleanupPlan(s.root);
 file(s,'transfer-cache/new','changed');await assert.rejects(optimizeStorage(s,{action:'cleanup',version:plan.version}),/Review cleanup again/);assert.ok(fs.existsSync(path.join(s.root,'transfer-cache/old')));
 const current=await storageCleanupPlan(s.root),result=await optimizeStorage(s,{action:'cleanup',version:current.version});assert.equal(result.savedBytes,19);assert.equal(result.backupFile,null);assert.equal(s.raw(b.head),raw);assert.equal(fs.readFileSync(path.join(s.root,'git-cache/keep'),'utf8'),'offline history');assert.ok(fs.existsSync(path.join(s.root,'trash/keep')));assert.equal((await storageUsage(s)).cleanup.bytes,0);
});
test('backup cleanup retains the newest old point and creates an independently verified current point',async t=>{
 const s=fixture(t),b=s.branch(null,'Keep','codex',codexSample('/fixture',[['Question','Answer']]));const paths=[];
 for(let i=0;i<3;i++){const p=path.join(s.root,'preflight-backups','point-'+i,'grove.sqlite');fs.mkdirSync(path.dirname(p),{recursive:true});await backup(s.db,p);fs.utimesSync(p,i+1,i+1);fs.utimesSync(path.dirname(p),i+1,i+1);paths.push(p);}
 const plan=await storageCleanupPlan(s.root);assert.equal(plan.backupCount,2);const result=await optimizeStorage(s,{action:'cleanup',version:plan.version});assert.equal(result.removedBackups,2);assert.ok(!fs.existsSync(paths[0])&&!fs.existsSync(paths[1])&&fs.existsSync(paths[2]));assert.equal(result.recoveryCopyVerified,true);
 const restored=path.join(s.root,'verified.sqlite');fs.writeFileSync(restored,gunzipSync(fs.readFileSync(result.backupFile)));const copy=new DatabaseSync(restored,{readOnly:true});assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.ok(copy.prepare('SELECT 1 FROM entities WHERE id=?').get(b.id));copy.close();assert.equal((await storageCleanupPlan(s.root)).backupCount,0);
});
test('active WAL backups, unknown folders and linked caches are excluded; changed reviewed trees stop deletion',async t=>{
 const s=fixture(t);for(let i=0;i<4;i++){const p=path.join(s.root,'preflight-backups','point-'+i,'grove.sqlite');fs.mkdirSync(path.dirname(p),{recursive:true});await backup(s.db,p);file(s,'preflight-backups/point-'+i+'/grove.sqlite-wal','active');}
 file(s,'preflight-backups/unknown/notes','keep');file(s,'transfer-cache/old','old');let plan=await storageCleanupPlan(s.root);assert.equal(plan.backupCount,0);file(s,'transfer-cache/new','new');assert.throws(()=>validateCleanupPlan(s.root,plan),/Review cleanup again/);
 if(process.platform!=='win32'){fs.rmSync(path.join(s.root,'transfer-cache'),{recursive:true});fs.symlinkSync(path.join(s.root,'preflight-backups'),path.join(s.root,'transfer-cache'));plan=await storageCleanupPlan(s.root);assert.equal(plan.bytes,0);}
});
