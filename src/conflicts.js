import {assert,hash,id,now} from './util.js';
import {metadata,rootOf,treeMembers} from './organization.js';
import {nextModifiedAt} from './session-time.js';
import {stageTrashAsync} from './trash.js';
import {isActive} from './workspace.js';

const digest=value=>hash(JSON.stringify(value));
const branchFields=['name','endpointName','archived','group','projectId','parentId','forkRevision','forkEnd','forkParentEnd','contextPolicy','sessionName','sessionNameOrigin'];
const kindOf=c=>c.kind==='project'?'project':'branch';
const currentOf=(store,c)=>store.get(kindOf(c),c.local.id);
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
export const conflictId=c=>digest(c);

// A child's project is inherited from its root. Old importers compared this
// derived field before normalizing it, even when both copies had one version.
export function repairInheritedProjectConflicts(store){
    const conflicts=store.local('conflicts')||[],kept=conflicts.filter(c=>{
        if(c.kind!=='branch'||!c.local.parentId||c.local.parentId!==c.remote.parentId||c.local.metaVersion!==c.remote.metaVersion)return true;
        const current=store.find('branch',c.local.id);if(!current||current.parentId!==c.local.parentId)return true;
        return branchFields.filter(k=>k!=='projectId').some(k=>!same(c.local[k],c.remote[k])||!same(current[k],c.local[k]));
    });
    if(kept.length!==conflicts.length)store.local('conflicts',kept);
    return conflicts.length-kept.length;
}
function scope(store,c){const current=currentOf(store,c);return c.kind==='project'?'project:'+current.id:'tree:'+rootOf(store,current.id).id;}
function valueLabel(store,key,value){
    if(key==='projectId')return value?store.find('project',value)?.name||'Unknown project':'Ungrouped';
    if(key==='head'||key==='forkRevision')return value?`${store.get('revision',value).refs.length} records`:'No history';
    if(key==='layoutHead')return value?[...new Set(Object.values(store.get('layout',value).assignments||{}).map(a=>a.name).filter(Boolean))].join(' · ')||'No node labels':'No node labels';
    if(key==='nodeHead'){const names=[],seen=new Set();while(value&&!seen.has(value)){seen.add(value);const n=store.get('node',value);names.unshift(n.name);value=n.previousId;}return names.join(' · ')||'No node labels';}
    if(key==='parentId')return value?store.find('branch',value)?.name||'Unknown session':'Root session';
    if(key==='contextPolicy')return `${value?.disabled?.length||0} disabled compactions`;
    if(typeof value==='boolean')return value?'Yes':'No';
    return value==null||value===''?'Not set':typeof value==='object'?JSON.stringify(value):String(value);
}
const labels={name:'Name',sessionName:'Session name',endpointName:'Node name',archived:'Archived',group:'Group',projectId:'Project',parentId:'Parent session',forkRevision:'Fork history',forkEnd:'Fork position',forkParentEnd:'Parent fork position',contextPolicy:'Context policy',head:'Conversation history',layoutHead:'Node labels',nodeHead:'Node organization',description:'Description'};
function keysFor(c){return c.kind==='project'?['name','description','archived']:c.kind==='layout'?['layoutHead']:c.kind==='organization'?['nodeHead']:c.kind==='session'?['head',...branchFields,'layoutHead','nodeHead']:branchFields;}
export function conflictItems(store){
    const groups=new Map();
    for(const c of store.local('conflicts')||[]){const key=scope(store,c);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
    return [...groups].map(([id,conflicts])=>{
        const c=conflicts[0],current=currentOf(store,c),root=c.kind==='project'?current:rootOf(store,current.id);
        const changes=conflicts.flatMap(c=>{const current=currentOf(store,c);return keysFor(c).filter(k=>!same(current[k],c.remote[k])).map(key=>{
            const change={field:labels[key]||key,session:current.name,previous:valueLabel(store,key,c.remote[key]),current:valueLabel(store,key,current[key])};
            if(key==='head'){try{
                const previous=store.parsed(c.remote.head,current.agent).messages.filter(m=>m.role!=='tool'),local=store.parsed(current.head,current.agent).messages.filter(m=>m.role!=='tool');let start=0;
                while(start<previous.length&&start<local.length&&previous[start].role===local[start].role&&previous[start].text===local[start].text)start++;
                const preview=messages=>messages.slice(start,start+2).map(m=>({role:m.role,text:m.text.slice(0,400)+(m.text.length>400?'…':'')}));
                change.previousMessages=preview(previous);change.currentMessages=preview(local);change.contextOnly=start===previous.length&&start===local.length;
            }catch{change.previewUnavailable=true;}}
            return change;
        });});
        return {id,version:digest([conflicts.map(c=>[c,currentOf(store,c)]),c.kind==='project'?null:treeMembers(store,root.id).map(b=>[b.id,b.head,b.metaVersion,b.layoutHead,b.nodeHead,b.projectId])]),name:root.sessionName||root.name,project:c.kind==='project'?'Project':root.projectId?store.find('project',root.projectId)?.name:'Ungrouped',updatedAt:current.metadataUpdatedAt||current.updatedAt,previousAt:c.remote.metadataUpdatedAt||c.remote.updatedAt,changes,requiresDeactivation:conflicts.some(c=>c.kind==='session'&&currentOf(store,c).head!==c.remote.head&&store.instances().some(i=>i.branchId===c.local.id&&isActive(i))),conflictCount:conflicts.length,conflictIds:conflicts.map(conflictId)};
    });
}
function mergedMetadata(current,remote,patch){
    const base={...current,updatedAt:nextModifiedAt(current,remote),metaAncestors:[...new Set([...(current.metaAncestors||[]),...(remote.metaAncestors||[]),remote.metaVersion].filter(Boolean))]};
    return metadata(base,patch);
}
export async function resolveConflicts(store,native,selections,choice,{deactivate,onProgress=async()=>{}}={}){
    assert(['previous','current'].includes(choice),'Choose which version to keep.');
    assert(Array.isArray(selections)&&selections.length,'Select conflicts to resolve.');
    const selected=new Map(selections.map(s=>[s.id,s.version]));assert(selected.size===selections.length,'Select each conflict once.');
    const validate=()=>{const items=new Map(conflictItems(store).map(i=>[i.id,i]));for(const [id,version] of selected)assert(items.get(id)?.version===version,'Conflicts changed. Review the latest versions before choosing.',409);return [...selected.keys()].flatMap(id=>items.get(id).conflictIds);};
    let ids=new Set(validate()),conflicts=(store.local('conflicts')||[]).filter(c=>ids.has(conflictId(c)));
    const branchIds=[...new Set(conflicts.filter(c=>c.kind!=='project').map(c=>c.local.id))];
    await onProgress({phase:'Reading local changes'});
    const capture=native.collect(branchIds);assert(!capture.errors.length,'A selected native session could not be captured. Update before resolving conflicts.',409);validate();
    const replaced=conflicts.filter(c=>choice==='previous'&&c.kind==='session'&&currentOf(store,c).head!==c.remote.head).map(c=>c.local.id);
    for(const c of conflicts.filter(c=>replaced.includes(c.local.id))){const refs=[...new Set(store.get('revision',c.remote.head).refs)],found=store.db.prepare('SELECT count(*) n FROM objects WHERE hash IN (SELECT value FROM json_each(?))').get(JSON.stringify(refs)).n;assert(found===refs.length,'The previous history is unavailable locally. Current data was kept.',409);}
    const active=store.instances().filter(i=>replaced.includes(i.branchId)&&isActive(i));
    // The command replaces a local history. Preserve it before detaching its
    // client copy; otherwise a later Update would import the discarded side again.
    let recovery;
    if(replaced.length)recovery=await stageTrashAsync(store,replaced,[],{rescueFor:'sync-conflict',onProgress});
    if(active.length){assert(typeof deactivate==='function','Deactivate the selected sessions before keeping the previous history.',409);await onProgress({phase:'Deactivating replaced histories'});await deactivate([...new Set(active.map(i=>i.branchId))]);}
    validate();await onProgress({phase:'Saving conflict choices'});validate();
    store.transaction(()=>{
        const affectedRoots=new Set(branchIds.map(id=>rootOf(store,id).id));
        for(const c of conflicts){
            const current=currentOf(store,c),previous=choice==='previous';
            if(c.kind==='layout'){
                const chosen=store.get('layout',previous?c.remote.layoutHead:current.layoutHead),layout={...chosen,id:id(),parent:current.layoutHead,mergeParents:[c.remote.layoutHead],createdAt:nextModifiedAt(current)};
                store.put('layout',layout);store.put('branch',mergedMetadata(current,c.remote,{layoutHead:layout.id}));
            }else if(c.kind==='organization'){
                const selectedHead=previous?c.remote.nodeHead:current.nodeHead,chosen=store.get('node',selectedHead),node={...chosen,id:id(),mergeParents:[current.nodeHead,c.remote.nodeHead]};
                store.put('node',node);store.put('branch',mergedMetadata(current,c.remote,{nodeHead:node.id}));
            }else{
                const patch={};if(previous)for(const key of keysFor(c))if(!same(current[key],c.remote[key]))patch[key]=c.remote[key];
                if(c.kind==='branch'&&previous&&Object.hasOwn(patch,'name'))Object.assign(patch,{groveNamed:true,nameOrigin:'manual'});
                if(c.kind==='session'){
                    if(previous)patch.head=c.remote.head;
                    patch.resolvedHeads=[...new Set([...(current.resolvedHeads||[]),current.head,c.local.head,c.remote.head].filter(Boolean))];
                }
                store.put(kindOf(c),mergedMetadata(current,c.remote,patch));
            }
        }
        // Preserve tree membership invariants for project choices, including
        // every descendant. Update the local metadata rather than only the UI.
        for(const id of branchIds)affectedRoots.add(rootOf(store,id).id);
        for(const b of store.all('branch')){const root=rootOf(store,b.id);if(affectedRoots.has(root.id)&&b.projectId!==root.projectId)store.put('branch',metadata(b,{projectId:root.projectId}));}
        if(replaced.length){const instances=store.instances(),detached=instances.filter(i=>replaced.includes(i.branchId));assert(detached.every(i=>!isActive(i)),'A replaced client copy is still active.',409);store.local('discardedNative',[...(store.local('discardedNative')||[]),...detached.map(({agent,nativeId})=>({agent,nativeId}))]);store.local('instances',instances.filter(i=>!replaced.includes(i.branchId)));}
        store.local('conflictResolutions',[...(store.local('conflictResolutions')||[]).slice(-99),{id:id(),at:now(),choice,conflicts,recoveryId:recovery?.id||null}]);
        store.local('conflicts',(store.local('conflicts')||[]).filter(c=>!ids.has(conflictId(c))));
    });
    await onProgress({phase:'Conflicts resolved',state:'success'});
    return {resolved:conflicts.length,remaining:(store.local('conflicts')||[]).length,recoveryId:recovery?.id||null};
}
export function clearConflictFailure(sync){
    if((sync.store.local('conflicts')||[]).length)return;
    const isConflict=value=>/Resolve sync conflicts before (uploading|pushing)\./.test(value?.error||value||'');
    if(isConflict(sync.lastFailure)){sync.lastFailure=null;sync.store.local('lastSyncFailure',null);sync.needsReview=null;}
    if(isConflict(sync.lastManualOperation)){sync.lastManualOperation=null;sync.store.local('lastManualSync',null);}
    if(isConflict(sync.operation))sync.operation=null;
    if(isConflict(sync.error)){sync.error=null;sync.failures=0;sync.retryAt=0;}
}
