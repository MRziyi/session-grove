import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {assert,hash} from './util.js';
import {rootOf,treeMembers} from './organization.js';
import {treeSnapshot} from './cloud.js';
import {changeSnapshot} from './session-changes.js';
import {INBOX_ID} from './inbox.js';
import {isActive} from './workspace.js';
import {isTrashed,stageTrashAsync} from './trash.js';
import {bodyRefs} from './retention.js';
const digest=value=>hash(JSON.stringify(value));

// Restore acknowledged local snapshots. No fetch, push, or native-file rewrite.
export async function discardChanges(store,cloud,native,selections,{confirmation=null,deactivate,onProgress=async()=>{}}={}) {
    assert(Array.isArray(selections)&&selections.length&&selections.every(s=>typeof s.id==='string'&&typeof s.version==='string'),'Select pending changes.');
    assert(cloud.provider==='git','Discard is available for Git sync.');
    await onProgress({phase:'Reading current changes'});
    const collected=native.collect();
    const pending=cloud.pendingItems(),events=store.local('trashPending')||[],current=new Map(pending.map(i=>[i.id,i]));
    const selected=new Map(selections.filter(s=>current.has(s.id)).map(s=>[s.id,current.get(s.id).version]));
    if(!selected.size){await onProgress({phase:'No local changes waiting to upload.',state:'success'});return {discarded:0,recoveryId:null};}
    const validate=()=>{const current=new Map(cloud.pendingItems().map(i=>[i.id,i.version]));assert([...selected].every(([id,version])=>current.get(id)===version),'Local history changed during rollback. Current data was kept; retry Discard.',409);};validate();
    const rootsFor=item=>item.action==='remove'?[...new Set(events.find(e=>e.id===item.id).branchIds.map(id=>rootOf(store,id).id))]:[item.id];
    const roots=new Set(pending.filter(i=>selected.has(i.id)).flatMap(rootsFor));
    await onProgress({phase:'Reading synced snapshot'});
    const baselines=new Map();const loadBaseline=async id=>{if(!baselines.has(id))baselines.set(id,await cloud.undoBaseline(id));return baselines.get(id);};
    const include=item=>{selected.set(item.id,item.version);for(const id of rootsFor(item))roots.add(id);};
    // Pending deletion markers and the surviving portion of one tree share a snapshot.
    for(let changed=true;changed;){const count=selected.size;for(const item of pending)if(rootsFor(item).some(id=>roots.has(id)))include(item);changed=count!==selected.size;}
    const localArchives=new Set(store.all('branch').filter(b=>store.localArchivesOnly&&!isTrashed(store,b.id)&&(b.archived||b.projectId&&store.find('project',b.projectId)?.archived)).map(b=>b.id));
    const plans=await Promise.all([...roots].map(async id=>({id,graph:await loadBaseline(id),current:treeMembers(store,id).filter(b=>!localArchives.has(b.id))})));
    const replaced=new Set(plans.flatMap(p=>p.current.map(b=>b.id))),baseline=new Map(plans.flatMap(p=>(p.graph?.branches||[]).map(b=>[b.id,b])));
    const affectedInstances=new Set(store.instances().filter(i=>replaced.has(i.branchId)).map(i=>i.id));
    assert(!collected.errors.some(e=>affectedInstances.has(e.instanceId)),'A selected native session could not be captured. Update before discarding.',409);
    const changesContent=b=>!baseline.has(b.id)||baseline.get(b.id).head!==b.head||digest(baseline.get(b.id).contextPolicy||{})!==digest(b.contextPolicy||{});
    const active=store.instances().filter(i=>replaced.has(i.branchId)&&isActive(i)&&changesContent(store.get('branch',i.branchId)));
    const approval=digest(active.map(i=>[i.id,i.branchId,i.nativeId,i.agent]));
    const sessions=active.map(i=>({branchId:i.branchId,name:i.title||store.get('branch',i.branchId).name,agent:i.agent,cwd:i.cwd,nativeId:i.nativeId}));
    if(active.length&&confirmation!==approval){
        await onProgress({phase:'Confirmation required',state:'confirmation',sessions});
        return {confirmationRequired:true,confirmation:approval,sessions,additional:[]};
    }
    const projects=new Map();
    const consider=project=>{
        if(project.id===INBOX_ID)return;
        const old=projects.get(project.id);
        if(!old||project.metaAncestors?.includes(old.metaVersion)||!old.metaAncestors?.includes(project.metaVersion)&&(project.metadataUpdatedAt||project.updatedAt||'')>(old.metadataUpdatedAt||old.updatedAt||''))projects.set(project.id,project);
    };
    for(const p of plans)for(const project of p.graph?.projects||[])consider(project);
    // A shared project's newest acknowledged metadata can belong to another tree.
    // Revert only that metadata globally; never discard that tree's unrelated local edits.
    for(const [id,ack] of Object.entries(cloud.cache().ack)){
        if(roots.has(id)||!store.find('branch',id))continue;
        const current=treeSnapshot(store,id),saved=store.local(cloud.undoKey(id));
        const synced=current&&digest(current)===ack?current:saved?.ack===ack&&digest(saved.graph)===ack?saved.graph:null;
        for(const project of synced?.projects||[])if(projects.has(project.id))consider(project);
    }
    const needed=new Set(plans.flatMap(p=>p.graph?bodyRefs(p.graph):[]).filter(ref=>!store.objectStatement.get(ref))),recovered={};
    if(needed.size)for(const event of events.filter(e=>selected.has(e.id))){
        const file=path.join(store.root,'trash',event.id+'.json.gz');if(!fs.existsSync(file))continue;
        const backup=JSON.parse(gunzipSync(fs.readFileSync(file),{maxOutputLength:512*1024*1024}));
        for(const [ref,body] of Object.entries(backup.objects||{}))if(needed.has(ref)){assert(hash(body)===ref,'Recovery copy integrity failed.');recovered[ref]=body;needed.delete(ref);}
    }
    assert(!needed.size,'The last synced conversation is unavailable locally.',409);
    if(active.length){
        assert(typeof deactivate==='function','Native deactivation is unavailable.');
        await onProgress({phase:'Deactivating sessions',sessions});
        await deactivate([...new Set(active.map(i=>i.branchId))]);
        assert(!store.instances().some(i=>replaced.has(i.branchId)&&isActive(i)&&changesContent(store.get('branch',i.branchId))),'A selected session is still active.');
    }
    await onProgress({phase:'Saving recovery copy'});
    // Keep a normal, expiring recovery copy before replacing local state.
    const live=[...replaced].filter(id=>!isTrashed(store,id)),recovery=live.length?await stageTrashAsync(store,live,[],{rescueFor:'discard-pending',onProgress}):null;
    validate();
    await onProgress({phase:'Restoring synced changes'});
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
            if(graph){const restored=treeSnapshot(store,id);assert(digest({...restored,retention:null})===digest({...graph,projects:graph.projects.map(p=>projects.get(p.id)||p),retention:null}),'Could not restore the exact synced snapshot. No changes were discarded.',409);cache.ack[id]=digest(restored);(cache.baselines||={})[id]=changeSnapshot(restored);cloud.rememberBaseline(id,restored);}
            else{delete cache.ack[id];delete cache.loaded[id];if(cache.baselines)delete cache.baselines[id];}
        }
        cloud.save(cache);
    });
    await onProgress({phase:'Changes discarded',state:'success'});
    return {discarded:selected.size,recoveryId:recovery?.id||null};
}
