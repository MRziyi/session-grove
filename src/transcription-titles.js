import fs from 'node:fs';import path from 'node:path';
import {hash,assert,now} from './util.js';
import {namingMessages,shortenAssistant} from './intelligence-text.js';
import {codexBinary} from './native-archive.js';
import {connect} from './codex-rpc.js';
import {codexTitleSupport,refreshCodexTitles} from './client-refresh.js';
import {isActive} from './workspace.js';
import {metadata} from './organization.js';

// Structural keys exclude changing tail text, token counts and node labels.
export function transcriptionPlan(store,branchId,graph=store.treeGraph(branchId,'in-use')){
    const branch=store.get('branch',branchId),route=graph.paths.find(p=>p.branchId===branchId);if(!route)return null;
    const nodes=route.nodeIds.map(id=>graph.nodes.find(n=>n.id===id)),keys=nodes.map(n=>n.id+':'+(n.pending?'pending':'named')).concat(route.context.compactions.map(c=>'compact:'+c.id));
    const completed=nodes.filter((n,i)=>!n.empty&&n.chatIds.length&&(i<nodes.length-1||!n.pending||route.context.compactions.some(c=>c.line>Math.max(...route.messages.filter(m=>n.chatIds.includes(m.id)).map(m=>m.line)))));
    const messages=namingMessages(store.parsed(branch.head,branch.agent).records,branch.agent),evidence=[];
    for(const node of completed){
        const chats=route.messages.filter(m=>node.chatIds.includes(m.id));if(!chats.length)continue;
        const start=Math.ceil(chats[0].line)-1,end=Math.floor(chats.at(-1).line),within=messages.filter(m=>m.line>start&&m.line<=end),users=within.filter(m=>m.role==='user'),last=within.findLast(m=>m.role==='assistant');
        if(!users.length||!last)continue;
        evidence.push({user_requests:users.map(m=>m.text),assistant_result:shortenAssistant(last.text,240)});
    }
    return {branch,keys,keyAliases:Object.fromEntries(route.context.compactions.map(c=>['compact:'+c.legacyId,'compact:'+c.id])),shape:hash(JSON.stringify(keys)),evidence:{nodes:evidence},evidenceHash:hash(JSON.stringify(evidence)),completedNodes:evidence.length};
}
export class TranscriptionTitles {
    constructor(store,native,{support=codexTitleSupport,refresh=refreshCodexTitles,clientFactory=connect,binary=codexBinary}={}){Object.assign(this,{store,native,support,refresh,clientFactory,binary});}
    capabilities(){return this.support();}
    instances(branchId){return this.store.instances().filter(i=>i.branchId===branchId&&i.agent==='codex'&&isActive(i)&&!i.nativeArchived);}
    ready(branchId){return this.capabilities().supported&&this.instances(branchId).length>0&&fs.existsSync(path.join(this.native.roots.codex,'ipc','ipc.sock'));}
    async rename(branchId,title,{signal,expected,validate=()=>true}={}){
        assert(this.ready(branchId),'Open the supported Codex VS Code client to update transcription titles.',409);
        const instances=this.instances(branchId),client=this.clientFactory(this.binary(),this.native.roots.codex),changed=[];
        try{
            await client.init();const snapshots=[];
            for(const instance of instances){
                signal?.throwIfAborted();const read=await client.request('thread/read',{threadId:instance.nativeId,includeTurns:false}),name=read.thread.name||read.thread.preview||'';
                const prior=expected?.[instance.nativeId]??instance.observedTitle??instance.title;
                if(name!==title&&prior&&name!==prior){
                    this.store.local('instances',this.store.instances().map(i=>i.id===instance.id?{...i,title:name,observedTitle:name}:i));
                    this.store.put('branch',metadata(this.store.get('branch',branchId),{transcriptionTitle:name,transcriptionNameOrigin:'manual',originalTitle:name}));
                    throw Object.assign(Error('The client title changed. Its manual name was kept.'),{status:409,code:'CLIENT_TITLE_CHANGED'});
                }snapshots.push({instance,name});
            }
            assert(validate(),'The transcription path changed. Retry with its current nodes.',409);
            for(const {instance,name} of snapshots){
                signal?.throwIfAborted();if(name!==title){await client.request('thread/name/set',{threadId:instance.nativeId,name:title});changed.push({id:instance.nativeId,name});}
                const read=await client.request('thread/read',{threadId:instance.nativeId,includeTurns:false});assert(read.thread.name===title,'The client did not confirm the new transcription title.');
            }
            signal?.throwIfAborted();assert(validate(),'The transcription path changed. Retry with its current nodes.',409);
            const refreshed=await this.refresh(this.native.roots.codex);assert(refreshed.status==='sent','The client title refresh is unavailable. The previous name was restored.',409);signal?.throwIfAborted();
            for(const {instance} of snapshots){const current=await client.request('thread/read',{threadId:instance.nativeId,includeTurns:false});assert(current.thread.name===title,'The client title changed before it could be applied in Grove.',409);}
            this.store.transaction(()=>{
                const ids=new Set(instances.map(i=>i.id));this.store.local('instances',this.store.instances().map(i=>ids.has(i.id)?{...i,title,observedTitle:title}:i));
                const b=this.store.get('branch',branchId);this.store.put('branch',metadata(b,{transcriptionTitle:title,transcriptionNameOrigin:'automatic',originalTitle:title}));
            });return {nativeIds:instances.map(i=>i.nativeId),refresh:refreshed.status,at:now()};
        }catch(error){
            const failed=[];for(const item of changed.reverse())try{const current=await client.request('thread/read',{threadId:item.id,includeTurns:false});if(current.thread.name===title)await client.request('thread/name/set',{threadId:item.id,name:item.name});}catch{failed.push(item.id);}
            if(changed.length)await this.refresh(this.native.roots.codex).catch(()=>{});
            if(failed.length)throw Error('Some client titles could not be rolled back. Update the client list before retrying.');throw error;
        }finally{await client.close();}
    }
}
