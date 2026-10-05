// Synthetic conflict review UI; no credentials, native user files or real remotes.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';import {codexSample} from '../src/demo.js';import {metadata} from '../src/organization.js';import {browserBinary,browserPort,closeBrowser} from './browser-runtime.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-conflict-browser-')),app=createApp({root:path.join(root,'data'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}}),s=app.store;
const project=s.project('Current project'),b=s.branch(project.id,'Current local title','codex',codexSample(root,[['Question','Answer']])),previous=metadata(b,{name:'Previous synced title'}),remoteProject=metadata(project,{name:'Previous project'});
s.local('conflicts',[{kind:'branch',local:b,remote:previous},{kind:'project',local:project,remote:remoteProject}]);
app.autoSync.readConfig=()=>({url:'https://example.invalid/conflict-fixture'});app.autoSync.lastManualOperation=app.autoSync.lastFailure=app.autoSync.operation={id:'conflict-fixture',state:'error',error:'Resolve sync conflicts before uploading.',direction:'push',finishedAt:Date.now()};app.autoSync.needsReview={retry:true};
const eventsConnected=Promise.withResolvers();app.server.on('request',req=>{if(req.url==='/api/events')eventsConnected.resolve();});
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const chrome=spawn(browserBinary(),['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(root,'chrome'),'about:blank'],{stdio:'ignore',windowsHide:true});let ws;
try{
 const port=await browserPort(chrome,path.join(root,'chrome')),page=await fetch('http://127.0.0.1:'+port+'/json/new?http://127.0.0.1:'+app.server.address().port,{method:'PUT'}).then(r=>r.json());ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let serial=0;const requests=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=requests.get(m.id);requests.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;requests.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression);};
 await call('Runtime.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});
 await eventsConnected.promise;app.autoSync.onOperation(app.autoSync.operation);
 await wait('!document.querySelector("#sync-error").hidden');await evaluate('document.querySelector("#sync-error summary").click()');await wait('document.querySelectorAll("[data-conflict-select]").length===2');
 assert.ok(await evaluate('document.querySelector("#pending-uploads").textContent.includes("Previous synced title")&&document.querySelector("#pending-uploads").textContent.includes("Current local title")'));
 await evaluate('document.querySelector("[data-conflict-select]").click()');assert.equal(await evaluate('document.querySelector("#keep-previous").hidden'),false);assert.equal(await evaluate('document.querySelector("#keep-current").hidden'),false);
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/conflicts-desktop.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await new Promise(r=>setTimeout(r,100));
 assert.ok(await evaluate('(()=>{const e=document.querySelector("#pending-uploads"),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1})()'),'conflict choices fit a narrow viewport');
 fs.writeFileSync('test-results/conflicts-mobile.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});
 // A changed local version must be reviewed again before replacing it.
 s.edit(b.id,{name:'New edit after selection'});await evaluate('document.querySelector("#keep-previous").click()');await wait('document.querySelector("[data-conflict-status]")?.textContent.includes("Conflicts changed")');assert.equal(s.local('conflicts').length,2);assert.equal(s.get('branch',b.id).name,'New edit after selection');
 await evaluate('document.querySelector("#sync-error summary").click()');await wait('document.querySelector("#pending-uploads").textContent.includes("New edit after selection")');assert.equal(await evaluate('document.querySelectorAll("[data-conflict-select]:checked").length'),0);
 await evaluate('document.querySelector("[data-conflict-select]").click();document.querySelector("#keep-previous").click()');await wait('document.querySelectorAll("[data-conflict-select]").length===1');assert.equal(s.get('branch',b.id).name,'Previous synced title');
 await evaluate('document.querySelector("#conflict-select-all").click();document.querySelector("#keep-current").click()');await wait('document.querySelector("#sync-error").hidden');assert.equal(s.local('conflicts').length,0);assert.equal(s.get('project',project.id).name,'Current project');
 assert.equal(await evaluate('document.querySelector("#pending-uploads").dataset.mode'),'pending');assert.deepEqual(errors,[]);
 console.log('Browser passed: affected items, previous/current differences, selection, both choices, stale review, mobile fit, and return to pending uploads.');
}finally{await closeBrowser(chrome,ws);await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
