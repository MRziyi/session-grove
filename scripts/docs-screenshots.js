// Render public documentation images from synthetic sessions in the real UI.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createApp} from '../src/server.js';import {codexSample,codexTurn,claudeSample} from '../src/demo.js';import {browserBinary,closeBrowser} from './browser-runtime.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-showcase-')),work=path.resolve('.grove/showcase/Fieldnotes');fs.mkdirSync(work,{recursive:true});
const app=createApp({root:path.join(root,'library'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},demo:true,guard:()=>{}}),store=app.store;
const project=store.project('Fieldnotes'),other=store.project('Weekend Atlas');
const brief=[['Let\'s design Fieldnotes: a quiet workspace for turning research notes into a clear argument.','## A workspace for unfinished ideas\n\nPeople need to collect evidence, compare explanations and keep the reasoning behind a decision.\n\n**Three principles**\n\n- Keep the original note close to the interpretation.\n- Make alternative directions easy to compare.\n- Let a useful thread become a draft without losing its sources.'],['Define the smallest useful workflow before exploring interface directions.','## From evidence to a draft\n\n1. **Capture** a source and a short observation.\n2. **Connect** related notes around a question.\n3. **Compare** two possible explanations.\n4. **Draft** a paragraph with its supporting evidence.\n\nWe can now explore a spatial canvas and a structured outline from the same brief.']];
const base=store.branch(project.id,'Research companion','codex',codexSample(work,brief),{deviceName:'Studio PC',agent:'codex',cwd:work});
const append=(branch,pair)=>store.ingest(branch.id,store.raw(branch.head)+codexTurn(...pair).map(row=>JSON.stringify(row)+'\n').join(''),branch.head,{deviceName:'Studio PC',agent:'codex',cwd:work});
const fork=(parent,name,pair)=>{const b=store.fork(parent.id,{name,end:store.detail(parent.id).checkpoints.at(-1).end});return append(b,pair);};
const canvas=fork(base,'Spatial canvas',['Explore a spatial canvas for comparing evidence.','## Spatial canvas\n\nKeep sources as small cards. Arrange them into **claims**, with visible links back to evidence.\n\nThe canvas should support loose exploration before asking people to choose a structure.']);
const outline=fork(base,'Outline view',['Explore an outline for people who already have a direction.','## Structured outline\n\nGroup notes beneath a working claim. Let each section hold evidence, open questions and a short draft.\n\nUse a persistent source rail to keep references available while writing.']);
const annotation=fork(canvas,'Annotation flow',['Design the annotation interaction. It should preserve the source and make the next step obvious.','## Keep the source in view\n\nSelecting a passage opens a compact annotation beside the source. The original stays visible throughout.\n\n### A small, complete interaction\n\n- **Highlight** the passage worth keeping.\n- **Add a note** in your own words.\n- **Connect** it to an existing claim, or leave it unfiled.\n\n### Ready to prototype\n\nThe first version needs three states: reading, annotating and linking. A keyboard shortcut returns to the source without losing the draft.\n\n**Decision:** test this flow before adding automatic suggestions.']);
const prototype=fork(canvas,'Canvas prototype',['Build a lightweight prototype for arranging evidence cards.','## Prototype plan\n\nStart with keyboard navigation, card grouping and undo. Keep the data model independent of canvas position.']);
fork(outline,'Drafting flow',['Turn a group of evidence into a first paragraph.','## A draft with provenance\n\nShow the working claim, the selected evidence and the draft together. Leave uncertain points as questions rather than filling gaps.']);
store.branch(project.id,'Writing companion','claude',claudeSample(work,[['Review the tone of the research companion.','Use clear, direct language. Keep suggestions specific and let the researcher decide which interpretation to keep.']]),{deviceName:'Travel Mac',agent:'claude',cwd:work});
store.branch(other.id,'Map interactions','codex',codexSample(work,[['Make saved places easy to compare.','Group by day, keep travel time visible and preserve an unplanned list.']]),{deviceName:'Studio PC',agent:'codex',cwd:work});
store.branch(other.id,'A calmer itinerary','claude',claudeSample(work,[['Review the itinerary experience.','Show the next decision, then let the rest of the day unfold. Keep optional stops easy to skip.']]),{deviceName:'Travel Mac',agent:'claude',cwd:work});
store.branch(null,'A quick SQL question','codex',codexSample(work,[['How can I find duplicate slugs?','Group by slug and filter groups with a count greater than one.']]));
let graph=store.treeGraph(base.id);
for(const b of [base,canvas,outline,annotation,prototype]){
    graph=store.treeGraph(base.id);const route=graph.paths.find(p=>p.branchId===b.id),node=graph.nodes.find(n=>n.id===route.nodeIds.at(-1));
    if(node&&!node.name)store.organize(base.id,{version:graph.version,pathId:b.id,nodeId:node.id,action:'rename',name:b.id===base.id?'Project brief':b.name});
}
app.native.setActive(annotation.id,work,true);app.native.apply([annotation.id]);
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const chrome=spawn(browserBinary(),['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(root,'browser'),'about:blank'],{stdio:'ignore',windowsHide:true});let ws;
try{
    let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(root,'browser','DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const page=await(await fetch('http://127.0.0.1:'+port+'/json/new?http://127.0.0.1:'+app.server.address().port,{method:'PUT'})).json();ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let id=0;const pending=new Map();
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);};
    await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await wait('document.querySelector("[data-open]")');
    const capture=async name=>{await evaluate('document.fonts.ready');await new Promise(r=>setTimeout(r,350));fs.mkdirSync('docs/images',{recursive:true});fs.writeFileSync('docs/images/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    await evaluate(`document.querySelector('[data-scope="${project.id}"]').click()`);await wait('document.querySelectorAll("[data-open]").length>=4');await capture('library');
    await evaluate(`document.querySelector('[data-open="${base.id}"]').click()`);await wait('document.querySelectorAll("[data-node]").length>=5');
    graph=store.treeGraph(base.id);const selected=graph.paths.find(p=>p.branchId===annotation.id).nodeIds.at(-1);
    await evaluate(`document.querySelector('[data-node="${selected}"]').click();document.querySelector('#graph-fit').click()`);await wait('document.querySelector("#transcripts")?.textContent.includes("Keep the source in view")');
    await evaluate(`document.querySelector('[data-segment="${selected}"] [data-expand]')?.click();document.querySelector('[data-node="${selected}"]').click()`);await capture('workspace');
    const internal=graph.nodes.find(n=>n.name==='Spatial canvas');await evaluate(`document.querySelector('[data-node="${internal.id}"]').click();document.querySelector('#activate-node').click()`);await wait('document.querySelector("#activation-title")?.textContent.startsWith("[Grove]")');await capture('activation');
    console.log('Saved synthetic library, workspace and activation screenshots.');
}finally{await closeBrowser(chrome,ws);await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
