import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { connect } from './codex-rpc.js';
import { assert, atomic, hash, id, now } from './util.js';

export function codexBinary() {
    if (process.env.GROVE_CODEX_BINARY) return process.env.GROVE_CODEX_BINARY;
    const extensions=path.join(os.homedir(),'.vscode/extensions');
    if(fs.existsSync(extensions)){
        const arch=process.arch==='arm64'?'aarch64':'x86_64';
        const platform={darwin:'macos',win32:'windows',linux:'linux'}[process.platform];
        const candidates=fs.readdirSync(extensions).filter(n=>n.startsWith('openai.chatgpt-')).map(n=>path.join(extensions,n,'bin',platform+'-'+arch,process.platform==='win32'?'codex.exe':'codex')).filter(f=>fs.existsSync(f));
        candidates.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);if(candidates[0])return candidates[0];
    }
    throw new Error('Set GROVE_CODEX_BINARY to the Codex app-server used by your client.');
}
export async function archiveNative(store, native, branchIds, { executable, beforeCommit, archiveBranches = true } = {}) {
    const branches=branchIds.map(id=>store.get('branch',id)), selected=new Set(branchIds);
    const collected=native.collect();assert(!collected.errors.some(e=>store.instances().some(i=>i.id===e.instanceId&&selected.has(i.branchId))),'A selected native session could not be captured.');
    const instances=store.instances().filter(i=>selected.has(i.branchId)&&i.applied&&!i.missing);
    const claude=branches.filter(b=>b.agent==='claude');if(instances.some(i=>i.agent==='claude'))native.guard(['claude']);
    for(const i of instances)assert(!i.pending&&fs.existsSync(i.file)&&hash(fs.readFileSync(i.file))===i.observedHash,'Selected native history changed. Refresh before archiving.',409);
    await beforeCommit?.();
    const journal={id:id(),kind:'native-api-archive',at:now(),status:'prepared',branchIds,completed:[]};
    const file=path.join(store.root,'archive-journals',journal.id+'.json');atomic(file,JSON.stringify(journal));
    let client;const updates=new Map();
    const index=()=>new DatabaseSync(path.join(native.roots.codex,'state_5.sqlite'),{readOnly:true});
    try{
        const codex=instances.filter(i=>i.agent==='codex');
        if(codex.length){client=connect(executable||codexBinary(),native.roots.codex);await client.init();}
        for(const i of codex){
            let db=index(),row;try{row=db.prepare('SELECT archived,rollout_path FROM threads WHERE id=?').get(i.nativeId);}finally{db.close();}
            assert(row,'Native Codex thread is missing.');
            if(!row.archived){await client.request('thread/archive',{threadId:i.nativeId});journal.completed.push(i.nativeId);atomic(file,JSON.stringify(journal));}
            db=index();try{row=db.prepare('SELECT archived,rollout_path FROM threads WHERE id=?').get(i.nativeId);}finally{db.close();}
            assert(row.archived,'Codex did not archive the selected thread.');assert(hash(fs.readFileSync(row.rollout_path))===i.observedHash,'Native archive changed transcript bytes.');updates.set(i.id,row.rollout_path);
        }
        for(const b of claude)native.setActive(b.id,null,false);if(claude.length)native.apply(claude.map(b=>b.id));
        store.transaction(()=>{const current=store.instances();for(const i of current)if(updates.has(i.id)){i.file=updates.get(i.id);i.applied=false;i.desired=false;i.missing=false;const s=fs.statSync(i.file);i.observedStamp=`${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}store.local('instances',current);if(archiveBranches)for(const b of branches)store.edit(b.id,{archived:true});});
        journal.status='complete';atomic(file,JSON.stringify(journal));return{changed:branches.length,journalId:journal.id};
    }catch(e){
        const failed=[];for(const nativeId of journal.completed.reverse()){try{await client.request('thread/unarchive',{threadId:nativeId});}catch{failed.push(nativeId);}}
        journal.status=failed.length?'recovery-needed':'rolled-back';journal.recoveryThreadIds=failed;atomic(file,JSON.stringify(journal));throw e;
    }finally{await client?.close();}
}
