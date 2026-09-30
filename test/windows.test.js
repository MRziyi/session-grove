import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {checkFileIdle} from '../src/trash-actions.js';
import {privateFile,writePrivateFile} from '../src/private-file.js';
import {coldGuard} from '../src/native.js';

test('Windows recovery rejects a held file and permits it after the handle closes',{skip:process.platform!=='win32'},async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-file-lock-')),file=path.join(root,'session.jsonl');fs.writeFileSync(file,'synthetic history');
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$f=[IO.File]::Open($env:GROVE_LOCK_TEST,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null; $f.Dispose()"],{env:{...process.env,GROVE_LOCK_TEST:file},windowsHide:true,stdio:['pipe','pipe','pipe']});
    const exited=once(child,'exit');
    try{
        const [output]=await once(child.stdout,'data');assert.match(String(output),/ready/);
        assert.throws(()=>checkFileIdle(file),error=>error.status===409);
        child.stdin.end('\n');await exited;checkFileIdle(file);
        assert.equal(fs.readFileSync(file,'utf8'),'synthetic history');
        coldGuard(['not-a-native-agent']);
    }finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}fs.rmSync(root,{recursive:true,force:true});}
});

test('private credential replacement preserves restricted access and new content',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-private-file-')),file=path.join(root,'key.json');
    try{writePrivateFile(file,'first');assert.ok(privateFile(file));writePrivateFile(file,'replacement');assert.ok(privateFile(file));assert.equal(fs.readFileSync(file,'utf8'),'replacement');assert.deepEqual(fs.readdirSync(root),['key.json']);}
    finally{fs.rmSync(root,{recursive:true,force:true});}
});
