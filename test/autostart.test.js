import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {once} from 'node:events';
import {Autostart,windowsArgument} from '../src/autostart.js';import {createApp} from '../src/server.js';
function fixture(t,options={}){const home=fs.mkdtempSync(path.join(os.tmpdir(),'grove-autostart-')),root=path.join(home,'.session-grove'),entry=path.join(home,'Code & projects','bin','session-grove.js'),directory=path.join(home,'Startup');fs.mkdirSync(path.dirname(entry),{recursive:true});fs.writeFileSync(entry,'// fixture');const calls=[],run=async(command,args,extra)=>{calls.push({command,args,extra});return{stdout:'disabled services = {}'};};const manager=new Autostart({root,roots:{codex:path.join(home,'.codex'),claude:path.join(home,'.claude')},home,directory,platform:'darwin',entry,port:()=>8437,uid:()=>501,run,...options});t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return{manager,home,root,directory,calls,entry};}
test('macOS toggle persists current paths/port and never stops or bootstraps the live service',async t=>{
 const {manager:m,calls}=fixture(t);assert.equal((await m.status()).enabled,false);assert.equal((await m.set(true)).enabled,true);const text=fs.readFileSync(m.file,'utf8');assert.match(text,/Code &amp; projects/);assert.match(text,/<string>8437<\/string>/);assert.match(text,/<key>KeepAlive<\/key><false\/>/);assert.ok(!text.includes('--background'));assert.ok(text.includes('--codex-home')&&text.includes('--claude-home')&&text.includes('--data-dir'));
 if(process.platform==='darwin')execFileSync('/usr/bin/plutil',['-lint',m.file]);assert.equal((await m.set(false)).enabled,false);assert.ok(!fs.existsSync(m.file));assert.ok(calls.every(c=>['enable','print-disabled'].includes(c.args[0])));
});
test('failed macOS enable restores the previous file; first-time failure leaves no startup entry',async t=>{
 const {manager:m}=fixture(t);await m.set(true);const previous=fs.readFileSync(m.file);m.run=async()=>{throw Error('denied');};await assert.rejects(m.set(true),/previous setting was kept/);assert.deepEqual(fs.readFileSync(m.file),previous);await m.set(false);await assert.rejects(m.set(true),/previous setting was kept/);assert.ok(!fs.existsSync(m.file));
});
test('unrelated startup entries and symbolic links are never overwritten',async t=>{
 const {manager:m,directory,home}=fixture(t);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(m.file,'<plist><dict><key>GroveLibrary</key><string>/another/library</string></dict></plist>');const before=fs.readFileSync(m.file);assert.equal((await m.status()).managed,false);await assert.rejects(m.set(false),/another installation/);await assert.rejects(m.set(true),/another installation/);assert.deepEqual(fs.readFileSync(m.file),before);
 if(process.platform!=='win32'){fs.unlinkSync(m.file);const target=path.join(home,'unrelated');fs.writeFileSync(target,'keep');fs.symlinkSync(target,m.file);await assert.rejects(m.set(true),/regular file/);assert.equal(fs.readFileSync(target,'utf8'),'keep');}
});
test('unsupported platforms and demo mode leave startup settings untouched',async t=>{
 for(const options of [{platform:'linux'},{demo:true}]){const {manager:m,directory}=fixture(t,options);assert.equal((await m.status()).supported,false);await assert.rejects(m.set(true),/unavailable/);assert.ok(!fs.existsSync(directory));}
});
test('Windows shortcut creation uses literal arguments and stages outside the Startup folder',async t=>{
 let saved;const {manager:m,directory,entry}=fixture(t,{platform:'win32',run:async(_command,_args,{env})=>{const c=JSON.parse(env.GROVE_STARTUP_CONFIG);if(c.target){saved=c;fs.writeFileSync(c.file,'shortcut bytes');return {stdout:''};}return {stdout:JSON.stringify({description:saved.description,target:saved.target,arguments:saved.arguments})};}});
 assert.equal((await m.set(true)).enabled,true);assert.ok(!saved.file.startsWith(directory+path.sep));assert.ok(saved.arguments.includes(windowsArgument(entry)));assert.ok(saved.arguments.endsWith('"--background"'));assert.equal(fs.readFileSync(m.file,'utf8'),'shortcut bytes');assert.ok(!fs.existsSync(saved.file));assert.equal((await m.set(false)).enabled,false);
 assert.equal(windowsArgument('C:\\folder with spaces\\'),'"C:\\folder with spaces\\\\"');
});
test('Windows verification failure restores the previous shortcut or leaves startup disabled',async t=>{
 let saved,failRead=false;const {manager:m}=fixture(t,{platform:'win32',run:async(_command,_args,{env})=>{const c=JSON.parse(env.GROVE_STARTUP_CONFIG);if(c.target){saved=c;fs.writeFileSync(c.file,'new shortcut');return {stdout:''};}if(failRead)throw Error('Read failed');return {stdout:JSON.stringify({description:saved.description})};}});
 failRead=true;await assert.rejects(m.set(true),/Could not read/);assert.equal(fs.existsSync(m.file),false);
 failRead=false;await m.set(true);fs.writeFileSync(m.file,'previous shortcut');const run=m.run;m.run=async(...args)=>{const c=JSON.parse(args[2].env.GROVE_STARTUP_CONFIG);if(c.target){const result=await run(...args);failRead=true;return result;}return run(...args);};await assert.rejects(m.set(true),/Could not read/);assert.equal(fs.readFileSync(m.file,'utf8'),'previous shortcut');
});
test('Windows PowerShell receives an encoded script and closed stdin',async t=>{
 let ended=false;const {manager:m}=fixture(t,{platform:'win32',run:(_cmd,args)=>{assert.equal(args[2],'-EncodedCommand');assert.equal(Buffer.from(args[3],'base64').toString('utf16le'),'Write-Output test');const pending=Promise.resolve({stdout:'test'});pending.child={stdin:{end(){ended=true;}}};return pending;}});await m.shortcut('Write-Output test',{});assert.equal(ended,true);
});
test('Windows native shortcut roundtrip uses the current user without creating an actual login item',{skip:process.platform!=='win32'},async t=>{
 const {manager:m}=fixture(t,{platform:'win32',run:undefined});let stage='enable';
 try{assert.equal((await m.set(true)).enabled,true);stage='status';assert.equal((await m.status()).enabled,true);stage='disable';assert.equal((await m.set(false)).enabled,false);}
 catch(error){const detail=String(error.stderr||error.message),code=/^[A-Z_0-9]+$/.test(String(error.code))?error.code:'none',category=/Could not read login startup/.test(detail)?'read-status':/another installation/.test(detail)?'ownership':/could not be verified/.test(detail)?'verify':/Command failed/.test(detail)?'powershell':/shortcut could not be created/.test(detail)?'missing-shortcut':'other',qualified=/FullyQualifiedErrorId\s*:\s*([A-Za-z0-9_.]+)/.exec(detail)?.[1]||'none';console.error(`::error file=test/autostart.test.js,title=Native shortcut diagnostic::stage=${stage}; category=${category}; code=${code}; killed=${!!error.killed}; qualified=${qualified}`);throw error;}
});
test('custom libraries use separate startup entries and simultaneous saves are rejected',async t=>{
 const {manager:m,home}=fixture(t);const other=new Autostart({root:path.join(home,'other'),roots:m.roots,home,platform:'darwin'});assert.notEqual(m.label,other.label);
 let release;m.run=async(_cmd,args)=>{if(args[0]==='enable')await new Promise(r=>release=r);return {stdout:'{}'};};const first=m.set(true);await new Promise(r=>setImmediate(r));assert.ok(m.pending);await assert.rejects(m.set(false),/already changing/);release();await first;assert.equal(m.pending,null);
});
test('authenticated startup API changes future login settings while the HTTP service stays alive',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'grove-startup-api-')),directory=path.join(home,'Startup'),app=createApp({root:path.join(home,'library'),roots:{codex:path.join(home,'codex'),claude:path.join(home,'claude')},guard:()=>{},startupOptions:{platform:'darwin',home,directory,uid:()=>501,run:async()=>({stdout:'{}'})}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(home,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,headers={'Content-Type':'application/json','X-Grove-Token':app.token};
 assert.equal((await fetch(base+'/api/settings/autostart',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"enabled":true}'})).status,403);
 for(const enabled of [true,false]){const r=await fetch(base+'/api/settings/autostart',{method:'POST',headers,body:JSON.stringify({enabled})});assert.equal(r.status,200);assert.equal((await r.json()).enabled,enabled);assert.equal((await fetch(base+'/api/service')).status,200);}
});
