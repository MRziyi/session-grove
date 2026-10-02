import {browserBinary,closeBrowser,browserPort} from './browser-runtime.js';
// Isolated Chrome/CDP regression for cross-branch selection and node activation.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL,fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const source=path.resolve(process.argv[2]||fileURLToPath(new URL('..',import.meta.url)));
const {createApp}=await import(pathToFileURL(path.join(source,'src/server.js')));
const {codexSample,claudeSample}=await import(pathToFileURL(path.join(source,'src/demo.js')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-node-browser-')),app=createApp({root:path.join(root,'app'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}}),store=app.store;
const pairs=Array.from({length:12},(_,i)=>['Question '+i,('Answer '+i+' with recorded context. ').repeat(40)]);
const parent=store.branch(null,'Mixed session','codex',codexSample(root,pairs));
const child=store.branch(null,'Claude path','claude',claudeSample(root,[...pairs.slice(0,3),...Array.from({length:20},(_,i)=>['Claude question '+i,('Long Claude answer '+i+'. ').repeat(40)])]));
store.put('branch',{...child,parentId:parent.id,forkRevision:parent.head,forkEnd:store.detail(child.id).checkpoints[2].end,forkParentEnd:store.detail(parent.id).checkpoints[2].end});
for(const b of [parent,child])for(let i=b===parent?0:3;i<(b===parent?12:23);i++){const g=store.treeGraph(parent.id),p=g.paths.find(p=>p.branchId===b.id);store.organize(parent.id,{version:g.version,pathId:b.id,chatIds:p.messages.slice(i*2,i*2+2).map(m=>m.id),action:'combine',name:b.agent+' node '+i});}
const beforeCompact=store.get('branch',parent.id).head;store.ingest(parent.id,store.raw(beforeCompact)+JSON.stringify({type:'compacted',payload:{message:'Retained parent context',replacement_history:[]}})+'\n',beforeCompact,{});
app.native.setActive(parent.id,root,true);app.native.apply([parent.id]);
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const chrome=spawn(browserBinary(),['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(root,'chrome'),'about:blank'],{stdio:'ignore',windowsHide:true});let ws;
try{
 const port=await browserPort(chrome,path.join(root,'chrome'));
 const page=await(await fetch('http://127.0.0.1:'+port+'/json/new?http://127.0.0.1:'+app.server.address().port,{method:'PUT'})).json();ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let id=0;const requests=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=requests.get(m.id);requests.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;requests.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression+' '+JSON.stringify(await evaluate('({hidden:document.hidden,dialog:document.querySelector("#dialog")?.open,toast:document.querySelector("#toast")?.textContent,rows:document.querySelectorAll("[data-trash-select]").length,list:(()=>{const l=document.querySelector("#session-list");return {top:l.scrollTop,height:l.clientHeight,total:l.scrollHeight,view:l.getBoundingClientRect().top,groups:[...l.querySelectorAll("[data-project-group]")].map(g=>({name:g.querySelector("h2").textContent,top:g.getBoundingClientRect().top}))}})()})'))) ;};
 await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Page.bringToFront');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});await wait('document.querySelector("[data-open]")');await evaluate('document.querySelector("[data-open]").click()');await wait('document.querySelectorAll("[data-node]").length>10');
 assert.equal(await evaluate(`document.querySelector('[data-scope="active:codex"]').classList.contains('selected')`),true);
 assert.ok(await evaluate('(()=>{const nav=document.querySelector("#navigation"),n=nav.getBoundingClientRect(),g=[...nav.children].map(e=>e.getBoundingClientRect()),gap=parseFloat(getComputedStyle(nav).gap),box=document.querySelector(".project-directory-scroll");return Math.abs(g[0].top-n.top-gap)<1&&Math.abs(n.bottom-g[2].bottom-gap)<1&&Math.abs(g[1].top-g[0].bottom-gap)<1&&Math.abs(g[2].top-g[1].bottom-gap)<1&&getComputedStyle(box).borderTopStyle==="solid"})()'),'fixed outer and inter-group navigation gaps');

 for(const toggle of ['#toggle-rail','#toggle-rail','#toggle-navigation','#toggle-navigation']){
  await evaluate(`document.querySelector('${toggle}').click()`);
  assert.ok(await evaluate('(()=>{const nav=document.querySelector(".navigation"),footer=document.querySelector(".nav-footer");return getComputedStyle(footer).display==="none"?parseFloat(getComputedStyle(nav).paddingBottom)===0:Math.abs(nav.getBoundingClientRect().bottom-footer.getBoundingClientRect().bottom)<1})()'),'sidebar footer has no bottom gap in either pane layout');
 }

 assert.ok(await evaluate('(()=>{const a=document.querySelector(".transcript-panel").getBoundingClientRect(),b=document.querySelector(".graph-panel").getBoundingClientRect(),p=parseFloat(getComputedStyle(document.querySelector("#editor")).paddingLeft);return Math.abs(b.left-a.right-p)<1})()'));
 const dividerStart=await evaluate('(()=>{const r=document.querySelector("#ribbon-lane").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...dividerStart});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:dividerStart.x+75,y:dividerStart.y,button:'left',buttons:1});
 assert.ok(await evaluate(`(()=>{const lane=document.querySelector('#ribbon-lane').getBoundingClientRect(),grip=document.querySelector('.divider-grip').getBoundingClientRect();return lane.x>${dividerStart.x}+50&&Math.abs(grip.x+grip.width/2-lane.x-lane.width/2)<1})()`),'the visible grip follows the divider during drag');
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:dividerStart.x+75,y:dividerStart.y});
 await evaluate('document.querySelector("#graph-reset").click()');
 const graph=store.treeGraph(parent.id),targets=[parent,child].map(b=>graph.paths.find(p=>p.branchId===b.id).nodeIds.at(-4));
 async function positionNode(node){const v=await evaluate(`(()=>{const a=document.querySelector('[data-node="${node}"]').getBoundingClientRect(),b=document.querySelector('#graph-scroll').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,deltaX:a.x+a.width/2-b.x-b.width/2,deltaY:a.y+a.height/2-b.y-b.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mouseWheel',...v});await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');}
 async function clickNode(node){await positionNode(node);const rect=await evaluate(`(()=>{const r=document.querySelector('[data-node="${node}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});await wait(`document.querySelector('[data-node="${node}"]')?.getAttribute('aria-pressed')==="true"`);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
 for(const target of [...targets,...targets]){
  await positionNode(target);
  const before=await evaluate(`(()=>{const r=document.querySelector('[data-node="${target}"]').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
  await clickNode(target);
  const result=await evaluate(`(()=>{const el=document.querySelector('[data-node="${target}"]'),r=el.getBoundingClientRect(),pane=document.querySelector('#transcripts'),segment=document.querySelector('[data-segment="${target}"]').getBoundingClientRect(),view=pane.getBoundingClientRect();return {selected:el.getAttribute('aria-pressed'),x:r.x,y:r.y,scroll:pane.scrollTop,offset:segment.top-view.top,visible:segment.top<view.bottom&&segment.bottom>view.top}})()`);
  assert.equal(result.selected,'true');assert.ok(Math.abs(result.x-before.x)<=4&&Math.abs(result.y-before.y)<=4,'graph camera must stay on clicked branch: '+JSON.stringify({before,result}));assert.ok(result.scroll>100&&result.visible,'one click must align the new transcript after rendering');assert.ok(Math.abs(result.offset)<4,'deep node must align on the FIRST click: '+JSON.stringify(result));
 }
 assert.ok(await evaluate(`!!document.querySelector('#graph [data-compaction-path="${parent.id}"]')`),'the parent compaction stays visible while reading the child path');
 const compactionSelector=`#graph [data-compaction-path="${parent.id}"]`;await evaluate(`document.querySelector(${JSON.stringify(compactionSelector)}).click()`);await wait(`document.querySelector(${JSON.stringify(compactionSelector)})?.getAttribute('aria-pressed')==='false'`);assert.equal(store.get('branch',parent.id).contextPolicy.disabled.length,1,'graph toggle changes its owning path');assert.equal(await evaluate('document.querySelector("#branch-picker").value'),child.id);await evaluate(`document.querySelector(${JSON.stringify(compactionSelector)}).click()`);await wait(`document.querySelector(${JSON.stringify(compactionSelector)})?.getAttribute('aria-pressed')==='true'`);await clickNode(targets.at(-1));
 assert.ok(await evaluate('document.querySelectorAll(".transcription-end").length>=2'),'native path titles appear below graph endpoints');
 assert.ok(await evaluate('[...document.querySelectorAll(".transcription-end")].every(el=>parseFloat(getComputedStyle(el).width)<=148&&getComputedStyle(el).textOverflow==="ellipsis")'));
 // Background metadata changes must not replace an unrelated transcript DOM.
 await evaluate(`window.__stateReads=0;const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0])==='/api/state')window.__stateReads++;return response;};window.__readingNode=document.querySelector('#transcripts [data-segment]');`);
 const reading=()=>evaluate(`(()=>{const pane=document.querySelector('#transcripts'),top=pane.getBoundingClientRect().top,segment=[...pane.querySelectorAll('[data-segment]')].find(el=>el.getBoundingClientRect().bottom>top),message=[...segment.querySelectorAll('[data-message]')].find(el=>el.getBoundingClientRect().bottom>top);return {message:message?.dataset.message,offset:message?.getBoundingClientRect().top-top,scroll:pane.scrollTop,selected:document.querySelector('.graph-node.selected')?.dataset.node,camera:document.querySelector('#graph').style.transform,path:document.querySelector('#branch-picker').value}})()`);
 const beforeRefresh=await reading(),other=store.branch(null,'Other session','codex',codexSample(root,[['Unrelated request','Unrelated answer']]));let reads=await evaluate('window.__stateReads');store.edit(other.id,{name:'Background model name'},{automatic:true});
 await wait(`window.__stateReads>${reads}`);await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate("window.__readingNode===document.querySelector('#transcripts [data-segment]')"),true,'unrelated naming keeps the existing transcript DOM');assert.deepEqual(await reading(),beforeRefresh);
 // Changes inside this tree preserve the visible message, selected node and camera.
 reads=await evaluate('window.__stateReads');const renamed=store.treeGraph(parent.id),firstNode=renamed.nodes[0];store.organize(parent.id,{version:renamed.version,pathId:parent.id,nodeId:firstNode.id,action:'rename',name:'Shared title updated',nameOrigin:'automatic'});
 await wait(`window.__stateReads>${reads}`);await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const afterRename=await reading();assert.equal(afterRename.message,beforeRefresh.message);assert.ok(Math.abs(afterRename.offset-beforeRefresh.offset)<2,'metadata refresh preserves reading anchor '+JSON.stringify({beforeRefresh,afterRename}));assert.equal(afterRename.selected,beforeRefresh.selected);assert.equal(afterRename.camera,beforeRefresh.camera);
 reads=await evaluate('window.__stateReads');const oldHead=store.get('branch',child.id).head,last=JSON.parse(store.raw(oldHead).trim().split('\n').at(-1)),userId=crypto.randomUUID();store.ingest(child.id,store.raw(oldHead)+[{...last,type:'user',uuid:userId,parentUuid:last.uuid,message:{role:'user',content:[{type:'text',text:'Appended while reading'}]}},{...last,type:'assistant',uuid:crypto.randomUUID(),parentUuid:userId,message:{role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'New tail answer'}]}}].map(row=>JSON.stringify(row)+'\n').join(''),oldHead,{});
 await wait(`window.__stateReads>${reads}`);await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const afterAppend=await reading();assert.equal(afterAppend.message,beforeRefresh.message,JSON.stringify({beforeRefresh,afterAppend}));assert.ok(Math.abs(afterAppend.offset-beforeRefresh.offset)<2,'appending to the current path preserves reading anchor');assert.equal(afterAppend.selected,beforeRefresh.selected);
 await evaluate('document.querySelector("#collect").click()');await wait('!document.querySelector("#collect").disabled');const afterUpdate=await reading();assert.equal(afterUpdate.message,beforeRefresh.message);assert.ok(Math.abs(afterUpdate.offset-beforeRefresh.offset)<2,'explicit Update preserves reading anchor');assert.equal(afterUpdate.selected,beforeRefresh.selected);assert.equal(afterUpdate.camera,beforeRefresh.camera);
 const clipped=targets.at(-1);
 const clip=await evaluate(`(()=>{const n=document.querySelector('[data-node="${clipped}"]').getBoundingClientRect(),v=document.querySelector('#graph-scroll').getBoundingClientRect();return{x:v.x+v.width/2,y:v.y+v.height/2,deltaX:n.left-(v.right-n.width/2),deltaY:0}})()`);
 await call('Input.dispatchMouseEvent',{type:'mouseWheel',...clip});await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.ok(await evaluate(`(()=>{const n=document.querySelector('[data-node="${clipped}"]').getBoundingClientRect(),v=document.querySelector('#graph-scroll').getBoundingClientRect();return n.right>v.right&&n.left<v.right&&!!document.querySelector('[data-ribbon="${clipped}"]')})()`),'ribbon remains when only the right edge is clipped');
 await positionNode(clipped);
 if(!process.argv.includes('--navigation-only')){
  const internal=graph.paths.find(p=>p.branchId===parent.id).nodeIds[5];await clickNode(internal);
  assert.equal(await evaluate('!!document.querySelector("#archive-path")'),false);assert.equal(await evaluate('!document.querySelector("#rename-node")&&!!document.querySelector("#activate-node")'),true);
  assert.equal(await evaluate('!!document.querySelector("#fork")||!!document.querySelector("#toggle-active")||!!document.querySelector("#convert-session")'),false);
  await evaluate('document.querySelector("#activate-node").click()');await wait('document.querySelector("#activation-title")?.textContent.startsWith("[Grove]")&&!document.querySelector("#dialog-submit").disabled');
  fs.mkdirSync('test-results',{recursive:true});const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('test-results/node-activation.png',Buffer.from(screenshot.data,'base64'));
  assert.equal(await evaluate('document.querySelector("#activate-as").nextElementSibling.id'),'dialog-submit');
  assert.equal(await evaluate('!!document.querySelector("#deactivate-session")'),false);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('(()=>{const d=document.querySelector("#dialog"),a=document.querySelector("#activate-as").getBoundingClientRect(),b=document.querySelector("#dialog-submit").getBoundingClientRect();return d.scrollWidth<=d.clientWidth+1&&a.right<=b.left&&Math.abs(a.top-b.top)<2})()'));
  await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});
  const title=await evaluate('document.querySelector("#activation-title").textContent');assert.equal(title,'[Grove] Mixed session · codex node 5');assert.equal(store.all('branch').length,3);
  await evaluate('document.querySelector("#activate-as").click()');await wait('document.querySelector("#conversion-preview")?.textContent.includes("tokens")');assert.ok(await evaluate('document.querySelector("#conversion-preview").textContent.includes("[Grove] Mixed session · codex node 5")'));
  await evaluate('document.querySelector("#dialog-close").click();document.querySelector("#activate-node").click()');await wait('!!document.querySelector("#activation-title")&&!document.querySelector("#dialog-submit").disabled');
  await evaluate('document.querySelector("#dialog-form").requestSubmit()');await wait('!document.querySelector("#dialog").open');assert.equal(store.all('branch').length,4);assert.ok(store.instances().some(i=>i.applied&&i.title===title));
  await wait('document.querySelectorAll(".active-node-dot").length>=2');
  await evaluate('document.querySelector("#back").click()');await evaluate(`document.querySelector('[data-select="${parent.id}"]').click()`);assert.equal(await evaluate('document.querySelector("#archive-items").textContent'),'Deactivate (2)');
  await evaluate(`document.querySelector('[data-open="${parent.id}"]').click()`);await wait('document.querySelector("#detail-page").hidden===false');
  assert.ok(await evaluate('(()=>{const d=document.querySelector(".active-node-dot"),a=d.getBoundingClientRect(),b=d.closest(".graph-node").getBoundingClientRect();return a.y+a.height/2>b.y+b.height/2&&a.x+a.width/2>b.x+b.width/2})()'));
  const active=store.instances().find(i=>i.applied&&i.title===title),fresh=store.treeGraph(parent.id),endpoint=fresh.paths.find(p=>p.branchId===active.branchId).nodeIds.at(-1);
  await clickNode(endpoint);assert.equal(await evaluate('document.querySelector("#activate-node").textContent'),'Deactivate');
  await evaluate('document.querySelector("#activate-node").click()');await wait('document.querySelector("#activate-node")?.textContent==="Activate"');
  assert.equal(await evaluate(`!!document.querySelector('[data-node="${endpoint}"]')`),false,'empty continuation disappears after deactivation');
  const pendingName=await evaluate('document.querySelector(".graph-node.selected .node-title").textContent');
  await evaluate('document.querySelector("#activate-node").click()');await wait('document.querySelector("#dialog").open&&document.querySelector("#activation-title")?.textContent.length&&!document.querySelector("#dialog-submit").disabled');
  assert.ok((await evaluate('document.querySelector("#activation-title").textContent')).endsWith(pendingName));
  await evaluate('document.querySelector("#dialog-close").click()');
  await evaluate('window.__requests=[];const originalFetch=window.fetch;window.fetch=(url,...args)=>{window.__requests.push(String(url));return originalFetch(url,...args)};document.querySelector("[data-scope=trash]").click()');await wait('document.querySelector("#list-title").textContent==="Trash"&&window.__requests.includes("/api/trash")');
  const paths=await evaluate('window.__requests');assert.ok(!paths.some(p=>p==='/api/state'||p.startsWith('/api/list')),'Trash must use its lightweight endpoint');
 }
 fs.writeFileSync(path.join(root,'app','git-sync.json'),JSON.stringify({provider:'git',url:'git@example.invalid:owner/data.git',verified:true}));
 for(const selector of ['#about','#settings','#information']){
  await evaluate(`document.querySelector('${selector}').click()`);await wait('document.querySelector("#dialog").open');
  if(selector==='#settings')assert.equal(await evaluate('document.querySelector("[name=codexWindow]").tagName'),'SELECT');
  assert.equal(await evaluate('document.querySelector(".dialog-actions").hidden'),true);
  if(selector==='#settings'){
   assert.equal(await evaluate('document.querySelector("[name=smartClassify]").disabled&&document.querySelector("[name=smartNodes]").disabled'),true);
   assert.equal(await evaluate('document.querySelector("[name=smartConcurrency]").value'),'2');
   await evaluate('document.querySelector("[name=smartConcurrency]").value="1";document.querySelector("[name=smartConcurrency]").dispatchEvent(new Event("change"))');
   await wait('document.querySelector("[name=smartConcurrency]").value==="1"&&!document.querySelector("[name=smartConcurrency]").disabled');assert.equal(app.intelligence.status().concurrency,1);
   await evaluate('document.querySelector("[name=smartInterval]").value="0.5";document.querySelector("[name=smartInterval]").dispatchEvent(new Event("change"))');
   await wait('document.querySelector("[name=smartInterval]").value==="0.5"&&!document.querySelector("[name=smartInterval]").disabled');assert.equal(app.intelligence.status().minIntervalSeconds,0.5);
   app.intelligence.request=async()=>({name:'Verified'});
   await evaluate('document.querySelector("[name=intelligenceKey]").value="browser-test-secret";document.querySelector("[name=intelligenceKey]").dispatchEvent(new Event("input"));document.querySelector("#save-intelligence-key").click()');
   await wait('document.querySelector("#remove-intelligence-key")&&!document.querySelector("[name=smartClassify]").disabled');
   assert.equal(await evaluate('document.querySelector("[name=intelligenceKey]").value'),'');
   assert.equal(await evaluate('document.querySelector("[name=intelligenceKey]").disabled&&!document.querySelector("#save-intelligence-key")'),true);
   assert.ok(!(await evaluate('document.querySelector("#dialog").innerHTML')).includes('browser-test-secret'));
   assert.equal(await evaluate('document.querySelector("[name=smartClassify]").checked&&document.querySelector("[name=smartNodes]").checked'),true,'verified keys enable both smart features');
   await evaluate('document.querySelector("[name=smartNodes]").click()');await wait('!document.querySelector("[name=smartNodes]").checked&&!document.querySelector("[name=smartNodes]").disabled');
   await evaluate('document.querySelector("[name=smartNodes]").click()');await wait('document.querySelector("[name=smartNodes]").checked&&!document.querySelector("[name=smartNodes]").disabled');
   assert.equal(app.intelligence.status().nameNodes,true);
   await evaluate('document.querySelector("#remove-intelligence-key").click()');await wait('document.querySelector("[name=smartNodes]").disabled&&!document.querySelector("#remove-intelligence-key")');
   assert.equal(app.intelligence.status().hasKey,false);
   await evaluate('document.querySelector("[name=codexWindow]").value="1000000";document.querySelector("[name=codexCompactAt]").value="900000";document.querySelector("[name=codexWindow]").dispatchEvent(new Event("change",{bubbles:true}))');
   await wait('document.querySelector("#context-settings-status")?.textContent.includes("saved")');assert.match(fs.readFileSync(path.join(app.native.roots.codex,'config.toml'),'utf8'),/model_context_window = 1000000/);
   await evaluate('document.querySelector("[name=claudeWindow]").value="500000";document.querySelector("[name=claudeWindow]").dispatchEvent(new Event("change",{bubbles:true}))');
   await wait('document.querySelector("#context-settings-status")?.textContent.includes("saved")');assert.equal(JSON.parse(fs.readFileSync(path.join(app.native.roots.claude,'settings.json'))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,'500000');
   assert.equal(await evaluate('!document.querySelector("[name=intelligenceKey]").disabled&&document.querySelector("#save-intelligence-key").disabled'),true);
   assert.equal(await evaluate('!!document.querySelector("#save-timers, #save-context-codex, #save-context-claude")'),false);
   assert.equal(await evaluate('document.querySelector("[name=codexWindow]").tagName'),'SELECT');
   await evaluate('document.querySelector("[name=localUpdateMinutes]").value="7";document.querySelector("[name=localUpdateMinutes]").dispatchEvent(new Event("change",{bubbles:true}))');
   for(let i=0;i<100&&app.settings.status().preferences.localUpdateMinutes!==7;i++)await new Promise(r=>setTimeout(r,20));
   assert.equal(app.settings.status().preferences.localUpdateMinutes,7);
   assert.ok(await evaluate('(()=>{const a=document.querySelector("[name=intelligenceKey]").getBoundingClientRect(),b=document.querySelector("#save-intelligence-key").getBoundingClientRect();return b.left>=a.right&&Math.abs(a.bottom-b.bottom)<2})()'));
   assert.equal(await evaluate('!!document.querySelector("#language")'),false);
   assert.ok(await evaluate('(()=>{const h=document.querySelector("#modify-connection").closest(".settings-section-heading").querySelector("h3").getBoundingClientRect(),b=document.querySelector("#modify-connection").getBoundingClientRect();return b.left>h.right&&Math.abs(h.y+h.height/2-b.y-b.height/2)<2})()'));
   assert.ok(await evaluate('[...document.querySelectorAll(".settings-card")].every(c=>{const style=getComputedStyle(c),h=c.querySelector("h3");return style.paddingTop===style.paddingBottom&&style.paddingTop===style.paddingLeft&&getComputedStyle(h).marginTop==="0px"})'));
   assert.ok(await evaluate('[...document.querySelectorAll(".settings-card")].every(c=>{const v=[...c.children].filter(e=>getComputedStyle(e).display!=="none"),r=c.getBoundingClientRect();return Math.abs((v[0].getBoundingClientRect().top-r.top)-(r.bottom-v.at(-1).getBoundingClientRect().bottom))<2})'));
   fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/settings-spacing.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  if(selector==='#information')assert.equal(await evaluate('/diagnostic/i.test(document.querySelector("#dialog-content").textContent)'),false);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:150,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:150,button:'left',clickCount:1});await wait('!document.querySelector("#dialog").open');
 }
 app.intelligence.running=true;app.intelligence.phase='Naming branch point';app.intelligence.current='A very long session title '.repeat(20);app.intelligence.publish();
 await wait('!document.querySelector("#smart-status").hidden&&document.querySelector("#smart-status").textContent==="Naming branch point"');
 await call('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
 assert.ok(await evaluate('(()=>{const r=document.querySelector("#smart-status").getBoundingClientRect(),h=document.querySelector(".banner").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=h.bottom+1})()'));
 app.intelligence.running=false;app.intelligence.phase=null;app.intelligence.current=null;app.intelligence.publish();await wait('document.querySelector("#smart-status").hidden');
 app.intelligence.data.jobs=[{key:'queued-fixture'}];app.intelligence.publish();await wait('document.querySelector("#smart-status").textContent==="Smart organization queued"');
 await evaluate('document.querySelector("#smart-status").click()');await wait('document.querySelector("#intelligence-status")?.textContent.includes("Smart organization queued")');
 assert.ok(await evaluate('document.querySelector("#intelligence-status").textContent.includes("remaining")'));await evaluate('document.querySelector("#dialog-close").click()');app.intelligence.data.jobs=[];app.intelligence.publish();
 await call('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});
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
 await wait(`(()=>{const g=document.querySelector('[data-project-group="${projectB.id}"]').getBoundingClientRect(),v=document.querySelector('#session-list').getBoundingClientRect();const list=document.querySelector('#session-list');return Math.abs(g.top-v.top)<24||(list.scrollTop>=list.scrollHeight-list.clientHeight-1&&g.top<v.bottom&&g.bottom>v.top)})()`);
 assert.ok(await evaluate(`document.querySelector('[data-scope="${projectB.id}"]').classList.contains('selected')`),'Back follows the last browsed project');
 await evaluate(`document.querySelector('[data-group-select="${projectA.id}"]').click()`);
 assert.equal(await evaluate(`document.querySelectorAll('[data-project-group="${projectA.id}"] [data-select]:checked').length`),8);
 assert.equal(await evaluate('document.querySelector("#select-all").textContent'),'Deselect');
 await evaluate('document.querySelector("#select-all").click()');assert.equal(await evaluate('document.querySelectorAll("[data-select]:checked").length'),0);
 const {stageTrash}=await import(pathToFileURL(path.join(source,'src/trash.js')));
 const rb=store.branch(null,'Restore selected','codex',codexSample(root,[['Recovery','Keep']])),re=stageTrash(store,[rb.id],[rb.id]);
 await evaluate('document.querySelector("[data-scope=trash]").click()');await wait(`document.querySelector('[data-trash-select="recovery:${re.id}"]')`);
 await evaluate(`document.querySelector('[data-trash-select="recovery:${re.id}"]').click()`);assert.equal(await evaluate('document.querySelector("#trash-select-all").textContent'),'Deselect');
 await evaluate('document.querySelector("#trash-restore-selected").click()');await wait('document.querySelector("#list-title").textContent==="Projects"');
 assert.ok(await evaluate('[...document.querySelectorAll(".row-title")].some(e=>e.textContent.includes("Restore selected"))'));
 assert.ok(store.syncCollections().items.some(i=>i.name==='Restore selected'));
 await evaluate('document.querySelector("[data-scope=trash]").click()');
 const db=store.branch(null,'Delete selected','codex',codexSample(root,[['Delete','Discard']])),de=stageTrash(store,[db.id],[db.id]);
 await wait(`document.querySelector('[data-trash-select="recovery:${de.id}"]')`);await evaluate(`document.querySelector('[data-trash-select="recovery:${de.id}"]').click();document.querySelector('#trash-delete-selected').click()`);await wait('document.querySelector("#dialog").open');await evaluate('document.querySelector("#dialog-form").requestSubmit()');await wait('!document.querySelector("#dialog").open');assert.equal(fs.existsSync(path.join(store.root,'trash',de.id+'.json.gz')),false);
 const nb=store.branch(null,'Move client copy','codex',codexSample(root,[['Client copy','Preserve']]));app.native.setActive(nb.id,root,true);app.native.apply([nb.id]);const ni=store.instances().find(i=>i.branchId===nb.id);store.edit(nb.id,{archived:true});
 await wait('document.querySelector("[data-scope=archived]")');await evaluate('document.querySelector("[data-scope=archived]").click()');await wait(`document.querySelector('[data-client-select="client:${ni.id}"]')`);await evaluate(`document.querySelector('[data-client-select="client:${ni.id}"]').click();document.querySelector('#archive-move-trash').click()`);await wait('document.querySelector("#list-title").textContent==="Trash"');assert.equal(fs.existsSync(ni.file),false);assert.ok(store.local('trashEntries').some(e=>e.nativeInstanceId===ni.id));
 assert.deepEqual(errors,[]);console.log('Browser passed: one-click cross-tool branch positioning, stable graph camera, unified activation preview/title, conversion panel, prefix continuation, lightweight Trash.');
}finally{await closeBrowser(chrome,ws);await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
