import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {gunzipSync} from 'node:zlib';
import {packRecoveryCopies,recoveryPackingPlan} from '../src/recovery-storage.js';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-recovery-pack-')),directory=path.join(root,'recovery-snapshots');fs.mkdirSync(directory);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,directory};}
test('old recovery points remain byte-exact gzip archives and the newest stays uncompressed',async t=>{
 const {root,directory}=fixture(t),data=Buffer.from('Native database recovery data. '.repeat(10000)),old=path.join(directory,'old.sqlite'),latest=path.join(directory,'latest.sqlite');fs.writeFileSync(old,data);fs.utimesSync(old,1,1);fs.writeFileSync(latest,'Newest recovery point');
 const result=await packRecoveryCopies(root);assert.equal(result.files,1);assert.ok(result.savedBytes>0);assert.equal(fs.existsSync(old),false);assert.deepEqual(gunzipSync(fs.readFileSync(old+'.gz')),data);assert.equal(fs.readFileSync(latest,'utf8'),'Newest recovery point');assert.equal((await packRecoveryCopies(root)).files,0);
});
test('changed recovery files keep every original instead of committing an unsafe archive',async t=>{
 const {root,directory}=fixture(t),old=path.join(directory,'old.sqlite'),latest=path.join(directory,'latest.sqlite');fs.writeFileSync(old,'old '.repeat(1000));fs.utimesSync(old,1,1);fs.writeFileSync(latest,'newest');
 await assert.rejects(packRecoveryCopies(root,{onProgress:async p=>{if(p.phase==='Verifying recovery copies')fs.appendFileSync(old,'new bytes');}}),/changed/);assert.ok(fs.existsSync(old));assert.ok(fs.existsSync(latest));assert.ok(fs.existsSync(old+'.gz'));
});
test('active WAL companions, unknown existing archives and linked files are untouched',async t=>{
 const {root,directory}=fixture(t),old=path.join(directory,'old.sqlite'),latest=path.join(directory,'latest.sqlite'),active=path.join(directory,'active.sqlite');fs.writeFileSync(old,'original');fs.utimesSync(old,1,1);fs.writeFileSync(old+'.gz','not our archive');fs.writeFileSync(latest,'latest');fs.writeFileSync(active,'active');fs.writeFileSync(active+'-wal','pending WAL');const linked=path.join(directory,'linked.sqlite');fs.linkSync(old,linked);
 assert.equal(recoveryPackingPlan(root).length,0);fs.unlinkSync(linked);assert.equal(recoveryPackingPlan(root).length,1);const result=await packRecoveryCopies(root);assert.equal(result.skipped,1);assert.equal(fs.readFileSync(old,'utf8'),'original');assert.equal(fs.readFileSync(old+'.gz','utf8'),'not our archive');assert.ok(fs.existsSync(active));
});
test('a WAL created during packing keeps all original recovery databases',async t=>{
 const {directory,root}=fixture(t),old=path.join(directory,'old.sqlite'),latest=path.join(directory,'latest.sqlite');fs.writeFileSync(old,'snapshot '.repeat(1000));fs.utimesSync(old,1,1);fs.writeFileSync(latest,'latest');
 await assert.rejects(packRecoveryCopies(root,{onProgress:async p=>{if(p.phase==='Verifying recovery copies')fs.writeFileSync(old+'-wal','new database writes');}}),/active WAL/);
 assert.ok(fs.existsSync(old));assert.ok(fs.existsSync(latest));assert.equal(fs.readFileSync(old+'-wal','utf8'),'new database writes');
});
test('an archive replaced after packing cannot remove its original database',async t=>{
 const {directory,root}=fixture(t),old=path.join(directory,'old.sqlite'),latest=path.join(directory,'latest.sqlite');fs.writeFileSync(old,'snapshot '.repeat(1000));fs.utimesSync(old,1,1);fs.writeFileSync(latest,'latest');
 await assert.rejects(packRecoveryCopies(root,{onProgress:async p=>{if(p.phase==='Verifying recovery copies')fs.writeFileSync(old+'.gz','damaged archive');}}));
 assert.ok(fs.existsSync(old));assert.ok(fs.existsSync(latest));
});
