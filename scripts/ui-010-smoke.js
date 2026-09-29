import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { codexSample, claudeSample } from '../src/demo.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-ui010-')),objects=new Map();
const dav=http.createServer(async(req,res)=>{const key=req.url,chunks=[];for await(const c of req)chunks.push(c);if(req.method==='MKCOL'){res.writeHead(201);return res.end();}if(req.method==='PUT'){await new Promise(r=>setTimeout(r,8));if(req.headers['if-none-match']==='*'&&objects.has(key)){res.writeHead(412);return res.end();}objects.set(key,Buffer.concat(chunks));res.writeHead(201);return res.end();}if(req.method==='PROPFIND'){res.writeHead(207);return res.end('<d:multistatus xmlns:d="DAV:">'+[...objects.keys()].filter(k=>k.startsWith(key)&&!k.slice(key.length).includes('/')).map(k=>'<d:response><d:href>'+k+'</d:href></d:response>').join('')+'</d:multistatus>');}if(objects.has(key)){res.writeHead(200);return res.end(objects.get(key));}res.writeHead(404);res.end();});
dav.listen(0,'127.0.0.1');await once(dav,'listening');
fs.writeFileSync(path.join(root,'webdav.json'),JSON.stringify({url:'http://127.0.0.1:'+dav.address().port+'/dav',verified:true,encryptionReady:true,encrypted:false}),{mode:0o600});fs.writeFileSync(path.join(root,'sync-key.txt'),'\n',{mode:0o600});
const app=createApp({root,roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{},demo:true}),projects=[];
for(let i=0;i<20;i++){const p=app.store.project('Project '+String(i).padStart(2,'0'));projects.push(p);for(let j=0;j<7;j++){const agent=i===0&&j===0?'claude':'codex',raw=(agent==='claude'?claudeSample:codexSample)(root,Array.from({length:5},(_,k)=>[`Question ${i}/${j}/${k}`,'Answer '+k]));const b=app.store.branch(p.id,'Session '+j,agent,raw);app.store.put('branch',{...b,contentUpdatedAt:new Date(Date.now()-i*86400000-j*1000).toISOString()});}}
app.store.local('localUpdateStarted',false);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const base='http://127.0.0.1:'+app.server.address().port,debug=process.argv[2]||'http://127.0.0.1:9231';
const page=await(await fetch(debug+'/json/new?'+base,{method:'PUT'})).json(),ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let serial=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
async function wait(expression){for(let n=0;n<400;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression+' errors: '+errors.join(';'));}
try{
await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});await wait('document.querySelectorAll("[data-scope]").length>20');
await evaluate('localStorage.setItem("grove-language","zh")');await call('Page.reload');await wait('document.querySelectorAll("[data-scope]").length>20');
assert.equal(await evaluate('document.querySelector("#sync-menu-toggle")'),null);assert.equal(await evaluate('document.querySelector("#sync .button-label").textContent'),'同步');
await evaluate(`[...document.querySelectorAll('[data-scope]')].find(e=>e.dataset.scope===${JSON.stringify(projects[0].id)}).click()`);await wait('document.querySelectorAll("[data-project-group]").length===20');
assert.equal(await evaluate('document.querySelectorAll("[data-project-group]")[0].querySelectorAll(".session-row").length'),5);
await evaluate('document.querySelector("[data-expand-project]").click()');assert.equal(await evaluate('document.querySelectorAll("[data-project-group]")[0].querySelectorAll(".session-row").length'),7);
assert.equal(await evaluate('document.querySelector(".tool-tag.claude").textContent.trim()'),'Claude');
const fixed=await evaluate('[...document.querySelectorAll(".nav-group:not(.project-directory)")].map(e=>e.getBoundingClientRect().top)');await evaluate('document.querySelector(".project-directory-scroll").scrollTop=9999');assert.deepEqual(await evaluate('[...document.querySelectorAll(".nav-group:not(.project-directory)")].map(e=>e.getBoundingClientRect().top)'),fixed);
await evaluate('document.querySelectorAll("[data-project-group]")[8].scrollIntoView({block:"start"})');await wait(`document.querySelector('[data-scope="${projects[8].id}"]').classList.contains('selected')`);
await evaluate('document.querySelector("[data-open]").click()');await wait('document.querySelectorAll("[data-chat]").length>0');
await evaluate('document.querySelector("[data-chat]").click()');assert.equal(await evaluate('document.querySelectorAll("[data-chat]:checked").length'),1);await evaluate('document.querySelector("[data-chat]").click()');assert.equal(await evaluate('document.querySelectorAll("[data-chat]:checked").length'),0);
await evaluate('document.querySelector("#toggle-navigation").click();document.querySelector("#toggle-rail").click()');assert.ok(await evaluate('document.querySelector("#layout").classList.contains("nav-collapsed")&&document.querySelector("#layout").classList.contains("rail-collapsed")'));
const width=await evaluate('document.querySelector(".transcript-panel").getBoundingClientRect().width');await evaluate('document.querySelector("#ribbon-lane").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');assert.ok(await evaluate('document.querySelector(".transcript-panel").getBoundingClientRect().width')>width);
await evaluate('document.querySelector("#sync").click()');await wait('!document.querySelector("#sync-confirm").hidden');assert.ok(await evaluate('document.querySelector("#sync-detail").textContent.includes("Pull")&&document.querySelector("#sync-detail").textContent.includes("Push")'));
const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/ui010-sync.png',Buffer.from(shot.data,'base64'));
await evaluate('document.querySelector("#sync-confirm").click()');await wait('document.querySelector("#sync-detail").textContent.includes("Push")');await wait('document.querySelector("#sync-detail").textContent.includes("同步完成")');await evaluate('document.querySelector("#sync-cancel").click()');
assert.equal(app.autoSync.status().dirty,false);assert.deepEqual(errors,[]);console.log('UI 0.10 passed: unified sync/large confirmation/progress, 20 continuous project groups, five-row limits, scrollspy, pinned navigation, Claude tag, selection toggle, collapsible panes and resize.');
}finally{ws.close();await new Promise(r=>app.close(r));dav.close();await once(dav,'close');fs.rmSync(root,{recursive:true,force:true});}
