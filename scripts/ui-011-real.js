// Read-only UI acceptance against the user's running library. No activation,
// archive, sync or transcript mutation is performed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
const debug='http://127.0.0.1:9231',base='http://127.0.0.1:7421';
const ids=process.argv.slice(2);assert.ok(ids.length&&ids.every(id=>/^[a-f0-9-]{36}$/.test(id)),'Pass one or more local tree IDs.');
const boot=await(await fetch(base+'/api/bootstrap')).json();
const selected=ids.map(id=>{const item=boot.items.find(i=>i.id===id);assert.ok(item,'Tree must exist in the saved directory.');return item;});
const page=await(await fetch(debug+'/json/new?'+base,{method:'PUT'})).json(),ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let serial=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
async function wait(expression){for(let n=0;n<400;n++){try{if(await evaluate(expression))return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression);}
const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
try{
await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});await wait('document.querySelectorAll("[data-scope]").length>3');
await evaluate('localStorage.setItem("grove-language","en");localStorage.removeItem("grove-nav-collapsed");localStorage.removeItem("grove-rail-collapsed")');await call('Page.reload');await wait('document.querySelectorAll("[data-scope]").length>3');
const report=[];
for(const item of selected){
 const name=item.name;
 await evaluate(`document.querySelector('[data-older-projects][aria-expanded="false"]')?.click()`);
 await evaluate(`document.querySelector('[data-scope="${item.projectId||'00000000-0000-4000-8000-000000000001'}"]').click()`);await wait('document.querySelectorAll("[data-project-group]").length>0');
 await evaluate(`{const e=document.querySelector('#search');e.value=${JSON.stringify(name)};e.dispatchEvent(new Event('input'));}`);await wait(`[...document.querySelectorAll('[data-open]')].some(e=>e.textContent.includes(${JSON.stringify(name)}))`);
 await evaluate(`[...document.querySelectorAll('[data-open]')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`);await wait(`document.querySelector('#session-title').textContent===${JSON.stringify(name)}&&!document.querySelector('#detail-page').hidden`);await settle();
 const overview=await evaluate(`(()=>{const v=document.querySelector('#graph-scroll').getBoundingClientRect();return {count:document.querySelectorAll('[data-node]').length, visible:[...document.querySelectorAll('[data-node]')].filter(e=>{const r=e.getBoundingClientRect();return r.left>=v.left-1&&r.right<=v.right+1&&r.top>=v.top-1&&r.bottom<=v.bottom+1}).length,branches:document.querySelector('#branch-picker').options.length};})()`);
 assert.ok(overview.count>1);assert.equal(overview.visible,overview.count);
 const nodes=await evaluate('[...document.querySelectorAll("[data-node]")].map(e=>({id:e.dataset.node,label:e.querySelector(".node-title").textContent}))');
 for(const n of nodes){
   await evaluate(`document.querySelector('[data-node="${n.id}"]').click()`);await settle();
   assert.equal(await evaluate('document.querySelector("[data-node].selected").dataset.node'),n.id);
   assert.equal(await evaluate(`document.querySelector('[data-focus-node="${n.id}"]').textContent.split(' · ')[0]`),n.label);
   // Focus from the transcript must center precisely the same graph node.
   await evaluate(`document.querySelector('[data-focus-node="${n.id}"]').click()`);await settle();
   const delta=await evaluate(`(()=>{const a=document.querySelector('[data-node="${n.id}"]').getBoundingClientRect(),b=document.querySelector('#graph-scroll').getBoundingClientRect();return [Math.abs((a.left+a.right-b.left-b.right)/2),Math.abs((a.top+a.bottom-b.top-b.bottom)/2)];})()`);
   assert.ok(delta.every(v=>v<2),`${n.label} focused incorrectly: ${delta}`);
 }
 // Native pointer input on a scrolled checkbox must keep the viewport fixed.
 await evaluate(`document.querySelector('[data-node="${nodes.at(-1).id}"]').click()`);await new Promise(r=>setTimeout(r,600));
 const checkbox=await evaluate(`(()=>{const e=[...document.querySelectorAll('[data-chat]')].at(-2);e.scrollIntoView({block:'center',behavior:'instant'});return e.dataset.chat;})()`);await settle();
 const before=await evaluate(`(()=>{const r=document.querySelector('[data-chat="${checkbox}"]').getBoundingClientRect();return {top:document.querySelector('#transcripts').scrollTop,x:r.left+r.width/2,y:r.top+r.height/2};})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',x:before.x,y:before.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:before.x,y:before.y,button:'left',clickCount:1});await settle();
 const after=await evaluate('document.querySelector("#transcripts").scrollTop');assert.ok(Math.abs(after-before.top)<2,`selection jumped ${before.top} -> ${after}`);
 report.push({name,...overview,focusedNodes:nodes.length,selectionScrollDelta:after-before.top});
 const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/ui011-'+report.length+'.png',Buffer.from(shot.data,'base64'));
 await evaluate('document.querySelector("#back").click()');
}
assert.deepEqual(errors,[]);fs.writeFileSync('test-results/011-real-ui.json',JSON.stringify(report,null,2));console.log(report);
}catch(e){console.error(e);throw e;}finally{await fetch(debug+'/json/close/'+page.id);ws.close();}
