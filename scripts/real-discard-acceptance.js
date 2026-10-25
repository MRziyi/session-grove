// Validate organization-only Discard in a consistent private copy of a library.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';import {createHash} from 'node:crypto';
import {Store} from '../src/store.js';import {GitCloud} from '../src/git-cloud.js';import {treeSnapshot} from '../src/cloud-view.js';import {changeSnapshot} from '../src/session-changes.js';import {discardChanges} from '../src/discard-changes.js';import {hash,inside} from '../src/util.js';
const [input,output]=process.argv.slice(2);assert.ok(input&&output,'Pass source library and a new validation directory.');
const source=fs.realpathSync(input),root=path.resolve(output);assert.ok(!inside(source,root)&&!inside(root,source),'Validation must use a separate directory.');assert.ok(!fs.existsSync(root),'Use a new validation directory.');
fs.mkdirSync(root,{recursive:true});const library=path.join(root,'library');fs.mkdirSync(library);
const sourceDb=new DatabaseSync(path.join(source,'grove.sqlite'),{readOnly:true});
try{await backup(sourceDb,path.join(library,'grove.sqlite'));}finally{sourceDb.close();}
const store=new Store(library),cloud=new GitCloud(store,()=>({url:'git@example.invalid:validation/data.git'})),baselines=new Map();
cloud.organizationBaseline=async id=>baselines.get(id)||null;cloud.useSavedCache();
const fingerprint=sql=>{const h=createHash('sha256');for(const row of store.db.prepare(sql).iterate())h.update(JSON.stringify(row)+'\n');return h.digest('hex');};
const conversationState=()=>({objects:fingerprint('SELECT hash FROM objects ORDER BY hash'),revisions:fingerprint("SELECT id,body FROM entities WHERE kind='revision' ORDER BY id"),heads:hash(JSON.stringify(store.all('branch').map(b=>[b.id,b.head,b.parentId,b.forkRevision,b.forkEnd,b.forkParentEnd,b.archived]))),instances:hash(store.db.prepare("SELECT body FROM local WHERE key='instances'").get()?.body||'')});
const report={checks:[],failures:[]};
try{
 for(const item of store.syncCollections().items.slice(0,2)){
  const graph=structuredClone(treeSnapshot(store,item.id));baselines.set(item.id,graph);const cache=cloud.cache();cache.ack[item.id]=hash(JSON.stringify(graph));(cache.baselines||={})[item.id]=changeSnapshot(graph);cloud.save(cache);
  const branch=store.get('branch',item.sessionIds[0]),before=conversationState();
  store.edit(branch.id,{name:'Synthetic organization edit'});
  const result=await discardChanges(store,cloud,{collect:()=>{throw Error('Native operations are forbidden in this validation');}},cloud.pendingItems().filter(i=>i.id===item.id));
  assert.equal(result.discarded,1);assert.equal(store.get('branch',branch.id).name,branch.name);assert.deepEqual(conversationState(),before);
  report.checks.push({organizationRestored:true,conversationAndActivationUnchanged:true});
 }
}catch(error){report.failures.push({message:error.message});process.exitCode=1;}
finally{store.close();fs.writeFileSync(path.join(root,'discard-report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
