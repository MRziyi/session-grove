// Synthetic white-box sync UI regression. No real cloud or native sessions are touched.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';import {codexSample} from '../src/demo.js';import {treeSnapshot} from '../src/cloud.js';import {hash} from '../src/util.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-sync-browser-')),app=createApp({root:path.join(root,'app'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
const b=app.store.branch(null,'Active local session','codex',codexSample(root,[['Context','Ready']])),queued=app.store.branch(null,'Waiting upload','codex',codexSample(root,[['Other context','Other answer']]));app.native.setActive(b.id,root,true);app.native.apply([b.id]);
app.autoSync.readConfig=()=>({url:'https://example.invalid/isolated-test'});app.autoSync.unlock('isolated-browser-key');
const pull=Promise.withResolvers(),push=Promise.withResolvers();let failPull=false;
app.autoSync.run=async(store,config,key,direction,ids)=>{
 const metrics=app.autoSync.cloud.metrics;metrics.requests+=3;metrics.bytesReceived+=4096;
 if(direction==='pull'){app.autoSync.operation.stageProgress={completed:4,total:10};app.autoSync.progress({phase:'Downloading records',completed:4,total:10,detail:'Cloud session A'});if(failPull)throw Error('Synthetic provider failure: '+('VeryLongUnbrokenDiagnostic'.repeat(200)));await pull.promise;return {downloaded:1};}
 const fingerprints=new Map(ids.map(id=>[id,hash(JSON.stringify(treeSnapshot(store,id)))]));
 app.autoSync.progress({phase:'Uploading records',completed:6,total:12});metrics.bytesSent+=8192;await push.promise;
 app.autoSync.cloud.cacheKey='cloud:ui-benchmark';const cache=app.autoSync.cloud.cache();for(const[id,value]of fingerprints)cache.ack[id]=value;app.autoSync.cloud.save(cache);return {published:ids.length};
};
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const chrome=spawn(process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(root,'chrome'),'about:blank'],{stdio:'ignore'});let ws;
try{
 let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(root,'chrome','DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(port);
 const page=await(await fetch('http://127.0.0.1:'+port+'/json/new?http://127.0.0.1:'+app.server.address().port,{method:'PUT'})).json();ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let next=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression+'; '+await evaluate('document.querySelector("#dialog-error")?.textContent'));};
 const hover=async selector=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:800});const r=await evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mouseMoved',...r});};
 const fits=async selector=>assert.ok(await evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth})()`),'inspector must fit viewport: '+selector);
 await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});await wait('document.querySelector("[data-open]")');
 assert.equal(await evaluate('!!document.querySelector("#upload .button-countdown")'),false);
 assert.ok(await evaluate('!!document.querySelector(".session-state.active-state")&&!!document.querySelector(".session-state.modified-state")'));
 assert.ok(await evaluate('(()=>{const a=document.querySelector("#sync").getBoundingClientRect(),b=document.querySelector("#upload").getBoundingClientRect();return Math.abs(a.right-b.left)<=2&&Math.abs(a.height-b.height)<1})()'));
 await hover('#push-zone');await wait('document.querySelector("#pending-uploads").textContent.includes("Waiting upload")');await fits('#pending-uploads');
 await evaluate('document.querySelector("#upload").click()');await wait('document.querySelector("#sync").dataset.operation==="running"');
 assert.equal(await evaluate('document.querySelector("#upload").disabled'),true);assert.equal(await evaluate('document.querySelector("#upload").dataset.operation'), '');
 assert.ok(await evaluate('document.querySelector("#transfer-progress").textContent.includes("40%")'));await fits('#transfer-progress');
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#sync>.icon")).animationName'),'none');
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#sync .transfer-arrow")).animationName'),'pull-arrow');
 assert.equal(await evaluate('document.querySelector(".sync-step[data-step=pull]").dataset.state'),'running');
 assert.equal(await evaluate('document.querySelector(".sync-step[data-step=push]").dataset.state'),'pending');
 assert.equal(await evaluate('!!document.querySelector(".transfer-chart")||!!document.querySelector(".transfer-metrics")'),false);
 fs.mkdirSync('test-results',{recursive:true});const pulling=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/sync-pull.png',Buffer.from(pulling.data,'base64'));
 await evaluate('document.querySelector("[data-open]").click()');await wait('document.querySelector("[data-node]")');await evaluate('document.querySelector("[data-node]").click()');
 assert.equal(await evaluate('document.querySelector("#activate-node").disabled'),false);assert.equal(await evaluate('document.querySelector("#archive-path").disabled'),false);
 await evaluate('document.querySelector("#activate-node").click()');await wait('document.querySelector("#activation-title")?.textContent.length&&!document.querySelector("#dialog-submit").disabled');await evaluate('document.querySelector("#dialog-form").requestSubmit()');await wait('!document.querySelector("#dialog").open&&!document.querySelector("#archive-path").disabled');
 assert.ok(app.store.instances().some(i=>i.applied&&i.groveTitle));
 await evaluate('document.querySelector("#archive-path").click();document.querySelector("#dialog-form").requestSubmit()');await wait('!document.querySelector("#dialog").open&&document.querySelector("#detail-page").hidden');assert.equal(app.store.local('trashPending').length,1);
 // The backend read/write guards are exercised by tests; avoid mock cloud cleanup here.
 app.autoSync.syncTrash=async()=>{};pull.resolve();await wait('document.querySelector("#upload").dataset.operation==="running"');assert.notEqual(await evaluate('document.querySelector("#sync").dataset.operation'),'running');
 await evaluate('document.querySelector("#sync-details").dispatchEvent(new MouseEvent("mouseenter"))');
 assert.equal(await evaluate('document.querySelector(".sync-step[data-step=pull]").dataset.state'),'complete');assert.equal(await evaluate('document.querySelector(".sync-step[data-step=push]").dataset.state'),'running');
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#upload .transfer-arrow")).animationName'),'push-arrow');
 const pushing=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/sync-push.png',Buffer.from(pushing.data,'base64'));
 app.store.edit(queued.id,{name:'Edited after upload snapshot'});app.autoSync.schedule([queued.id]);push.resolve();await app.autoSync.syncJob;await wait('!document.querySelector("#upload").disabled');
 await hover('#push-zone');await wait('document.querySelector("#pending-uploads").textContent.includes("Edited after upload snapshot")');await fits('#pending-uploads');
 failPull=true;await evaluate('document.querySelector("#sync").click()');await wait('document.querySelector(".transfer-error")');assert.equal(await evaluate('!!document.querySelector("#transfer-progress progress")'),false);assert.equal(await evaluate('document.querySelector(".sync-step[data-step=pull]").dataset.state'),'failed');await fits('#transfer-progress');
 fs.mkdirSync('test-results',{recursive:true});let screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/sync-desktop.png',Buffer.from(screenshot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate('new Promise(r=>requestAnimationFrame(r))');await fits('#transfer-progress');
 screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/sync-mobile-error.png',Buffer.from(screenshot.data,'base64'));
 await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}));document.querySelector("#settings").click()');await wait('document.querySelector("[name=autoUploadEnabled]")');assert.equal(await evaluate('document.querySelector("[name=autoUploadEnabled]").checked'),false);
 assert.deepEqual(errors,[]);console.log('Browser passed: split Download/Upload sequencing, concrete progress, pending hover, local Activate/Trash during transfer, post-snapshot queue, bounded long error on desktop/mobile, manual defaults.');
}finally{pull.resolve();push.resolve();await app.autoSync.syncJob?.catch(()=>{});ws?.close();chrome.kill();await once(chrome,'exit');await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});}
