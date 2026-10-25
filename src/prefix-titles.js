import fs from 'node:fs';
import {assert,hash,inside,now} from './util.js';
import {treeMembers,rootOf,metadata} from './organization.js';
import {isActive} from './workspace.js';
import {isTrashed} from './trash.js';
import {claudeTitle} from './claude-title.js';

export function normalizedPrefix(value){
    assert(typeof value==='string','Enter a prefix.');
    const prefix=value.trim().replace(/^\[([^\[\]]+)\]$/,'$1').trim();
    assert(prefix.length>0&&prefix.length<=40&&!/[\[\]\x00-\x1f\x7f]/.test(prefix),'Enter a prefix (1–40 characters, without brackets).');
    return prefix;
}
export class PrefixTitles{
    constructor(store,native,transcriptions){Object.assign(this,{store,native,transcriptions});}
    plan(treeId){
        const root=rootOf(this.store,treeId),members=treeMembers(this.store,root.id),ids=new Set(members.filter(b=>!b.archived&&!b.synthetic&&!isTrashed(this.store,b.id)&&!(b.projectId&&this.store.find('project',b.projectId)?.archived)).map(b=>b.id));
        const rows=this.store.instances().filter(i=>ids.has(i.branchId)&&isActive(i)&&!i.nativeArchived).map(i=>{
            const name=i.observedTitle||i.title||this.store.get('branch',i.branchId).originalTitle||this.store.get('branch',i.branchId).name;
            const baseName=i.prefixTitle?.title===name?i.prefixTitle.baseName:name;
            const available=i.agent==='codex'?this.transcriptions.ready(i.branchId):i.agent==='claude'&&!!i.file&&fs.existsSync(i.file)&&inside(this.native.roots.claude,i.file);
            return {id:i.id,branchId:i.branchId,nativeId:i.nativeId,agent:i.agent,name,baseName,available};
        });
        const version=hash(JSON.stringify([root.id,members.map(b=>[b.id,b.metaVersion,b.archived,b.parentId]),rows]));
        return {treeId:root.id,version,rows,available:rows.length>0&&rows.every(r=>r.available)};
    }
    async apply(treeId,prefix,version,{onProgress=async()=>{}}={}){
        prefix=normalizedPrefix(prefix);const plan=this.plan(treeId);
        assert(plan.version===version,'Active sessions changed. Review the current titles and retry.',409);
        assert(plan.rows.length,'There are no active sessions in this tree.',409);
        assert(plan.available,'Open the supported client before changing active session titles.',409);
        const rows=plan.rows.map(r=>({...r,title:`[${prefix}] ${r.baseName}`}));
        assert(rows.every(r=>r.title.length<=200),'A prefixed title exceeds 200 characters. Use a shorter prefix.');
        const manager=this.transcriptions,branches=new Set(rows.map(r=>r.branchId));manager.renaming||=new Set();
        assert([...branches].every(id=>!manager.renaming.has(id)),'A transcription title is already being updated.',409);
        for(const id of branches)manager.renaming.add(id);
        let client;const changed=[],snapshots=[];
        const valid=()=>this.plan(treeId).version===version;
        const instance=id=>this.store.instances().find(i=>i.id===id);
        const read=async row=>row.agent==='codex'?(await client.request('thread/read',{threadId:row.nativeId,includeTurns:false})).thread: {name:claudeTitle(this.native.read(instance(row.id).file).split('\n').filter(l=>l.trim()).map(l=>JSON.parse(l))).title};
        const set=async(row,title)=>{
            if(row.agent==='codex')return client.request('thread/name/set',{threadId:row.nativeId,name:title});
            const i=instance(row.id);assert(i&&fs.existsSync(i.file)&&inside(this.native.roots.claude,i.file),'The client session file moved. Update and retry.',409);
            const {renameSession}=await import('@anthropic-ai/claude-agent-sdk');
            await renameSession(row.nativeId,title,{dir:i.cwd,sessionStore:{load:async()=>this.native.read(i.file).split('\n').filter(l=>l.trim()).map(l=>JSON.parse(l)),append:async(_key,entries)=>{fs.appendFileSync(i.file,entries.map(e=>JSON.stringify(e)+'\n').join(''));}}});
        };
        try{
            await onProgress({phase:'Reading client titles',completed:0,total:rows.length});
            if(rows.some(r=>r.agent==='codex')){client=manager.clientFactory(manager.binary(),this.native.roots.codex);await client.init();}
            for(const [index,row]of rows.entries()){
                const current=await read(row),name=current.name||current.preview||row.name;
                if(name!==row.name){
                    this.store.local('instances',this.store.instances().map(i=>i.id===row.id?{...i,title:name,observedTitle:name,prefixTitle:null}:i));
                    const b=this.store.get('branch',row.branchId);this.store.put('branch',metadata(b,{transcriptionTitle:name,transcriptionNameOrigin:'manual',originalTitle:name}));
                    throw Object.assign(new Error('The client title changed. Its manual name was kept.'),{code:'CLIENT_TITLE_CHANGED',status:409});
                }
                snapshots.push({...row,previous:name});await onProgress({phase:'Reading client titles',completed:index+1,total:rows.length,detail:name});
            }
            assert(valid(),'Active sessions changed. Review the current titles and retry.',409);
            for(const [index,row]of snapshots.entries()){
                await onProgress({phase:'Updating client titles',completed:index,total:rows.length,detail:row.title});
                if(row.previous!==row.title){changed.push(row);await set(row,row.title);}
                assert((await read(row)).name===row.title,'The client did not confirm the new transcription title.');
            }
            assert(valid(),'Active sessions changed. Review the current titles and retry.',409);
            if(changed.some(r=>r.agent==='codex')){await onProgress({phase:'Refreshing client titles',completed:rows.length,total:rows.length});assert((await manager.refresh(this.native.roots.codex)).status==='sent','The client title refresh is unavailable. The previous name was restored.',409);}
            for(const row of snapshots)assert((await read(row)).name===row.title,'A client title changed before the batch could be saved.',409);
            assert(valid(),'Active sessions changed. Review the current titles and retry.',409);
            this.store.transaction(()=>{
                const byId=new Map(rows.map(r=>[r.id,r]));
                this.store.local('instances',this.store.instances().map(i=>{const r=byId.get(i.id);return r?{...i,title:r.title,observedTitle:r.title,prefixTitle:{prefix,baseName:r.baseName,title:r.title}}:i;}));
                for(const branchId of branches){const r=rows.find(r=>r.branchId===branchId),b=this.store.get('branch',branchId);this.store.put('branch',metadata(b,{transcriptionTitle:r.title,transcriptionNameOrigin:'manual',originalTitle:r.title}));}
                const claudeIds=[...new Set(rows.filter(r=>r.agent==='claude').map(r=>r.branchId))];
                if(claudeIds.length)assert(!this.native.collect(claudeIds).errors.length,'The renamed Claude history could not be captured.');
            });
            // Feedback failure after commit must not roll native names back alone.
            await onProgress({phase:'Client titles updated',completed:rows.length,total:rows.length}).catch(()=>{});
            return {renamed:changed.length,active:rows.length,branchIds:[...branches],at:now()};
        }catch(error){
            const failed=[];
            if(changed.length)await onProgress({phase:'Restoring previous titles',completed:0,total:changed.length}).catch(()=>{});
            let restored=0;for(const row of [...changed].reverse()){try{if((await read(row)).name===row.title)await set(row,row.previous);}catch{failed.push(row.id);}finally{await onProgress({phase:'Restoring previous titles',completed:++restored,total:changed.length}).catch(()=>{});}}
            if(changed.some(r=>r.agent==='codex'))await manager.refresh(this.native.roots.codex).catch(()=>{});
            if(failed.length)throw Error(`${failed.length} client titles could not be restored. Update and retry.`);
            throw error;
        }finally{try{await client?.close();}catch{}finally{for(const id of branches)manager.renaming.delete(id);}}
    }
}
