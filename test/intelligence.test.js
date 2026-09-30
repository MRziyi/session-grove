import {privateFile} from '../src/private-file.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';
import {Intelligence,nodeEvidence} from '../src/intelligence.js';
import {namingMessages,namingEvidence,humanText,shortenAssistant} from '../src/intelligence-text.js';
import {requestSpec,requestName} from '../src/intelligence-api.js';
import {codexSample,codexTurn,claudeSample} from '../src/demo.js';
import {parse} from '../src/transcript.js';
const row=(role,text)=>({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
const waitFor=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Background queue did not reach the expected state');};
function setup(t,request=async()=>({project_id:null,new_project:null,name:'New name'})){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-smart-')),store=new Store(root);
 fs.writeFileSync(path.join(root,'intelligence.json'),JSON.stringify({apiKey:'test-local-secret',classify:true,nameNodes:true}));
 const changes=[],smart=new Intelligence(store,{request,onChange:id=>changes.push(id)});
 t.after(async()=>{smart.close();await smart.pending;store.close();fs.rmSync(root,{recursive:true,force:true});});
 const flush=async()=>{clearTimeout(smart.timer);await smart.run();clearTimeout(smart.timer);};
 return {root,store,smart,flush,changes};
}
test('Codex naming selects human prose without deleting user-authored XML',()=>{
 const rows=[row('user','<recommended_plugins>tool list</recommended_plugins>\n<environment_context>cwd</environment_context>'),row('user','# AGENTS.md instructions for /repo\nDo something'),row('user','# Context from my IDE setup:\n\n## Open tabs:\n- x\n\n## My request:\n设计 <schema><field>x</field></schema>，不要改 XML。'),{type:'response_item',payload:{type:'reasoning',summary:[{text:'private'}]}},row('assistant','Actual answer'),{type:'response_item',payload:{type:'function_call_output',output:'Not answer'}},row('assistant','Latest answer')];
 assert.deepEqual(namingMessages(rows,'codex').map(m=>m.text),['设计 <schema><field>x</field></schema>，不要改 XML。','Actual answer','Latest answer']);
 assert.equal(namingEvidence(rows,'codex').assistant,'Latest answer');
 assert.equal(humanText('<custom>keep</custom>'),'<custom>keep</custom>');
});
test('Claude naming excludes command echoes, tool results, compact summaries, thinking and errors',()=>{
 const user=(content,extra={})=>({type:'user',message:{content},...extra});
 const rows=[user('<local-command-caveat>meta</local-command-caveat>',{isMeta:true}),user('<command-name>/model</command-name>\n<command-message>model</command-message>'),user('<local-command-stdout>ok</local-command-stdout>'),user('summary',{isCompactSummary:true}),user('agent task',{origin:{kind:'agent'}}),user([{type:'text',text:'<ide_opened_file>file</ide_opened_file>'},{type:'text',text:'请改引言逻辑'}],{origin:{kind:'human'}}),user([{type:'tool_result',content:'secret results'}]),{type:'assistant',message:{content:[{type:'thinking',thinking:'secret'},{type:'tool_use',name:'read'},{type:'text',text:'引言结构已整理'}]}},{type:'assistant',isApiErrorMessage:true,message:{content:'API error'}}];
 assert.deepEqual(namingEvidence(rows,'claude'),{user:'请改引言逻辑',assistant:'引言结构已整理'});
});
test('requests preserve full human input, truncate only assistant middle, and constrain projects',()=>{
 const user='请求'.repeat(50000),assistant='start '+ 'x'.repeat(10000)+' end',spec=requestSpec('node',{user,assistant});
 const input=JSON.parse(spec.input);assert.equal(input.first_user_request,user);assert.ok(input.last_assistant_reply.startsWith('start '));assert.ok(input.last_assistant_reply.endsWith(' end'));assert.match(input.last_assistant_reply,/middle omitted/);
 assert.equal(spec.model,'gpt-6-luna');assert.equal(spec.store,false);
 assert.deepEqual(requestSpec('classify',{user},[{id:'known',name:'Project'}]).text.format.schema.properties.project_id.enum,[null,'known']);
 assert.equal(shortenAssistant('short'),'short');
});
test('API rejects failures and malformed names without echoing provider secrets',async()=>{
 await assert.rejects(requestName('secret','node',{user:'x',assistant:'y'},[],{fetcher:async()=>new Response('secret echoed',{status:401})}),e=>e.message.includes('API key rejected')&&!e.message.includes('secret'));
 const fake=value=>async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 await assert.rejects(requestName('k','classify',{user:'x'},[],{fetcher:fake({project_id:'invented',new_project:null,name:'Test'})}),/unavailable project/);
 await assert.rejects(requestName('k','node',{user:'x'},[],{fetcher:fake({name:'long'.repeat(20)})}),/invalid name/);
});
test('new ungrouped sessions wait for the agent, then classify and name exactly once',async t=>{
 let calls=0;const f=setup(t,async(key,kind,evidence,projects)=>{calls++;assert.equal(evidence.user,'Human request');return {project_id:projects[0].id,new_project:null,name:'Task label'};});
 const project=f.store.project('Project'),raw=codexSample(f.root,[['Human request','Agent reply']]);
 const partial=raw.split('\n').filter(Boolean).map(JSON.parse);partial.splice(partial.findIndex(v=>v.type==='response_item'&&v.payload.role==='assistant'));
 let b=f.store.branch(null,'Native label','codex',partial.map(v=>JSON.stringify(v)+'\n').join(''));
 f.smart.observe();await f.flush();assert.equal(calls,0);
 f.store.ingest(b.id,raw,b.head,{});f.smart.observe();await f.flush();
 b=f.store.get('branch',b.id);assert.equal(b.projectId,project.id);assert.equal(b.name,'Task label');assert.equal(calls,1);
 assert.equal(f.store.raw(b.head),raw);assert.ok(b.metadataUpdatedAt);assert.deepEqual(f.changes,[b.id]);
 f.smart.observe();await f.flush();assert.equal(calls,1);
 assert.ok(!JSON.stringify(f.store.exportGraph()).includes('test-local-secret'));assert.ok(!JSON.stringify(f.smart.status()).includes('test-local-secret'));
});
test('manual changes during a request win and assistant appends do not cancel classification',async t=>{
 let resolve;const f=setup(t,()=>new Promise(r=>resolve=r));let b=f.store.branch(null,'Original','codex',codexSample(f.root,[['Request','Answer']]));
 f.smart.observe();clearTimeout(f.smart.timer);const run=f.smart.run();f.store.edit(b.id,{name:'Manual'});resolve({project_id:null,new_project:'New project',name:'Automatic'});await run;
 assert.equal(f.store.get('branch',b.id).name,'Manual');assert.equal(f.store.all('project').length,0);
 b=f.store.branch(null,'Streaming','codex',codexSample(f.root,[['Second request','First reply']]));f.smart.observe();clearTimeout(f.smart.timer);const run2=f.smart.run();f.store.ingest(b.id,f.store.raw(b.head)+codexTurn('Followup','Later answer').map(v=>JSON.stringify(v)+'\n').join(''),b.head,{});resolve({project_id:null,new_project:'Topic',name:'Automatic'});await run2;
 assert.equal(f.store.get('branch',b.id).name,'Automatic');assert.equal(f.store.all('project')[0].name,'Topic');
});
test('new split names the shared node, preserves native text, and leaves manual names alone',async t=>{
 let evidence,calls=0;const f=setup(t,async(key,kind,value)=>{calls++;assert.equal(kind,'node');evidence=value;return {name:'引言结构定稿'};});const p=f.store.project('Paper');
 const b=f.store.branch(p.id,'Session','codex',codexSample(f.root,[['请设计引言','引言结构已整理'],['Later','Later answer']]));f.smart.observe();await f.flush();assert.equal(calls,0);
 const child=f.store.fork(b.id,{name:'Fork',end:f.store.detail(b.id).checkpoints[0].end});f.store.ingest(child.id,f.store.raw(child.head)+codexTurn('Different','Different answer').map(v=>JSON.stringify(v)+'\n').join(''),child.head,{});
 f.smart.observe();await f.flush();assert.equal(calls,1);assert.deepEqual(evidence,{user:'请设计引言',assistant:'引言结构已整理'});
 let graph=f.store.treeGraph(b.id);assert.equal(graph.nodes.find(n=>n.childIds.length>1).name,'引言结构定稿');
 f.smart.observe();await f.flush();assert.equal(calls,1);assert.match(f.store.raw(b.head),/Later answer/);
});
test('disabling smart organization while a request runs prevents late writes',async t=>{
 let resolve;const f=setup(t,()=>new Promise(r=>resolve=r)),b=f.store.branch(null,'Original','codex',codexSample(f.root,[['Request','Answer']]));
 f.smart.observe();clearTimeout(f.smart.timer);const run=f.smart.run();await f.smart.save({classify:false});resolve({project_id:null,new_project:null,name:'Late name'});await run;
 assert.equal(f.store.get('branch',b.id).name,'Original');assert.equal(f.smart.status().pending,0);
});
test('provider errors remain visible and retry the job without changing metadata',async t=>{
 let attempts=0;const f=setup(t,async()=>{if(!attempts++)throw Error('Cannot reach OpenAI. Check your connection.');return {project_id:null,new_project:null,name:'Retried'};});
 const b=f.store.branch(null,'Original','codex',codexSample(f.root,[['Request','Answer']]));f.smart.observe();await f.flush();
 assert.equal(f.store.get('branch',b.id).name,'Original');assert.match(f.smart.status().error,/Cannot reach/);assert.equal(f.smart.status().pending,1);
 f.smart.retry();await f.flush();assert.equal(f.store.get('branch',b.id).name,'Retried');assert.equal(f.smart.status().pending,0);
});
test('existing sessions and fork points are baselined when enabling; manually named nodes are preserved',async t=>{
 const f=setup(t);await f.smart.save({classify:false,nameNodes:false});
 const p=f.store.project('Existing'),b=f.store.branch(p.id,'Existing','codex',codexSample(f.root,[['Start','Done'],['Later','Answer']]));
 const child=f.store.fork(b.id,{name:'Child',end:f.store.detail(b.id).checkpoints[0].end});
 f.store.ingest(child.id,f.store.raw(child.head)+codexTurn('Other','Answer').map(v=>JSON.stringify(v)+'\n').join(''),child.head,{});
 f.store.branch(null,'Old ungrouped','claude',claudeSample(f.root,[['Hello','Hi']]));
 await f.smart.save({classify:true,nameNodes:true});f.smart.observe();assert.equal(f.smart.status().pending,0);
 const g=f.store.treeGraph(b.id),split=g.nodes.find(n=>n.childIds.length>1);f.store.organize(b.id,{version:g.version,pathId:b.id,nodeId:split.id,action:'rename',name:'Manual title'});
 f.smart.data.trees={};f.smart.observe();await f.flush();assert.equal(f.store.treeGraph(b.id).nodes.find(n=>n.id===split.id).name,'Manual title');
});
test('new empty sessions remain eligible until their first real exchange arrives',async t=>{
 const f=setup(t),raw=codexSample(f.root,[['First request','Answer']]),b=f.store.branch(null,'Empty','codex',raw.split('\n')[0]+'\n');
 f.store.put('branch',{...b,excluded:'empty'});f.smart.observe();assert.ok(f.smart.data.waiting.includes(b.id));assert.equal(f.smart.status().pending,0);
 f.store.ingest(b.id,raw,b.head,{});f.store.put('branch',{...f.store.get('branch',b.id),excluded:null});f.smart.observe();await f.flush();assert.equal(f.store.get('branch',b.id).name,'New name');
});
test('API key is verified before replacement and disabling removes queued jobs',async t=>{
 const f=setup(t,async key=>{if(key==='bad')throw Error('API key rejected. Update your key.');return {name:'Verified'};});
 await assert.rejects(f.smart.save({apiKey:'bad'}),/rejected/);assert.equal(f.smart.config().apiKey,'test-local-secret');
 await f.smart.save({removeKey:true});assert.equal(f.smart.status().hasKey,false);assert.equal(f.smart.status().classify,false);
 await assert.rejects(f.smart.save({classify:true}),/API key first/);
 await f.smart.save({apiKey:'new-local-secret'});assert.equal(privateFile(f.smart.file),true);
});
test('Claude fork evidence excludes sibling replies and names only the shared segment',async t=>{
 let observed;const f=setup(t,async(k,kind,e)=>{observed=e;return {name:'Shared result'};}),p=f.store.project('Paper');
 const b=f.store.branch(p.id,'Claude','claude',claudeSample(f.root,[['First task','Shared answer'],['Sibling task','Sibling answer']]));f.smart.observe();
 const child=f.store.fork(b.id,{name:'Other path',end:f.store.detail(b.id).checkpoints[0].end});
 f.smart.observe();await f.flush();assert.deepEqual(observed,{user:'First task',assistant:'Shared answer'});
 assert.equal(f.store.treeGraph(b.id).nodes.find(n=>n.childIds.length>1).name,'Shared result');
});
test('HTTP Update finishes while naming runs; status is visible and local edits remain available',async t=>{
 const {createApp}=await import('../src/server.js'),{once}=await import('node:events');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-smart-http-')),app=createApp({root:path.join(root,'library'),roots:{codex:path.join(root,'codex'),claude:path.join(root,'claude')},guard:()=>{}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});});
 let resolve;app.intelligence.request=async()=>new Promise(r=>resolve=r);
 fs.writeFileSync(app.intelligence.file,JSON.stringify({apiKey:'http-test-secret',classify:true,nameNodes:false}));
 const b=app.store.branch(null,'Before','codex',codexSample(root,[['Real request','First response']]));
 const api=async(route,method='GET',body)=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/'+route,{method,headers:{'X-Grove-Token':app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 assert.equal((await api('collect','POST',{})).status,200);
 await waitFor(()=>!!resolve);
 const status=(await api('status')).body;assert.equal(status.intelligence.running,true);assert.equal(status.intelligence.phase,'Classifying session');assert.equal(status.intelligence.current,'Before');assert.equal(status.update.operation.state,'success');
 const settings=(await api('settings')).body;assert.equal(settings.intelligence.hasKey,true);assert.ok(!JSON.stringify(settings).includes('http-test-secret'));
 assert.equal((await api('branches/'+b.id,'PATCH',{name:'Manual during request'})).status,200);
 resolve({project_id:null,new_project:'Ignored',name:'Automatic'});await app.intelligence.pending;
 assert.equal(app.store.get('branch',b.id).name,'Manual during request');assert.equal(app.store.all('project').length,0);
});

test('default two-request pool respects the cap and completes independent jobs',async t=>{
 let active=0,maximum=0;const releases=[];
 const f=setup(t,async()=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>releases.push(r));active--;return {project_id:null,new_project:'Shared project',name:'Named'};});
 for(let i=0;i<4;i++)f.store.branch(null,'Session '+i,'codex',codexSample(f.root,[['Task '+i,'Reply']]));
 f.smart.observe();await waitFor(()=>releases.length===2);assert.equal(f.smart.status().activeRequests,2);assert.equal(f.smart.status().pending,4);
 releases.splice(0).forEach(r=>r());await waitFor(()=>releases.length===2);releases.splice(0).forEach(r=>r());await waitFor(()=>f.smart.status().pending===0);
 assert.equal(maximum,2);assert.equal(f.store.all('project').length,1);assert.equal(f.smart.status().completed,4);
});
test('request interval applies across concurrent slots and serial mode persists',async t=>{
 const starts=[];const f=setup(t,async()=>{starts.push(Date.now());await new Promise(r=>setTimeout(r,10));return {project_id:null,new_project:null,name:'Named'};});
 await f.smart.save({concurrency:4,minIntervalSeconds:0.08});
 for(let i=0;i<3;i++)f.store.branch(null,'Session '+i,'codex',codexSample(f.root,[['Task '+i,'Reply']]));
 f.smart.observe();await waitFor(()=>f.smart.status().pending===0);
 assert.equal(starts.length,3);assert.ok(starts[1]-starts[0]>=75);assert.ok(starts[2]-starts[1]>=75);
 await f.smart.save({concurrency:1,minIntervalSeconds:0});assert.equal(f.smart.config().concurrency,1);
 await assert.rejects(f.smart.save({concurrency:0}),/1 to 4/);await assert.rejects(f.smart.save({minIntervalSeconds:-1}),/0 to 60/);
});
test('removing a key aborts every active request and prevents late names',async t=>{
 let aborted=0;const f=setup(t,async(_key,_kind,_evidence,_projects,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(Error('aborted'));},{once:true})));
 for(let i=0;i<3;i++)f.store.branch(null,'Original '+i,'codex',codexSample(f.root,[['Task '+i,'Reply']]));
 f.smart.observe();await waitFor(()=>f.smart.status().activeRequests===2);const pending=f.smart.pending;
 await f.smart.save({removeKey:true});await pending;
 assert.equal(aborted,2);assert.equal(f.smart.status().pending,0);assert.equal(f.smart.status().activeRequests,0);assert.equal(f.smart.status().error,null);assert.ok(f.store.all('branch').every(b=>b.name.startsWith('Original')));
});
