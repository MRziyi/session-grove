// Isolated Chrome/CDP regression for cross-branch selection and node activation.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const source=path.resolve(process.argv[2]||new URL('..',import.meta.url).pathname);
const {createApp}=await import(pathToFileURL(path.join(source,'src/server.js')));
const {codexSample,claudeSample}=await import(pathToFileURL(path.join(source,'src/demo.js')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-node-browser-')),app=createApp({root:path.join(root,'app'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}}),store=app.store;
const pairs=Array.from({length:12},(_,i)=>['Question '+i,('Answer '+i+' with recorded context. ').repeat(40)]);
const parent=store.branch(null,'Mixed session','codex',codexSample(root,pairs));
const child=store.branch(null,'Claude path','claude',claudeSample(root,[...pairs.slice(0,3),...Array.from({length:20},(_,i)=>['Claude question '+i,('Long Claude answer '+i+'. ').repeat(40)])]));
store.put('branch',{...child,parentId:parent.id,forkRevision:parent.head,forkEnd:store.detail(child.id).checkpoints[2].end,forkParentEnd:store.detail(parent.id).checkpoints[2].end});
for(const b of [parent,child])for(let i=b===parent?0:3;i<(b===parent?12:23);i++){const g=store.treeGraph(parent.id),p=g.paths.find(p=>p.branchId===b.id);store.organize(parent.id,{version:g.version,pathId:b.id,chatIds:p.messages.slice(i*2,i*2+2).map(m=>m.id),action:'combine',name:b.agent+' node '+i});}
app.native.setActive(parent.id,root,true);app.native.apply([parent.id]);
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const chrome=spawn(process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(root,'chrome'),'about:blank'],{stdio:'ignore'});let ws;
try{
 let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(root,'chrome','DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(port,'Chrome debugging port');
 const page=await(await fetch('http://127.0.0.1:'+port+'/json/new?http://127.0.0.1:'+app.server.address().port,{method:'PUT'})).json();ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let id=0;const requests=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=requests.get(m.id);requests.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;requests.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression);};
 await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});await wait('document.querySelector("[data-open]")');await evaluate('document.querySelector("[data-open]").click()');await wait('document.querySelectorAll("[data-node]").length>10');
 assert.equal(await evaluate(`document.querySelector('[data-scope="active:codex"]').classList.contains('selected')`),true);
 assert.ok(await evaluate('(()=>{const a=document.querySelector(".transcript-panel").getBoundingClientRect(),b=document.querySelector(".graph-panel").getBoundingClientRect(),p=parseFloat(getComputedStyle(document.querySelector("#editor")).paddingLeft);return Math.abs(b.left-a.right-p)<1})()'));
 await evaluate('document.querySelector("#graph-reset").click()');
 const graph=store.treeGraph(parent.id),targets=[parent,child].map(b=>graph.paths.find(p=>p.branchId===b.id).nodeIds.at(-4));
 async function positionNode(node){const v=await evaluate(`(()=>{const a=document.querySelector('[data-node="${node}"]').getBoundingClientRect(),b=document.querySelector('#graph-scroll').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,deltaX:a.x+a.width/2-b.x-b.width/2,deltaY:a.y+a.height/2-b.y-b.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mouseWheel',...v});await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');}
 async function clickNode(node){await positionNode(node);const rect=await evaluate(`(()=>{const r=document.querySelector('[data-node="${node}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
 for(const target of [...targets,...targets]){
  await positionNode(target);
  const before=await evaluate(`(()=>{const r=document.querySelector('[data-node="${target}"]').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
  await clickNode(target);
  const result=await evaluate(`(()=>{const el=document.querySelector('[data-node="${target}"]'),r=el.getBoundingClientRect(),pane=document.querySelector('#transcripts'),segment=document.querySelector('[data-segment="${target}"]').getBoundingClientRect(),view=pane.getBoundingClientRect();return {selected:el.getAttribute('aria-pressed'),x:r.x,y:r.y,scroll:pane.scrollTop,offset:segment.top-view.top,visible:segment.top<view.bottom&&segment.bottom>view.top}})()`);
  assert.equal(result.selected,'true');assert.ok(Math.abs(result.x-before.x)<=4&&Math.abs(result.y-before.y)<=4,'graph camera must stay on clicked branch: '+JSON.stringify({before,result}));assert.ok(result.scroll>100&&result.visible,'one click must align the new transcript after rendering');assert.ok(Math.abs(result.offset)<4,'deep node must align on the FIRST click: '+JSON.stringify(result));
 }
 const clipped=targets.at(-1);
 const clip=await evaluate(`(()=>{const n=document.querySelector('[data-node="${clipped}"]').getBoundingClientRect(),v=document.querySelector('#graph-scroll').getBoundingClientRect();return{x:v.x+v.width/2,y:v.y+v.height/2,deltaX:n.left-(v.right-n.width/2),deltaY:0}})()`);
 await call('Input.dispatchMouseEvent',{type:'mouseWheel',...clip});await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.ok(await evaluate(`(()=>{const n=document.querySelector('[data-node="${clipped}"]').getBoundingClientRect(),v=document.querySelector('#graph-scroll').getBoundingClientRect();return n.right>v.right&&n.left<v.right&&!!document.querySelector('[data-ribbon="${clipped}"]')})()`),'ribbon remains when only the right edge is clipped');
 await positionNode(clipped);
 if(!process.argv.includes('--navigation-only')){
  const internal=graph.paths.find(p=>p.branchId===parent.id).nodeIds[5];await clickNode(internal);
  assert.equal(await evaluate('!!document.querySelector("#archive-path")'),false);assert.equal(await evaluate('!!document.querySelector("#rename-node")&&!!document.querySelector("#activate-node")'),true);
  assert.equal(await evaluate('!!document.querySelector("#fork")||!!document.querySelector("#toggle-active")||!!document.querySelector("#convert-session")'),false);
  await evaluate('document.querySelector("#activate-node").click()');await wait('document.querySelector("#activation-title")?.textContent.startsWith("[Grove]")&&!document.querySelector("#dialog-submit").disabled');
  fs.mkdirSync('test-results',{recursive:true});const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/node-activation.png',Buffer.from(screenshot.data,'base64'));
  assert.equal(await evaluate('document.querySelector("#activate-as").nextElementSibling.id'),'dialog-submit');
  assert.equal(await evaluate('!!document.querySelector("#deactivate-session")'),false);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('(()=>{const d=document.querySelector("#dialog"),a=document.querySelector("#activate-as").getBoundingClientRect(),b=document.querySelector("#dialog-submit").getBoundingClientRect();return d.scrollWidth<=d.clientWidth+1&&a.right<=b.left&&Math.abs(a.top-b.top)<2})()'));
  await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});
  const title=await evaluate('document.querySelector("#activation-title").textContent');assert.equal(title,'[Grove] Mixed session · codex node 5');assert.equal(store.all('branch').length,2);
  await evaluate('document.querySelector("#activate-as").click()');await wait('document.querySelector("#conversion-preview")?.textContent.includes("tokens")');assert.ok(await evaluate('document.querySelector("#conversion-preview").textContent.includes("[Grove] Mixed session · codex node 5")'));
  await evaluate('document.querySelector("#dialog-close").click();document.querySelector("#activate-node").click()');await wait('!!document.querySelector("#activation-title")&&!document.querySelector("#dialog-submit").disabled');
  await evaluate('document.querySelector("#dialog-form").requestSubmit()');await wait('!document.querySelector("#dialog").open');assert.equal(store.all('branch').length,3);assert.ok(store.instances().some(i=>i.applied&&i.title===title));
  await wait('document.querySelectorAll(".active-node-dot").length>=2');
  assert.ok(await evaluate('(()=>{const d=document.querySelector(".active-node-dot"),a=d.getBoundingClientRect(),b=d.closest(".graph-node").getBoundingClientRect();return a.y+a.height/2>b.y+b.height/2&&a.x+a.width/2>b.x+b.width/2})()'));
  const active=store.instances().find(i=>i.applied&&i.title===title),fresh=store.treeGraph(parent.id),endpoint=fresh.paths.find(p=>p.branchId===active.branchId).nodeIds.at(-1);
  await clickNode(endpoint);assert.equal(await evaluate('document.querySelector("#activate-node").textContent'),'Deactivate');
  await evaluate('document.querySelector("#activate-node").click()');await wait('document.querySelector("#activate-node")?.textContent==="Activate"');
  const pendingName=await evaluate(`document.querySelector('[data-node="${endpoint}"] .node-title').textContent`);
  await evaluate('document.querySelector("#activate-node").click()');await wait('document.querySelector("#dialog").open&&document.querySelector("#activation-title")?.textContent.length&&!document.querySelector("#dialog-submit").disabled');
  assert.ok((await evaluate('document.querySelector("#activation-title").textContent')).endsWith(pendingName));
  await evaluate('document.querySelector("#dialog-close").click()');
  await evaluate('window.__requests=[];const originalFetch=window.fetch;window.fetch=(url,...args)=>{window.__requests.push(String(url));return originalFetch(url,...args)};document.querySelector("[data-scope=trash]").click()');await wait('document.querySelector("#list-title").textContent==="Trash"&&window.__requests.includes("/api/trash")');
  const paths=await evaluate('window.__requests');assert.ok(!paths.some(p=>p==='/api/state'||p.startsWith('/api/list')),'Trash must use its lightweight endpoint');
 }
 fs.writeFileSync(path.join(root,'app','git-sync.json'),JSON.stringify({provider:'git',url:'git@example.invalid:owner/data.git',verified:true}));
 for(const selector of ['#about','#settings','#information']){
  await evaluate(`document.querySelector('${selector}').click()`);await wait('document.querySelector("#dialog").open');
  if(selector==='#settings')assert.ok(await evaluate('(()=>{const row=document.querySelector(".collapse-setting"),s=row.querySelector(".select-control").getBoundingClientRect(),l=row.querySelector("span").getBoundingClientRect();return l.right<=s.left&&Math.abs(l.y+l.height/2-s.y-s.height/2)<2})()'));
  assert.equal(await evaluate('document.querySelector(".dialog-actions").hidden'),true);
  if(selector==='#settings'){
   assert.equal(await evaluate('!!document.querySelector("#language")'),false);
   assert.ok(await evaluate('(()=>{const h=document.querySelector(".settings-section-heading h3").getBoundingClientRect(),b=document.querySelector("#modify-connection").getBoundingClientRect();return b.left>h.right&&Math.abs(h.y+h.height/2-b.y-b.height/2)<2})()'));
   assert.ok(await evaluate('[...document.querySelectorAll(".settings-card")].every(c=>{const style=getComputedStyle(c),h=c.querySelector("h3");return style.paddingTop===style.paddingBottom&&style.paddingTop===style.paddingLeft&&getComputedStyle(h).marginTop==="0px"})'));
   assert.ok(await evaluate('[...document.querySelectorAll(".settings-card")].every(c=>{const v=[...c.children].filter(e=>getComputedStyle(e).display!=="none"),r=c.getBoundingClientRect();return Math.abs((v[0].getBoundingClientRect().top-r.top)-(r.bottom-v.at(-1).getBoundingClientRect().bottom))<2})'));
   fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/settings-spacing.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  if(selector==='#information')assert.equal(await evaluate('/diagnostic/i.test(document.querySelector("#dialog-content").textContent)'),false);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:150,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:150,button:'left',clickCount:1});await wait('!document.querySelector("#dialog").open');
 }
 await evaluate('document.querySelector("#language-toggle").click()');assert.equal(await evaluate('document.querySelector("#language-toggle").textContent'),'中');
 await evaluate('document.querySelector("#language-toggle").click()');assert.equal(await evaluate('document.querySelector("#language-toggle").textContent'),'En');
 const {savePreferences}=await import(pathToFileURL(path.join(source,'src/preferences.js')));
 savePreferences(store,{projectFoldMode:'count',projectFoldCount:2,localUpdateEnabled:false});
 const projectA=store.project('Navigation A'),projectB=store.project('Navigation B');
 const navA=Array.from({length:8},(_,i)=>store.branch(projectA.id,'Nav A '+i,'codex',codexSample(root,[['A '+i,'Done']])));
 const navB=Array.from({length:4},(_,i)=>store.branch(projectB.id,'Nav B '+i,'codex',codexSample(root,[['B '+i,'Done']])));
 await call('Page.reload');await wait(`document.querySelector('[data-scope="${projectA.id}"]')`);
 await evaluate(`document.querySelector('[data-scope="${projectA.id}"]').click()`);await wait(`document.querySelector('[data-expand-project="${projectA.id}"]')`);
 await evaluate(`document.querySelector('[data-expand-project="${projectA.id}"]').click();document.querySelector('#session-list').scrollTo({top:150,behavior:'instant'})`);
 const listTop=await evaluate('document.querySelector("#session-list").scrollTop');
 await evaluate('window.__fetch=window.fetch;window.fetch=async(url,...args)=>{if(String(url).includes("/api/trees/"))await new Promise(r=>setTimeout(r,150));return window.__fetch(url,...args)}');
 await evaluate(`document.querySelector('[data-open="${navA[7].id}"]').click()`);
 assert.equal(await evaluate('document.querySelector("#list-page").hidden'),false,'keep list until the session is ready');
 await wait('document.querySelector("#session-title").textContent==="Nav A 7"');
 assert.equal(await evaluate(`document.querySelectorAll('[data-rail-project="${projectA.id}"] [data-rail]').length`),8);
 assert.equal(await evaluate(`document.querySelectorAll('[data-rail-project="${projectB.id}"] [data-rail]').length`),2);
 const next=await evaluate(`document.querySelector('[data-rail-project="${projectB.id}"] [data-rail]').dataset.rail`);
 await evaluate(`document.querySelector('[data-rail="${next}"]').click()`);
 assert.equal(await evaluate('document.querySelector("#detail-page").hidden'),false);
 assert.equal(await evaluate('document.querySelector("#session-title").textContent'),'Nav A 7','keep old detail while loading');
 await wait('document.querySelector("#session-title").textContent.startsWith("Nav B")');
 assert.equal(await evaluate(`document.querySelector('[data-scope="${projectB.id}"]').classList.contains('selected')`),true);
 await evaluate('document.querySelector("#back").click()');
 assert.equal(await evaluate(`document.querySelectorAll('[data-project-group="${projectA.id}"] [data-open]').length`),8);
 assert.equal(await evaluate(`document.querySelectorAll('[data-project-group="${projectB.id}"] [data-open]').length`),2);
 await wait(`(()=>{const g=document.querySelector('[data-project-group="${projectB.id}"]').getBoundingClientRect(),v=document.querySelector('#session-list').getBoundingClientRect();return Math.abs(g.top-v.top)<24})()`);
 assert.ok(await evaluate(`document.querySelector('[data-scope="${projectB.id}"]').classList.contains('selected')`),'Back follows the last browsed project');
 await evaluate(`document.querySelector('[data-group-select="${projectA.id}"]').click()`);
 assert.equal(await evaluate(`document.querySelectorAll('[data-project-group="${projectA.id}"] [data-select]:checked').length`),8);
 assert.equal(await evaluate('document.querySelector("#select-all").textContent'),'Deselect');
 await evaluate('document.querySelector("#select-all").click()');assert.equal(await evaluate('document.querySelectorAll("[data-select]:checked").length'),0);
 const {stageTrash}=await import(pathToFileURL(path.join(source,'src/trash.js')));
 const rb=store.branch(null,'Restore selected','codex',codexSample(root,[['Recovery','Keep']])),re=stageTrash(store,[rb.id],[rb.id]);
 await evaluate('document.querySelector("[data-scope=trash]").click()');await wait(`document.querySelector('[data-trash-select="recovery:${re.id}"]')`);
 await evaluate(`document.querySelector('[data-trash-select="recovery:${re.id}"]').click()`);assert.equal(await evaluate('document.querySelector("#trash-select-all").textContent'),'Deselect');
 await evaluate('document.querySelector("#trash-restore-selected").click()');await wait(`!document.querySelector('[data-trash-select="recovery:${re.id}"]')`);
 assert.ok(store.syncCollections().items.some(i=>i.name==='Restore selected'));
 const db=store.branch(null,'Delete selected','codex',codexSample(root,[['Delete','Discard']])),de=stageTrash(store,[db.id],[db.id]);
 await wait(`document.querySelector('[data-trash-select="recovery:${de.id}"]')`);await evaluate(`document.querySelector('[data-trash-select="recovery:${de.id}"]').click();document.querySelector('#trash-delete-selected').click()`);await wait('document.querySelector("#dialog").open');await evaluate('document.querySelector("#dialog-form").requestSubmit()');await wait('!document.querySelector("#dialog").open');assert.equal(fs.existsSync(path.join(store.root,'trash',de.id+'.json.gz')),false);
 const nb=store.branch(null,'Move client copy','codex',codexSample(root,[['Client copy','Preserve']]));app.native.setActive(nb.id,root,true);app.native.apply([nb.id]);const ni=store.instances().find(i=>i.branchId===nb.id);store.edit(nb.id,{archived:true});
 await wait(`document.querySelector('[data-trash-select="native:${ni.id}"]')`);await evaluate(`document.querySelector('[data-trash-select="native:${ni.id}"]').click();document.querySelector('#trash-move-selected').click()`);await wait(`!document.querySelector('[data-trash-select="native:${ni.id}"]')`);assert.equal(fs.existsSync(ni.file),false);assert.ok(store.local('trashEntries').some(e=>e.nativeInstanceId===ni.id));
 assert.deepEqual(errors,[]);console.log('Browser passed: one-click cross-tool branch positioning, stable graph camera, unified activation preview/title, conversion panel, prefix continuation, lightweight Trash.');
}finally{ws?.close();chrome.kill();await once(chrome,'exit');await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});}
