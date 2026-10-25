import {assert,hash,id as newId,now} from './util.js';
import {treeMembers} from './organization.js';
import {treeSnapshot} from './cloud-view.js';
import {changeSnapshot} from './session-changes.js';
import {isTrashed} from './trash.js';
import {organizationFields,organizationClocks,organizationSnapshot,currentOrganization,organizationSignature,organizationUndoKey,organizationContentStamp} from './organization-undo.js';
const digest=value=>hash(JSON.stringify(value));
const contentIdentity=graph=>digest(graph.branches.map(b=>[b.id,b.head,b.parentId,b.forkRevision,b.forkEnd,b.forkParentEnd,!!b.archived,!!b.synthetic]));
function restoreFields(current,saved,fields){const next={...current};for(const key of fields)if(Object.hasOwn(saved,key))next[key]=saved[key];else delete next[key];return next;}

// Discard Grove organization only. Never collect, deactivate, remove, replace
// or rewind a native session or its conversation/revision history.
export async function discardChanges(store,cloud,_native,selections,{onProgress=async()=>{}}={}){
 assert(Array.isArray(selections)&&selections.length&&selections.every(s=>typeof s.id==='string'&&typeof s.version==='string'),'Select pending changes.');
 const pending=new Map(cloud.pendingItems().map(item=>[item.id,item]));
 const selected=[...new Set(selections.map(s=>s.id))].filter(id=>pending.get(id)?.action==='upload'&&pending.get(id).discardable!==false&&store.find('branch',id));
 await onProgress({phase:'Reading organization changes'});
 const plans=[];
 let checked=0;
 for(const id of selected){
  await onProgress({phase:'Reading organization changes',completed:checked++,total:selected.length});
  const before=currentOrganization(store,id),checkpoint=store.local(organizationUndoKey(id)),graph=await cloud.organizationBaseline(id);
  let target=graph?organizationSnapshot(graph):checkpoint;
  if(!target)continue;
  // New paths stay intact; their own first edit may have a local checkpoint.
  if(graph&&checkpoint)target={...target,branches:[...target.branches,...checkpoint.branches.filter(b=>!target.branches.some(v=>v.id===b.id))],projects:[...target.projects,...checkpoint.projects.filter(p=>!target.projects.some(v=>v.id===p.id))],nodes:[...target.nodes,...checkpoint.nodes.filter(n=>!target.nodes.some(v=>v.id===n.id))],layouts:[...target.layouts,...checkpoint.layouts.filter(l=>!target.layouts.some(v=>v.id===l.id))]};
  plans.push({id,before,target,graph,version:organizationSignature(before)});
 }
 const validate=()=>{for(const p of plans)assert(organizationSignature(currentOrganization(store,p.id))===p.version,'Organization changed while reverting. Refresh and retry.',409);};
 validate();await onProgress({phase:'Restoring organization changes'});validate();
 let discarded=0;const recoveryId=newId();
 store.transaction(()=>{
  const recovery=[],suppressed=store.local('intelligenceSuppressed')||{};
  for(const plan of plans){
   const {id,target,before,graph}=plan,branches=new Map(target.branches.map(b=>[b.id,b]));
   for(const kind of ['node','layout'])for(const value of target[kind==='node'?'nodes':'layouts'])if(!store.find(kind,value.id))store.put(kind,value);
   for(const project of target.projects){const current=store.find('project',project.id);if(current)store.put('project',restoreFields(current,project,['name','description',...organizationClocks]));}
   for(const current of treeMembers(store,id)){
    if(isTrashed(store,current.id))continue;
    const saved=branches.get(current.id);if(!saved)continue;
    const next=restoreFields(current,saved,[...organizationFields,...organizationClocks]);
    next.updatedAt=[current.contentUpdatedAt||current.updatedAt||'',saved.metadataUpdatedAt||''].sort().at(-1);
    store.put('branch',next);
   }
   // Project membership is inherited by new paths; their content, identity,
   // fork boundaries and every native instance are deliberately left alone.
   const projectId=store.get('branch',id).projectId;
   for(const b of treeMembers(store,id))if(!isTrashed(store,b.id)&&b.projectId!==projectId)store.put('branch',{...b,projectId});
   const after=currentOrganization(store,id);
   if(organizationSignature(after)!==plan.version){discarded++;recovery.push({id,before});}
   suppressed[id]=organizationContentStamp(store,id);
   store.db.prepare('DELETE FROM local WHERE key=?').run(organizationUndoKey(id));
  }
  // Rebuild the shared export/index once after all metadata writes, rather
  // than rebuilding every conversation tree after each selected edit.
  for(const {id,graph} of plans){
   // Do not acknowledge appended messages, new paths or archives as uploaded.
   if(graph){const current=treeSnapshot(store,id);if(contentIdentity(current)===contentIdentity(graph)&&organizationSignature(organizationSnapshot(current))===organizationSignature(organizationSnapshot(graph))){
    const cache=cloud.cache();cache.ack[id]=digest(current);(cache.baselines||={})[id]=changeSnapshot(current);cloud.rememberBaseline(id,current);cloud.save(cache);
   }}
  }
  store.local('intelligenceSuppressed',suppressed);
  if(recovery.length)store.local('organization-recovery:'+recoveryId,{at:now(),trees:recovery});
 });
 const phase=discarded?'Organization changes discarded':'No organization changes to discard.';
 await onProgress({phase,state:'success',discarded});
 return {discarded,recoveryId:discarded?recoveryId:null,conversationsPreserved:true};
}
