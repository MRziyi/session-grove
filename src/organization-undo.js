import {rootOf,treeMembers} from './organization.js';
import {hash} from './util.js';
import {INBOX_ID} from './inbox.js';
export const clientTitleFields=['transcriptionTitle','transcriptionNameOrigin','transcriptionNaming'];
export const organizationFields=['name','projectId','group','sessionName','sessionNameOrigin','sessionAutomaticName','automaticName','nameOrigin','groveNamed','endpointName','contextPolicy','nodeHead','layoutHead'];
export const organizationClocks=['metadataUpdatedAt','manualUpdatedAt','automaticUpdatedAt','metaVersion','metaAncestors'];
const pick=(value,fields)=>Object.fromEntries(['id',...fields].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
export function organizationSnapshot(graph){return {
 branches:graph.branches.map(b=>({...pick(b,[...organizationFields,...clientTitleFields,...organizationClocks,'head']),projectId:b.projectId===INBOX_ID?null:b.projectId||null})),
 projects:graph.projects.filter(p=>p.id!==INBOX_ID).map(p=>pick(p,['name','description','createdAt','updatedAt',...organizationClocks])),
 nodes:graph.nodes||[],layouts:graph.layouts||[]
};}
export const organizationUndoKey=id=>'organization-undo:'+id;
export function currentOrganization(store,id){
 const branches=treeMembers(store,id),projects=new Set(branches.map(b=>b.projectId));
 const reachable=(kind,seeds,parent)=>{const found=new Map(),pending=seeds.filter(Boolean);while(pending.length){const id=pending.pop();if(found.has(id))continue;const value=store.find(kind,id);if(!value)continue;found.set(id,value);pending.push(...[value[parent],...(value.mergeParents||[])].filter(Boolean));}return [...found.values()];};
 return organizationSnapshot({branches,projects:store.all('project').filter(p=>projects.has(p.id)),nodes:reachable('node',branches.map(b=>b.nodeHead),'previousId'),layouts:reachable('layout',branches.map(b=>b.layoutHead),'parent')});
}
export function checkpointOrganization(store,id){
 const root=rootOf(store,id).id,key=organizationUndoKey(root),saved=store.local(key);
 if(saved&&treeMembers(store,root).every(b=>saved.branches.some(old=>old.id===b.id)&&(!b.projectId||saved.projects.some(p=>p.id===b.projectId))))return;
 const snapshot=currentOrganization(store,root);
 if(saved){for(const kind of ['branches','projects','nodes','layouts'])snapshot[kind]=[...saved[kind],...snapshot[kind].filter(v=>!saved[kind].some(old=>old.id===v.id))];}
 store.local(key,snapshot);
}
export function organizationSignature(snapshot){
 const layouts=new Map(snapshot.layouts.map(l=>[l.id,l]));
 return hash(JSON.stringify({branches:snapshot.branches.map(b=>({...pick(b,organizationFields.filter(k=>k!=='layoutHead')),layout:layouts.get(b.layoutHead)?.assignments||{}})).sort((a,b)=>a.id.localeCompare(b.id)),projects:snapshot.projects.map(p=>pick(p,['name','description'])).sort((a,b)=>a.id.localeCompare(b.id))}));
}
export function hasOrganizationChanges(before,after){
 const ids=new Set(before.branches.map(b=>b.id)),projectIds=new Set(before.projects.map(p=>p.id));
 const next={...after,branches:after.branches.filter(b=>ids.has(b.id)),projects:after.projects.filter(p=>projectIds.has(p.id))};
 const liveIds=new Set(next.branches.map(b=>b.id)),liveProjects=new Set(next.projects.map(p=>p.id));
 const prior={...before,branches:before.branches.filter(b=>liveIds.has(b.id)),projects:before.projects.filter(p=>liveProjects.has(p.id))};
 return organizationSignature(prior)!==organizationSignature(next);
}
export const organizationContentStamp=(store,id)=>hash(JSON.stringify(treeMembers(store,id).map(b=>[b.id,b.contentUpdatedAt||b.createdAt]).sort(([a],[b])=>a.localeCompare(b))));
