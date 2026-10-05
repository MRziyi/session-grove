// Synthetic shared-compaction and observable-loading regression. No personal data.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';import {codexSample,codexTurn} from '../src/demo.js';import {browserBinary,browserPort,closeBrowser} from './browser-runtime.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-tree-loading-')),app=createApp({root:path.join(root,'data'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},demo:true,guard:()=>{}}),store=app.store;
const project=store.project('Compaction project'),base=codexSample(root,[['Shared background','Recorded result']]),turn=(q,a)=>codexTurn(q,a).map(v=>JSON.stringify(v)+'\n').join('');
const compact=i=>JSON.stringify({timestamp:new Date(1700000000000+i).toISOString(),type:'compacted',payload:{message:'Shared retained context',replacement_history:[]}})+'\n';
const prefix=base+compact(0)+turn('Shared next step','Shared answer'),parent=store.branch(project.id,'Large compaction tree','codex',prefix+turn('Main tail','Main result'));
for(let i=0;i<18;i++){const child=store.branch(project.id,'Path '+i,'codex',base+compact(i+1)+turn('Shared next step','Shared answer')+turn('Tail '+i,'Result '+i));store.put('branch',{...child,parentId:parent.id,forkRevision:parent.head,forkEnd:prefix.trim().split('\n').length,forkParentEnd:prefix.trim().split('\n').length});}
const legacyPath=store.all('branch').find(b=>b.parentId===parent.id),legacyEvent=store.parsed(legacyPath.head,'codex').context.compactions[0];
store.put('branch',{...legacyPath,contextPolicy:{disabled:[legacyEvent.legacyId]}});
const original=store.treeGraphAsync.bind(store);let release,waiting;
function pause(){waiting=new Promise(r=>release=r);}pause();
store.treeGraphAsync=async(...args)=>{await waiting;return original(...args);};
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const baseURL='http://127.0.0.1:'+app.server.address().port;
const chrome=spawn(browserBinary(),['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(root,'chrome'),'about:blank'],{stdio:'ignore',windowsHide:true});let ws;
try{
 const port=await browserPort(chrome,path.join(root,'chrome')),page=await fetch('http://127.0.0.1:'+port+'/json/new?'+baseURL,{method:'PUT'}).then(r=>r.json());ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let serial=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression);};
 await call('Runtime.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});
 await wait(`document.querySelector('[data-scope="${project.id}"]')`);await evaluate(`document.querySelector('[data-scope="${project.id}"]').click()`);await wait(`document.querySelector('[data-open="${parent.id}"]')`);await evaluate(`document.querySelector('[data-open="${parent.id}"]').click()`);
 await wait('!document.querySelector("#trash-progress").hidden&&document.querySelector("#trash-progress progress")');
 assert.equal(await evaluate('document.querySelector("#trash-progress strong").textContent'),'Open session');
 assert.equal((await fetch(baseURL+'/api/service')).status,200,'service remains responsive during loading');
 await evaluate(`document.querySelector('[data-scope="active:codex"]').click()`);await wait('document.querySelector("#main").getAttribute("aria-busy")!=="true"');assert.equal(await evaluate('document.querySelector("#trash-progress").hidden'),true);
 release();await new Promise(r=>setTimeout(r,100));pause();
 await evaluate(`document.querySelector('[data-scope="${project.id}"]').click()`);await wait(`document.querySelector('[data-open="${parent.id}"]')`);await evaluate(`document.querySelector('[data-open="${parent.id}"]').click()`);await wait('!document.querySelector("#trash-progress").hidden');
 const loading=await call('Page.captureScreenshot',{format:'png'});fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/tree-loading.png',Buffer.from(loading.data,'base64'));
 release();await wait('document.querySelectorAll(".graph-node").length>10&&document.querySelector("#main").getAttribute("aria-busy")!=="true"');
 const layout=await evaluate(`(()=>{const controls=[...document.querySelectorAll('.compaction-edge')],boxes=controls.map(e=>e.getBoundingClientRect()),nodes=[...document.querySelectorAll('.graph-node,.transcription-end')].map(e=>e.getBoundingClientRect()),overlap=(a,b)=>a.left<b.right-.01&&a.right>b.left+.01&&a.top<b.bottom-.01&&a.bottom>b.top+.01;return{controls:controls.length,overlaps:boxes.some((a,i)=>boxes.slice(i+1).some(b=>overlap(a,b))),coversNode:boxes.some(a=>nodes.some(b=>overlap(a,b))),tooltips:controls.some(e=>e.hasAttribute('title')||e.querySelector('[title]'))}})()`);
 assert.equal(layout.controls,1,'nineteen rewritten copies share one compaction control');assert.equal(layout.overlaps,false);assert.equal(layout.coversNode,false);assert.equal(layout.tooltips,false);
 const selected=await evaluate('document.querySelector("#branch-picker").value'),owner=await evaluate('document.querySelector(".compaction-edge button").dataset.compactionPath');assert.equal(owner,selected);
 assert.equal(await evaluate('document.querySelector(".compaction-edge button").getAttribute("aria-pressed")'),'mixed');
 assert.ok(await evaluate('!document.querySelector(".compaction-edge button").textContent.includes("paths")'),'edge controls do not advertise a cross-edge shared scope');
 await evaluate('document.querySelector(".compaction-edge button").click()');await wait('document.querySelector(".compaction-edge button").getAttribute("aria-pressed")==="true"');
 assert.ok(store.all('branch').every(b=>!b.contextPolicy?.disabled?.length),'one explicit choice resolves mixed legacy settings together');
 await evaluate('document.querySelector(".compaction-edge button").click()');await wait('document.querySelector(".compaction-edge button").getAttribute("aria-pressed")==="false"');
 const chosen=store.get('branch',selected);assert.equal(chosen.contextPolicy.disabled.length,1);assert.ok(store.all('branch').every(b=>b.contextPolicy?.disabled?.length===1),'shared toggle updates every inherited copy');
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/compaction-layout.png',Buffer.from(screenshot.data,'base64'));
 // A fan-out has five real edges, four with the same recorded compaction.
 const fan=store.branch(project.id,'Five-edge fan','codex',base),fanChildren=[];
 for(let i=0;i<5;i++){const child=store.branch(project.id,'Fan '+i,'codex',base+(i<4?compact(i):'')+turn('Different continuation '+i,'Different answer '+i));store.put('branch',{...child,parentId:fan.id,forkRevision:fan.head,forkEnd:base.trim().split('\n').length,forkParentEnd:base.trim().split('\n').length});fanChildren.push(child);}
 await evaluate(`document.querySelector('[data-scope="${project.id}"]').click()`);await wait(`document.querySelector('[data-open="${fan.id}"]')`);await evaluate(`document.querySelector('[data-open="${fan.id}"]').click()`);await wait('document.querySelectorAll(".compaction-edge").length===4&&document.querySelector("#main").getAttribute("aria-busy")!=="true"');
 const targets=await evaluate('[...document.querySelectorAll(".compaction-edge")].map(e=>e.dataset.after)');assert.equal(new Set(targets).size,4,'each outgoing edge owns a separate control');
 const target=await evaluate('document.querySelector(".compaction-edge button").dataset.compactionPath');await evaluate('document.querySelector(".compaction-edge button").click()');await wait('document.querySelectorAll(".compaction-edge button[aria-pressed=false]").length===1');
 assert.ok(store.get('branch',target).contextPolicy.disabled.length);assert.ok(fanChildren.filter(b=>b.id!==target).every(b=>!store.get('branch',b.id).contextPolicy?.disabled?.length),'other edges remain unchanged despite sharing the same result ID');
 // Switching the transcript must persistently mark the whole route and frame it.
 const routeIds=[fanChildren[0].id,fanChildren[3].id];let priorTransform;
 for(const branchId of routeIds){
  await evaluate(`(()=>{const picker=document.querySelector('#branch-picker');picker.value='${branchId}';picker.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const graph=store.treeGraph(fan.id,'in-use'),route=graph.paths.find(p=>p.branchId===branchId);
  assert.deepEqual((await evaluate('[...document.querySelectorAll(".graph-node.path-active")].map(e=>e.dataset.node)')).sort(),[...route.nodeIds].sort());
  assert.equal(await evaluate('document.querySelectorAll("[data-path-edge=current]").length'),route.nodeIds.length-1);
  assert.equal(await evaluate('document.querySelector("#graph-path-label").textContent'),route.transcriptionTitle||route.originalTitle||route.name);
  assert.ok(await evaluate(`(()=>{const v=document.querySelector('#graph-scroll').getBoundingClientRect(),e=document.querySelector('[data-node="${route.nodeIds.at(-1)}"]').getBoundingClientRect();return e.left>=v.left&&e.right<=v.right&&e.top>=v.top&&e.bottom<=v.bottom})()`),'selected endpoint is framed after switching');
  const transform=await evaluate('document.querySelector("#graph").style.transform');if(priorTransform)assert.notEqual(transform,priorTransform);priorTransform=transform;
 }
 const activeBefore=await evaluate('[...document.querySelectorAll(".graph-node.path-active")].map(e=>e.dataset.node)');
 await evaluate('document.querySelector("#graph-fit").click();document.querySelector("#graph-reset").click();document.querySelector("#graph-fit-path").click()');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".graph-node.path-active")].map(e=>e.dataset.node)'),activeBefore,'camera controls never erase the selected route');
 const pathShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/selected-transcript-path.png',Buffer.from(pathShot.data,'base64'));
 await evaluate('document.querySelector("#graph-fit").click()');const fanShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/edge-controls.png',Buffer.from(fanShot.data,'base64'));
 const serialBranch=store.branch(project.id,'Consecutive compactions','codex',base+compact(100)+compact(101)+turn('After both','Answer'));
 await evaluate(`document.querySelector('[data-scope="${project.id}"]').click()`);await wait(`document.querySelector('[data-open="${serialBranch.id}"]')`);await evaluate(`document.querySelector('[data-open="${serialBranch.id}"]').click()`);await wait('document.querySelectorAll(".context-point").length===1&&document.querySelector("#main").getAttribute("aria-busy")!=="true"');
 assert.equal(await evaluate('document.querySelectorAll(".compaction-edge").length'),2);assert.equal(await evaluate('document.querySelectorAll(".graph-node").length'),2,'context point is not an invented conversation node');
 const pairs=await evaluate('[...document.querySelectorAll(".compaction-edge")].map(e=>[e.dataset.before,e.dataset.after])');assert.equal(pairs[0][1],pairs[1][0]);
 await evaluate('document.querySelector("#graph-fit").click()');const serialShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/serial-compaction-edges.png',Buffer.from(serialShot.data,'base64'));
 assert.deepEqual(errors,[]);console.log('Browser passed: immediate task feedback, responsive cancellation, shared compactions on reserved connections, no tooltip or overlap, edge policies stay independent at fan-outs; serial compactions use context-only points.');
}finally{release();await closeBrowser(chrome,ws);await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
