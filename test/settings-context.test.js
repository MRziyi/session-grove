import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { Cloud } from '../src/cloud.js';
import { AutoSync } from '../src/auto-sync.js';
import { Settings } from '../src/settings.js';
import { migrateVault, verifyConnection, connectionConfig } from '../src/vault.js';
import { preferences, savePreferences } from '../src/preferences.js';
import { parse, renderNative } from '../src/transcript.js';
import { ledger } from '../src/context-ledger.js';
import { markdown } from '../web/markdown.js';
import { Native } from '../src/native.js';
import { codexSample, codexTurn } from '../src/demo.js';
import { hash } from '../src/util.js';
async function fixture(t){
 const files=new Map(),requests=[];let fail=false, weak=false, locked=false;
 const server=http.createServer(async(req,res)=>{const key=decodeURIComponent(req.url),chunks=[];requests.push([req.method,key]);for await(const c of req)chunks.push(c);
 const etag=files.has(key)?(weak?'W/':'')+'"'+hash(files.get(key))+'"':null;
 if(req.method==='LOCK'){locked=true;res.writeHead(200,{'Lock-Token':'<opaquelocktoken:test>'});return res.end();}
 if(req.method==='UNLOCK'){locked=false;res.writeHead(204);return res.end();}
 if(req.method==='MKCOL'){res.writeHead(201);return res.end();}
 if(req.method==='PUT'){if(locked&&key.endsWith('vault.json')&&req.headers.if!=='(<opaquelocktoken:test>)'){res.writeHead(423);return res.end();}if(req.headers['if-none-match']==='*'&&files.has(key)||req.headers['if-match']&&req.headers['if-match']!==etag){res.writeHead(412);return res.end();}if(fail&&key.includes('/generations/')){res.writeHead(500);return res.end();}files.set(key,Buffer.concat(chunks));res.writeHead(201);return res.end();}
 if(req.method==='DELETE'){for(const k of files.keys())if(k===key||key.endsWith('/')&&k.startsWith(key))files.delete(k);res.writeHead(204);return res.end();}
 if(req.method==='PROPFIND'){res.writeHead(207);return res.end('<D:multistatus xmlns:D="DAV:">'+[...files.keys()].filter(k=>k.startsWith(key)&&!k.slice(key.length).includes('/')).map(k=>`<D:response><D:href>${k}</D:href></D:response>`).join('')+'</D:multistatus>');}
 if(files.has(key)){if(req.headers['if-none-match']===etag){res.writeHead(304);return res.end();}res.writeHead(200,{ETag:etag});return res.end(req.method==='HEAD'?undefined:files.get(key));}res.writeHead(404);res.end();});
 server.listen(0,'127.0.0.1');await once(server,'listening');const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'grove-v7-'))),stores=[];
 t.after(async()=>{for(const s of stores)s.close();server.close();await once(server,'close');fs.rmSync(root,{recursive:true,force:true});});
 const config=connectionConfig({url:`http://127.0.0.1:${server.address().port}/dav`,username:'sample',password:'sample-password'});
 const device=name=>{const store=new Store(path.join(root,name));stores.push(store);return {store,cloud:new Cloud(store,()=>config)};};
 return {root,config,device,files,requests,fail:value=>fail=value,weak:value=>weak=value};
}
test('connection suffix is added once; verification only writes a disposable child',async t=>{
 const e=await fixture(t);assert.equal(connectionConfig(e.config).url,e.config.url);await verifyConnection(e.config);
 assert.ok(e.requests.every(([,p])=>p.startsWith('/dav/Session-Grove/')));assert.equal(e.files.size,0);
});
test('vault rotation preserves cloud-only history, verifies objects, survives failure and supports optional encryption',async t=>{
 const e=await fixture(t),a=e.device('a'),b=e.device('b'),pass='original-synthetic-key',next='rotated-synthetic-key';
 const p=a.store.project('Cloud-only'),branch=a.store.branch(p.id,'Root','codex',codexSample('/work',[['Unchanged private text','Answer']]));
 await a.cloud.publish([branch.id],pass);const before=Buffer.from(e.files.get('/dav/Session-Grove/session-grove-v1/vault.json'));
 e.fail(true);await assert.rejects(migrateVault(e.config,e.config,pass,next));assert.ok(e.files.get('/dav/Session-Grove/session-grove-v1/vault.json').equals(before));e.fail(false);
 const progress=[];await migrateVault(e.config,e.config,pass,next,v=>progress.push(v));assert.equal(progress.at(-1).phase,'complete');
 await assert.rejects(a.cloud.catalog(pass),/settings changed/);
 await b.cloud.catalog(next);await b.cloud.project(p.id,next);await b.cloud.hydrate(branch.id,next);assert.equal(b.store.raw(b.store.get('branch',branch.id).head),a.store.raw(branch.head));
 await migrateVault(e.config,e.config,next,'');b.cloud.lock();await b.cloud.catalog('');assert.equal(b.cloud.connection.key,null);
 await migrateVault(e.config,e.config,'',pass);const c=e.device('c');await c.cloud.catalog(pass);await c.cloud.project(p.id,pass);await c.cloud.hydrate(branch.id,pass);assert.equal(c.store.raw(c.store.get('branch',branch.id).head),a.store.raw(branch.head));
 assert.ok(![...e.files.keys()].some(k=>k.endsWith('migration.json')));
});
test('settings reveal encryption after verification, persist a private key, and never return secrets',async t=>{
 const e=await fixture(t),a=e.device('a'),auto=new AutoSync(a.store,()=>settings.read()),settings=new Settings(a.store.root,a.store,auto,()=>{});t.after(()=>auto.close());
 assert.equal(settings.status().verified,false);await settings.verify(e.config);assert.equal(settings.status().verified,true);assert.equal(settings.status().encryptionReady,false);
 settings.start({passphrase:'synthetic-settings-key'});await settings.pending;assert.equal(settings.job.state,'complete');assert.equal(settings.status().hasPassphrase,true);
 assert.equal(fs.statSync(settings.keyFile).mode&0o077,0);assert.ok(!JSON.stringify(settings.status()).includes('synthetic-settings-key'));assert.ok(!JSON.stringify(settings.status()).includes('sample-password'));
 settings.start({passphrase:''});await settings.pending;assert.equal(settings.job.state,'complete');assert.equal(settings.status().encrypted,false);assert.equal(auto.status().unlocked,true);
});
test('fallback captures first, uploads changed Pending, and sends no requests when unchanged or disabled',async t=>{
 const e=await fixture(t),a=e.device('a'),auto=new AutoSync(a.store,()=>e.config);t.after(()=>auto.close());savePreferences(a.store,{autoUploadEnabled:true});auto.unlock('synthetic-timer-key');
 assert.equal(preferences(a.store).localUpdateMinutes,1);assert.equal(auto.interval,null);
 const p=a.store.project('Work'),b=a.store.branch(p.id,'Main','codex',codexSample('/work',[['one','two']]));await auto.flush('push');
 e.requests.length=0;await auto.fallback();assert.equal(e.requests.length,0);
 let captures=0;auto.beforeUpload=()=>{captures++;if(captures===1)a.store.ingest(b.id,a.store.raw(b.head)+codexTurn('Pending','done').map(v=>JSON.stringify(v)+'\n').join(''),b.head,{});};
 await auto.fallback();assert.ok(captures>0);assert.equal(auto.status().dirty,false);assert.ok(e.requests.some(([method])=>method==='PUT'));
 savePreferences(a.store,{autoUploadEnabled:false,localUpdateEnabled:false});auto.configureTimer();assert.equal(auto.status().fallbackMinutes,null);assert.throws(()=>savePreferences(a.store,{autoUploadMinutes:0}));
});
test('Markdown never executes raw HTML or unsafe links and formats code, lists and tables',()=>{
 const output=markdown('# Heading\n\n**bold** `code`\n\n- item\n\n<script>alert(1)</script> [x](javascript:alert) ![image](https://example.test/image)\n\n```js\n<x>\n```\n\n| a | b |\n| -- | -- |\n| 1 | 2 |');
 assert.match(output,/<h1>Heading<\/h1>/);assert.match(output,/<strong>bold<\/strong>/);assert.match(output,/<table>/);assert.ok(!output.includes('<script>'));assert.ok(!output.includes('href="javascript:'));assert.ok(!output.includes('<img'));
});
test('record-preserving activation keeps tools, tool outputs, reasoning, instructions and unknown fields',()=>{
 const rows=codexSample('/same',[['request','reply']]).trim().split('\n').map(JSON.parse);rows[0].payload.base_instructions={text:'Exact original prompt'};rows[0].payload.dynamic_tools=[{name:'test',input_schema:{type:'object'}}];
 rows.splice(3,0,{type:'response_item',payload:{type:'function_call',name:'read_file',call_id:'call',arguments:'{"file_path":"README.md"}'}},{type:'response_item',payload:{type:'function_call_output',call_id:'call',output:'Exact file bytes\nline 2'}},{type:'response_item',payload:{type:'reasoning',summary:[{type:'summary_text',text:'Readable thought'}],encrypted_content:'opaque-data'}},{type:'turn_context',payload:{cwd:'/same',model:'test',developer_instructions:'Keep this prompt',sandbox_policy:{type:'read-only'}}});
 const raw=rows.map(r=>JSON.stringify(r)+'\n').join(''),parsed=parse(raw,'codex'),rendered=parse(renderNative(raw,'codex','new-id','/same','Name',{disabled:[]}),'codex');
 assert.deepEqual(rendered.records.slice(1).map(r=>r.value),parsed.records.slice(1).map(r=>r.value));assert.deepEqual(rendered.meta.base_instructions,parsed.meta.base_instructions);assert.deepEqual(rendered.meta.dynamic_tools,parsed.meta.dynamic_tools);
 const activity=ledger(parsed,'codex');assert.ok(activity.entries.some(e=>e.files?.includes('README.md')));assert.ok(activity.totals['tool-result']>0);assert.ok(activity.entries.some(e=>e.kind==='reasoning'&&e.opaque));
 rows[0].payload.history_mode='paginated';assert.throws(()=>renderNative(rows.map(r=>JSON.stringify(r)+'\n').join(''),'codex','new-id','/same','Name',{disabled:[]}));
});
test('unchanged paginated native sessions park and reactivate byte-for-byte without rebuilding',async t=>{
 const e=await fixture(t),a=e.device('native');const cwd=path.join(e.root,'work'),codex=path.join(e.root,'codex');fs.mkdirSync(cwd);fs.mkdirSync(path.join(codex,'sessions'),{recursive:true});
 const rows=codexSample(cwd,[['original','answer']]).trim().split('\n').map(JSON.parse);rows[0].payload.history_mode='paginated';const raw=rows.map(r=>JSON.stringify(r)+'\n').join('');const file=path.join(codex,'sessions','sample.jsonl');fs.writeFileSync(file,raw);
 const native=new Native(a.store,{roots:{codex,claude:path.join(e.root,'claude')},guard:()=>{}});native.refreshLocal();const b=a.store.all('branch')[0];native.setActive(b.id,null,false);native.apply();native.setActive(b.id,cwd,true);native.apply();assert.equal(fs.readFileSync(a.store.instances()[0].file,'utf8'),raw);
});

test('weak ETag providers use a short exclusive DAV lock for the verified pointer switch',async t=>{
 const e=await fixture(t),a=e.device('weak'),pass='synthetic-lock-key';const p=a.store.project('Lock'),b=a.store.branch(p.id,'Main','codex',codexSample('/work',[['a','b']]));await a.cloud.publish([b.id],pass);e.weak(true);
 await migrateVault(e.config,e.config,pass,'new-synthetic-key');assert.ok(e.requests.some(([m])=>m==='LOCK'));assert.ok(e.requests.some(([m])=>m==='UNLOCK'));
 const c=e.device('reader');await c.cloud.catalog('new-synthetic-key');await c.cloud.project(p.id,'new-synthetic-key');await c.cloud.hydrate(b.id,'new-synthetic-key');assert.equal(c.store.raw(c.store.get('branch',b.id).head),a.store.raw(b.head));
});

test('settings confirmation queues behind a running sync instead of rejecting the user',async t=>{
 const e=await fixture(t),a=e.device('settings-wait'),auto=new AutoSync(a.store,()=>settings.read()),settings=new Settings(a.store.root,a.store,auto,()=>{});t.after(()=>auto.close());
 await settings.verify(e.config);settings.start({passphrase:'initial-settings-key'});await settings.pending;assert.equal(settings.job.state,'complete');
 let release;const active=auto.exclusive(()=>new Promise(r=>release=r));await new Promise(r=>setTimeout(r,0));
 settings.start({passphrase:'replacement-settings-key'});assert.equal(settings.job.phase,'waiting');release();await active;await settings.pending;assert.equal(settings.job.state,'complete');assert.equal(auto.passphrase,'replacement-settings-key');
});

test('new-device verification and unlock never fetch catalog or histories before the first explicit sync',async t=>{
 const e=await fixture(t),a=e.device('source'),b=e.device('fresh'),pass='existing-synthetic-key';
 const branch=a.store.branch(null,'Cloud session','codex',codexSample('/work',[['Context','Answer']]));await a.cloud.publish([branch.id],pass);
 b.store.local('syncStarted',false);const auto=new AutoSync(b.store,()=>settings.read()),settings=new Settings(b.store.root,b.store,auto,()=>{});t.after(()=>auto.close());
 await settings.verify(e.config);assert.equal(settings.status().needsCurrentPassphrase,true);
 assert.throws(()=>settings.start({currentPassphrase:pass,passphrase:'unwanted-new-key'}),/Unlock/);
 e.requests.length=0;settings.start({currentPassphrase:pass});await settings.pending;assert.equal(settings.job.state,'complete');
 await auto.checkCatalog(0);await auto.openProject('00000000-0000-4000-8000-000000000001');await auto.fallback();auto.schedule([branch.id]);
 assert.equal(b.store.all('branch').length,0);assert.equal(auto.status().nextRunAt,null);assert.equal(auto.cloud.projectRefs().length,0);
 assert.ok(!e.requests.some(([method,key])=>method==='PROPFIND'||method==='GET'&&/\/(objects|trees|projects|heads)\/.+/.test(key)));
 await auto.flush('both',true);assert.equal(auto.status().started,true);assert.ok(auto.cloud.projectRefs().length);assert.equal(b.store.all('branch').length,0,'catalog-only sync remains lazy');
 e.requests.length=0;const result=await auto.flush('both',true);assert.equal(result.published,0);assert.equal(result.remoteChanged,false);assert.ok(!e.requests.some(([method])=>method==='PUT'),'an unchanged manual sync must not upload');
});
