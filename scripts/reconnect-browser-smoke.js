// First-run browser regression with empty native folders; no personal data or network sync.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';import {codexSample} from '../src/demo.js';import {browserBinary,browserPort,closeBrowser} from './browser-runtime.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-reconnect-')),app=createApp({root:path.join(root,'data'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const baseURL='http://127.0.0.1:'+app.server.address().port;
const chrome=spawn(browserBinary(),['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(root,'chrome'),'about:blank'],{stdio:'ignore',windowsHide:true});let ws;
try{
 const port=await browserPort(chrome,path.join(root,'chrome')),page=await fetch('http://127.0.0.1:'+port+'/json/new?'+baseURL,{method:'PUT'}).then(r=>r.json());ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let serial=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression);};
 await call('Runtime.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await call('Page.enable');
 await call('Page.navigate',{url:baseURL.replace('127.0.0.1','localhost')});await wait('location.hostname==="127.0.0.1"&&document.querySelector("[data-guide-update]")');
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;let failed=false;window.__injectedFailures=0;window.__requests=[];window.fetch=async(...args)=>{const mode=sessionStorage.getItem('connection-test');if(mode&&!failed&&String(args[0])==='/api/'+mode){failed=true;window.__injectedFailures++;throw new TypeError('Synthetic connection loss');}window.__requests.push(String(args[0]));return nativeFetch(...args);};`});
 for(const mode of ['state','bootstrap']){
  await evaluate(`sessionStorage.setItem('connection-test','${mode}')`);await call('Page.reload');
  await new Promise(r=>setTimeout(r,6500));
  assert.equal(await evaluate('window.__injectedFailures'),1,'the startup fault was injected');
  assert.equal(await evaluate('document.querySelector("#cloud-status").textContent'),'Sync not connected',JSON.stringify(errors)+' '+mode+' failure must recover without reloading: '+await evaluate('JSON.stringify({requests:window.__requests,text:document.querySelector("#session-list").textContent})'));
  assert.ok(await evaluate('document.querySelector("[data-guide-update]")'));
  assert.equal(await evaluate('document.querySelector("#settings").disabled'),false);
 }
 await evaluate("sessionStorage.removeItem('connection-test')");
 await call('Network.enable');await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await wait('document.querySelector("#cloud-status").textContent==="Service disconnected"');
 await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await wait('document.querySelector("#cloud-status").textContent==="Sync not connected"');
 assert.equal(await evaluate('document.querySelector("#collect").disabled'),false);
 assert.deepEqual(errors,[]);console.log('Browser passed: failed initial state, failed bootstrap and offline/online recovery without page reload.');
}finally{await closeBrowser(chrome,ws);await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
