import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {codexSample,claudeSample,codexTurn} from '../src/demo.js';
import {stageTrash,restoreTrash,expireTrash,cleanupLocal,isTrashed} from '../src/trash.js';import {savePreferences} from '../src/preferences.js';
async function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-local-test-')),stores=[];t.after(()=>{stores.forEach(s=>s.close());fs.rmSync(root,{recursive:true,force:true});});return {root,device:name=>{const store=new Store(path.join(root,name));stores.push(store);return {store};}};}
import {parse,renderNative} from '../src/transcript.js';import {ledger} from '../src/context-ledger.js';import {markdown} from '../web/markdown.js';
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
 const e=await setup(t),a=e.device('native');const cwd=path.join(e.root,'work'),codex=path.join(e.root,'codex');fs.mkdirSync(cwd);fs.mkdirSync(path.join(codex,'sessions'),{recursive:true});
 const rows=codexSample(cwd,[['original','answer']]).trim().split('\n').map(JSON.parse);rows[0].payload.history_mode='paginated';const raw=rows.map(r=>JSON.stringify(r)+'\n').join('');const file=path.join(codex,'sessions','sample.jsonl');fs.writeFileSync(file,raw);
 const native=new Native(a.store,{roots:{codex,claude:path.join(e.root,'claude')},guard:()=>{}});native.refreshLocal();const b=a.store.all('branch')[0];native.setActive(b.id,null,false);native.apply();native.setActive(b.id,cwd,true);native.apply();assert.equal(fs.readFileSync(a.store.instances()[0].file,'utf8'),raw);
});

