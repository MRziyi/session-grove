import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {bodyRefs} from './retention.js';
import {DatabaseSync} from 'node:sqlite';
import {assert,hash,inside,now,safePath} from './util.js';
import {stageTrashAsync,isTrashed,cleanupLocal,restoreTrash} from './trash.js';
import {removeTrashNativeCopies} from './trash-native.js';
import {connect} from './codex-rpc.js';
import {codexBinary} from './native-archive.js';
import {auxiliarySnapshot,auxiliaryStamp} from './auxiliary.js';
import {preferences} from './preferences.js';

export function nativeTrashCandidates(store) {
    return store.instances().filter(i => {
        const b=store.find('branch',i.branchId);
        return b && (isTrashed(store,b.id) || b.archived || i.nativeArchived) && i.file && fs.existsSync(i.file);
    }).map(i=>({id:i.id,branchId:i.branchId,title:store.find('branch',i.branchId)?.name || i.title,agent:i.agent,active:i.applied,discarded:isTrashed(store,i.branchId),background:store.find('branch',i.branchId)?.background||null,clientArchived:!isTrashed(store,i.branchId)&&!i.deactivatedByGrove&&(!!i.nativeArchived||!!store.find('branch',i.branchId)?.archived),updatedAt:fs.statSync(i.file).mtime.toISOString(),archived:!!i.nativeArchived || i.file.includes(path.sep+'archived_sessions'+path.sep)}));
}
export function checkFileIdle(file) {
    if(process.platform==='win32'){
        // FileShare.None rejects open client handles without changing the file.
        try { execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"try { $stream = [IO.File]::Open($env:GROVE_CHECK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None); $stream.Dispose() } catch { exit 1 }"],{env:{...process.env,GROVE_CHECK_FILE:file},windowsHide:true,stdio:'pipe'}); }
        catch { throw Object.assign(new Error('Cannot exclusively open this session file. Close this session and retry.'),{status:409}); }
        return;
    }
    try {
        const pids=execFileSync(process.platform==='darwin'?'/usr/sbin/lsof':'lsof',['-t','--',file],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim().split(/\s+/).filter(pid=>pid && Number(pid)!==process.pid);
        assert(!pids.length,'This session file is in use. Close this session and retry.',409);
    } catch(error) { if(error.status===1&&!String(error.stderr||'').trim())return; if(error.status===409)throw error; throw new Error('Cannot check whether this session file is in use.'); }
}
async function archiveCodex(native, instance) {
    const file=path.join(native.roots.codex,'state_5.sqlite');if(!fs.existsSync(file))return;
    const read=()=>{const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare('SELECT archived,rollout_path FROM threads WHERE id=?').get(instance.nativeId);}finally{db.close();}};
    let row=read();if(!row)return;
    if(!row.archived){const client=connect(codexBinary(),native.roots.codex);try{await client.init();await client.request('thread/archive',{threadId:instance.nativeId});}finally{await client.close();}row=read();}
    assert(row?.archived,'The client could not archive this session. Stop its current task and retry.');
    assert(inside(native.roots.codex,row.rollout_path),'Native copy is outside managed storage.');
    instance.file=row.rollout_path;instance.applied=false;instance.desired=false;instance.nativeArchived=true;
}
function verifiedRecovery(store, entry) {
    if (!entry) return false;
    try {
        const backup=JSON.parse(gunzipSync(fs.readFileSync(path.join(store.root,'trash',entry.id+'.json.gz')),{maxOutputLength:512*1024*1024}).toString());
        return Array.isArray(backup.graph?.branches) && backup.graph.branches.length>0 && bodyRefs(backup.graph).every(h=>typeof backup.objects[h]==='string'&&hash(backup.objects[h])===h);
    } catch { return false; }
}
export async function moveNativeToRecovery(store,native,instanceIds,{checkFile=checkFileIdle,archive=archiveCodex,onProgress=async()=>{}}={}) {
    const candidates=new Set(nativeTrashCandidates(store).map(i=>i.id)),result={moved:[],blocked:[],recoveryIds:[]};
    for(const instanceId of [...new Set(instanceIds)]) {
        let temporary;const target=store.instances().find(i=>i.id===instanceId),detail=target&&(store.find('branch',target.branchId)?.name||target.title);
        const report=progress=>onProgress({...progress,detail});
        try {
            assert(candidates.has(instanceId),'Select an available client copy.');
            await report({phase:'Checking client copy',completed:result.moved.length+result.blocked.length,total:instanceIds.length});
            let i=store.instances().find(i=>i.id===instanceId);
            assert(inside(native.roots[i.agent],i.file)||inside(path.join(store.root,'parked'),i.file),'Native copy is outside managed storage.');
            safePath(inside(store.root,i.file)?store.root:native.roots[i.agent],i.file);
            if(i.agent==='claude') { try { native.guard(['claude']); } catch { throw new Error('Claude is running. Close Claude before moving this copy.'); } }
            checkFile(i.file);
            if(i.agent==='codex') { await report({phase:'Archiving client copy',completed:result.moved.length,total:instanceIds.length});await archive(native,i);store.local('instances',store.instances().map(v=>v.id===i.id?i:v)); }
            safePath(inside(store.root,i.file)?store.root:native.roots[i.agent],i.file);
            checkFile(i.file);
            await report({phase:'Reading client history',completed:result.moved.length,total:instanceIds.length});
            const physical=fs.readFileSync(i.file,'utf8'),stamp=hash(physical),companion=path.join(path.dirname(i.file),i.nativeId);
            const auxiliary=i.agent==='claude'?auxiliarySnapshot(companion):[],companionStamp=i.agent==='claude'?auxiliaryStamp(companion):null;
            const existing=(store.local('trashEntries')||[]).find(e=>!e.expired&&!e.restoredAt&&e.branchIds.includes(i.branchId)&&fs.existsSync(path.join(store.root,'trash',e.id+'.json.gz')));
            if(existing)await report({phase:'Verifying recovery backup',completed:result.moved.length,total:instanceIds.length});
            let entry=stamp===i.observedHash&&!auxiliary.length&&verifiedRecovery(store,existing)?existing:null;
            if(!entry) {
                const original=store.find('branch',i.branchId),raw=native.history(i.file,i.agent);
                const snapshot=temporary=store.branch(original?.projectId,original?.name||i.title||'Session',i.agent,raw,{operation:'import',nativeId:i.nativeId,cwd:i.cwd,...(auxiliary.length?{auxiliary}:{})});
                store.put('branch',{...snapshot,excluded:'recovery-staging'});
                entry=await stageTrashAsync(store,[snapshot.id],[snapshot.id],{onProgress:report,transient:true});
                if(!isTrashed(store,i.branchId) && !store.instances().some(other=>other.id!==i.id&&other.branchId===i.branchId&&other.applied&&!other.nativeArchived&&!other.missing)) {
                    const add=e=>e.id===entry.id?{...e,branchIds:[...e.branchIds,i.branchId],heads:{...e.heads,[i.branchId]:original.head}}:e;
                    store.local('trashPending',(store.local('trashPending')||[]).map(add));store.local('trashEntries',(store.local('trashEntries')||[]).map(add));store.invalidate();
                }
            }
            await report({phase:'Verifying recovery backup',completed:result.moved.length,total:instanceIds.length});
            assert(verifiedRecovery(store,entry),'Recovery verification failed. The client copy was kept.');
            result.recoveryIds.push(entry.id);
            const expiresAt=new Date(Date.now()+preferences(store).trashRetentionDays*86400000).toISOString();
            store.local('trashEntries',(store.local('trashEntries')||[]).map(e=>e.id===entry.id?{...e,expiresAt,nativeInstanceId:i.id}:e));
            assert(hash(fs.readFileSync(i.file))===stamp,'Native history changed. Retry to save its latest version.');
            if(i.agent==='claude')assert(auxiliaryStamp(companion)===companionStamp,'Companion files changed. Retry to save their latest version.');
            i={...i,observedHash:stamp};store.local('instances',store.instances().map(v=>v.id===i.id?i:v));
            await report({phase:'Removing client copy',completed:result.moved.length,total:instanceIds.length});
            const removed=removeTrashNativeCopies(store,native,[i.branchId],{archivedByClient:true,recoverySaved:true,deferCleanup:true,instanceIds:[i.id],checkFile,companionsCaptured:true});
            result.blocked.push(...removed.blocked);if(removed.removed)result.moved.push(i.id);
        } catch(error) {
            if(temporary&&!isTrashed(store,temporary.id)){store.db.prepare('DELETE FROM entities WHERE id IN (?,?)').run(temporary.id,temporary.head);store.invalidate();}
            result.blocked.push({instanceId,reason:error.message});
        }
    }
    await onProgress({phase:'Removing unused local records',completed:0,total:null});cleanupLocal(store);
    await onProgress({phase:'Recovery move finished',completed:instanceIds.length,total:instanceIds.length});
    return result;
}
export function deleteRecoveryCopies(store,entryIds) {
    const ids=new Set(entryIds),entries=store.local('trashEntries')||[];
    assert(ids.size && [...ids].every(id=>entries.some(e=>e.id===id&&!e.expired&&!e.restoredAt)),'Select available recovery copies.');
    for(const id of ids)fs.rmSync(path.join(store.root,'trash',id+'.json.gz'),{force:true});
    store.local('trashEntries',entries.map(e=>ids.has(e.id)?{...e,expired:true,deletedAt:now()}:e));
    cleanupLocal(store);return {deleted:ids.size};
}
export function restoreRecoveryCopies(store,ids) {
    const restored=[],failed=[];
    for(const id of [...new Set(ids)])try{restored.push({id,...restoreTrash(store,id)});}catch(e){failed.push({id,reason:e.message});}
    return {restored,failed};
}
