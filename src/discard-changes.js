import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {assert,hash} from './util.js';
import {rootOf,treeMembers} from './organization.js';
import {treeSnapshot} from './cloud.js';
import {INBOX_ID} from './inbox.js';
import {isActive} from './workspace.js';
import {isTrashed,stageTrashAsync} from './trash.js';
import {bodyRefs} from './retention.js';
const digest=value=>hash(JSON.stringify(value));

// Restore acknowledged local snapshots. No fetch, push, or native-file rewrite.
export async function discardChanges(store,cloud,native,selections) {
    assert(Array.isArray(selections)&&selections.length&&selections.every(s=>typeof s.id==='string'&&typeof s.version==='string'),'Select pending changes.');
    assert(cloud.provider==='git','Discard is available for Git sync.');
    const collected=native.collect();
    const selected=new Map(selections.map(s=>[s.id,s.version])),pending=cloud.pendingItems(),events=store.local('trashPending')||[];
    const validate=()=>{const current=new Map(cloud.pendingItems().map(i=>[i.id,i.version]));assert([...selected].every(([id,version])=>current.get(id)===version),'Pending changes changed. Reopen the list and select them again.',409);};validate();
    const rootsFor=item=>item.action==='remove'?[...new Set(events.find(e=>e.id===item.id).branchIds.map(id=>rootOf(store,id).id))]:[item.id];
    const roots=new Set(pending.filter(i=>selected.has(i.id)).flatMap(rootsFor));
    assert(pending.filter(i=>rootsFor(i).some(id=>roots.has(id))).every(i=>selected.has(i.id)),'Select all pending changes for the same session before discarding.',409);
    const localArchives=new Set(store.all('branch').filter(b=>store.localArchivesOnly&&(b.archived||b.projectId&&store.find('project',b.projectId)?.archived)).map(b=>b.id));
    const plans=[...roots].map(id=>({id,graph:cloud.undoBaseline(id),current:treeMembers(store,id).filter(b=>!localArchives.has(b.id))}));
    const replaced=new Set(plans.flatMap(p=>p.current.map(b=>b.id))),baseline=new Map(plans.flatMap(p=>(p.graph?.branches||[]).map(b=>[b.id,b])));
    const affectedInstances=new Set(store.instances().filter(i=>replaced.has(i.branchId)).map(i=>i.id));
    assert(!collected.errors.some(e=>affectedInstances.has(e.instanceId)),'A selected native session could not be captured. Update before discarding.',409);
    const changesContent=b=>!baseline.has(b.id)||baseline.get(b.id).head!==b.head||digest(baseline.get(b.id).contextPolicy||{})!==digest(b.contextPolicy||{});
    assert(!store.instances().some(i=>replaced.has(i.branchId)&&isActive(i)&&changesContent(store.get('branch',i.branchId))),'Deactivate sessions with changed conversations before discarding. Metadata-only changes can be discarded while active.',409);
    const projects=new Map(plans.flatMap(p=>(p.graph?.projects||[]).filter(p=>p.id!==INBOX_ID).map(p=>[p.id,p])));
    for(const [id,project] of projects)if(digest(store.find('project',id))!==digest(project))
        assert(store.syncCollections().items.filter(i=>i.projectId===id).every(i=>roots.has(i.id)),'This project has shared changes. Select all its pending sessions before discarding.',409);
    const needed=new Set(plans.flatMap(p=>p.graph?bodyRefs(p.graph):[]).filter(ref=>!store.objectStatement.get(ref))),recovered={};
    if(needed.size)for(const event of events.filter(e=>selected.has(e.id))){
        const file=path.join(store.root,'trash',event.id+'.json.gz');if(!fs.existsSync(file))continue;
        const backup=JSON.parse(gunzipSync(fs.readFileSync(file),{maxOutputLength:512*1024*1024}));
        for(const [ref,body] of Object.entries(backup.objects||{}))if(needed.has(ref)){assert(hash(body)===ref,'Recovery copy integrity failed.');recovered[ref]=body;needed.delete(ref);}
    }
    assert(!needed.size,'The last synced conversation is unavailable locally.',409);
    // Keep a normal, expiring recovery copy before replacing local state.
    const live=[...replaced].filter(id=>!isTrashed(store,id)),recovery=live.length?await stageTrashAsync(store,live,[],{rescueFor:'discard-pending'}):null;
    validate();
    store.transaction(()=>{
        for(const [ref,body] of Object.entries(recovered))store.insertObject.run(ref,body);
        const instances=store.instances(),detached=instances.filter(i=>replaced.has(i.branchId)&&(!baseline.has(i.branchId)||i.baseRevision!==baseline.get(i.branchId).head));
        store.local('discardedNative',[...(store.local('discardedNative')||[]),...detached.map(({agent,nativeId})=>({agent,nativeId}))]);
        store.local('instances',instances.filter(i=>!detached.some(d=>d.id===i.id)));
        const remove=store.db.prepare('DELETE FROM entities WHERE kind=? AND id=?');
        for(const b of plans.flatMap(p=>p.current))remove.run('branch',b.id);
        for(const n of store.all('node'))if(replaced.has(n.branchId))remove.run('node',n.id);
        for(const l of store.all('layout'))if(replaced.has(l.rootId))remove.run('layout',l.id);
        for(const {graph} of plans)if(graph){
            for(const kind of ['revision','node','layout'])for(const value of graph[kind==='revision'?'revisions':kind==='node'?'nodes':'layouts']||[])store.put(kind,value);
            for(const branch of graph.branches)if(!localArchives.has(branch.id))store.put('branch',{...branch,projectId:branch.projectId===INBOX_ID?null:branch.projectId});
        }
        for(const project of projects.values())store.put('project',project);
        store.local('trashPending',events.filter(e=>!selected.has(e.id)));
        // Their recovery copies remain available, but cancelled removals are no longer queued.
        store.local('trashEntries',(store.local('trashEntries')||[]).map(e=>selected.has(e.id)?{...e,state:'removed',rescueFor:'cancelled-removal'}:e));
        store.invalidate();
        const cache=cloud.cache();
        for(const {id,graph} of plans){
            if(graph){const restored=treeSnapshot(store,id);assert(digest({...restored,retention:null})===digest({...graph,retention:null}),'Could not restore the exact synced snapshot. No changes were discarded.',409);cache.ack[id]=digest(restored);cloud.rememberBaseline(id,restored);}
            else{delete cache.ack[id];delete cache.loaded[id];if(cache.baselines)delete cache.baselines[id];}
        }
        cloud.save(cache);
    });
    return {discarded:selected.size,recoveryId:recovery?.id||null};
}
