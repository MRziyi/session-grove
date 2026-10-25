import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {checkFileIdle} from '../src/trash-actions.js';
import {privateFile,writePrivateFile} from '../src/private-file.js';
import {coldGuard} from '../src/native.js';

test('Windows recovery rejects a held file and permits it after the handle closes',{skip:process.platform!=='win32'},()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-file-lock-')),file=path.join(root,'session.jsonl');fs.writeFileSync(file,'synthetic history');
    try{
        const handle=fs.openSync(file,'r');
        try{assert.throws(()=>checkFileIdle(file),error=>error.status===409);}finally{fs.closeSync(handle);}
        checkFileIdle(file);
        assert.equal(fs.readFileSync(file,'utf8'),'synthetic history');
        coldGuard(['not-a-native-agent']);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('private credential replacement preserves restricted access and new content',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-private-file-')),file=path.join(root,'key.json');
    try{writePrivateFile(file,'first');assert.ok(privateFile(file));writePrivateFile(file,'replacement');assert.ok(privateFile(file));assert.equal(fs.readFileSync(file,'utf8'),'replacement');assert.deepEqual(fs.readdirSync(root),['key.json']);}
    finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Windows private writes remove inherited grants and permission checks detect later ACL changes',{skip:process.platform!=='win32'},()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-private-acl-')),file=path.join(root,'key with spaces \u4e2d\u6587.json');
    const grant=(target,rule)=>execFileSync('icacls.exe',[target,'/grant','*S-1-1-0:'+rule],{stdio:'pipe',windowsHide:true});
    try{
        grant(root,'(OI)(CI)R');writePrivateFile(file,'synthetic key');assert.ok(privateFile(file));
        grant(file,'R');assert.equal(privateFile(file),false,'never cache a stale ACL verdict');
        writePrivateFile(file,'replacement');assert.ok(privateFile(file));assert.equal(fs.readFileSync(file,'utf8'),'replacement');
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
