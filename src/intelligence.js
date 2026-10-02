import {writePrivateFile} from './private-file.js';
import path from 'node:path';
import { json, assert, hash, now } from './util.js';
import { rootOf } from './organization.js';
import { isTrashed } from './trash.js';
import { INBOX_ID } from './inbox.js';
import { BACKGROUND_PROJECT } from './session-kind.js';
import { namingEvidence, sessionEvidence } from './intelligence-text.js';
import { MODEL, requestName } from './intelligence-api.js';
const ungrouped = b => !b.projectId || b.projectId === INBOX_ID;
const nameable=(store,b)=>b&&!b.synthetic&&!b.excluded&&!b.background&&!b.scheduled&&!isTrashed(store,b.id);
const active = (store,b) => b && !b.archived && !b.excluded && !isTrashed(store,b.id) && !(b.projectId && store.find('project',b.projectId)?.archived);
export function nodeEvidence(store, graph, node) {
    for (const branchId of node.branchIds) {
        const route=graph.paths.find(p=>p.branchId===branchId), branch=store.get('branch',branchId);
        if(!active(store,branch))continue;
        const messages=route.messages.filter(m=>node.chatIds.includes(m.id));
        if(!messages.length)continue;
        const evidence=namingEvidence(store.parsed(branch.head,branch.agent).records,branch.agent,{start:Math.ceil(messages[0].line)-1,end:Math.floor(messages.at(-1).line)});
        if(evidence)return {branchId,evidence};
    }
    return null;
}
export class Intelligence {
    constructor(store,{request=requestName,onChange=()=>{},onStatus=()=>{},canApply=()=>true}={}) {
        Object.assign(this,{store,request,onChange,onStatus,canApply});
        this.file=path.join(store.root,'intelligence.json');
        this.data=store.local('intelligenceState') || {seen:{},trees:{},waiting:[],jobs:[]};
        this.running=false;this.closed=false;this.error=this.data.error||null;this.timer=null;this.generation=0;this.tasks=new Map();this.lastStartedAt=0;
        // Preserve existing node labels; backfill missing session-name provenance when enabled.
        this.observe(false);this.kick();
    }
    config(){return {classify:false,nameNodes:false,concurrency:2,minIntervalSeconds:0,...json(this.file,{})};}
    get pending(){return this.tasks.size?Promise.allSettled([...this.tasks.values()].map(task=>task.promise)):null;}
    status(){const c=this.config();return {model:MODEL,hasKey:!!c.apiKey,classify:c.classify,nameNodes:c.nameNodes,concurrency:c.concurrency,minIntervalSeconds:c.minIntervalSeconds,activeRequests:this.tasks.size,running:this.running,pending:this.data.jobs.length,waitingForEvidence:c.classify?this.data.waiting.filter(id=>!this.data.jobs.some(j=>j.kind!=='node'&&j.id===id)).length:0,phase:this.phase||null,current:this.current||null,error:this.error,completed:this.completed||0};}
    publish(){this.onStatus(this.status());}
    persist(){this.data.error=this.error;this.store.local('intelligenceState',this.data);}
    async save(body){
        const previous=this.config(),next={...previous};
        for(const key of ['classify','nameNodes'])if(key in body){assert(typeof body[key]==='boolean','Choose a smart organization setting.');next[key]=body[key];}
        if('concurrency' in body){assert(Number.isInteger(body.concurrency)&&body.concurrency>=1&&body.concurrency<=4,'Choose 1 to 4 concurrent requests.');next.concurrency=body.concurrency;}
        if('minIntervalSeconds' in body){assert(Number.isFinite(body.minIntervalSeconds)&&body.minIntervalSeconds>=0&&body.minIntervalSeconds<=60,'Choose a request interval from 0 to 60 seconds.');next.minIntervalSeconds=body.minIntervalSeconds;}
        if('apiKey' in body){assert(typeof body.apiKey==='string'&&body.apiKey.length<500,'Enter an API key.');next.apiKey=body.apiKey.trim();
            if(next.apiKey){await this.request(next.apiKey,'node',{user:'Verify connection',assistant:'Connection verified'});next.classify=true;next.nameNodes=true;}}
        if(body.removeKey){next.apiKey='';next.classify=false;next.nameNodes=false;}
        assert(!(next.classify||next.nameNodes)||next.apiKey,'Add an API key first.');
        writePrivateFile(this.file,JSON.stringify(next));
        if(['apiKey','classify','nameNodes'].some(key=>next[key]!==previous[key])){this.generation++;for(const task of this.tasks.values())task.controller.abort();}
        if(next.classify&&!previous.classify || next.nameNodes&&!previous.nameNodes)this.observe();
        this.error=null;this.data.jobs=this.data.jobs.filter(j=>next[j.kind==='node'?'nameNodes':'classify']);
        this.persist();this.publish();this.kick();return this.status();
    }
    observe(enqueue=true){
        if(this.closed)return;
        const c=this.config(),branches=this.store.all('branch'),roots=new Map();
        for(const b of branches){
            if(!this.data.seen[b.id]&&enqueue&&c.classify&&!b.archived&&!isTrashed(this.store,b.id)&&ungrouped(b)&&!b.parentId&&!b.synthetic)this.data.waiting.push(b.id);
            this.data.seen[b.id]=true;
            if(active(this.store,b)&&!b.synthetic&&b.head){const root=rootOf(this.store,b.id);if(!roots.has(root.id))roots.set(root.id,[]);roots.get(root.id).push(b);}
        }
        // Seeing or filing a session is not evidence of a successful naming pass.
        // Every normal session receives one result, including old sessions and forks.
        this.data.waiting=branches.filter(b=>(nameable(this.store,b)||b.excluded==='empty'&&!isTrashed(this.store,b.id))&&!b.automaticName).map(b=>b.id);
        if(c.classify)for(const id of this.data.waiting){
            if(this.data.jobs.some(j=>j.id===id&&j.kind!=='node'))continue;
            const b=this.store.get('branch',id);if(!this.store.find('revision',b.head))continue;
            const evidence=sessionEvidence(this.store.parsed(b.head,b.agent).records,b.agent,b.forkEnd||0);
            const kind=active(this.store,b)&&ungrouped(b)&&!b.parentId&&!b.groveNamed?'classify':'session';
            if(evidence)this.data.jobs.push({key:kind+':'+id,kind,id,name:b.name,metaVersion:b.metaVersion,userHash:hash(evidence.user)});
        }
        // Only build changed graphs while node naming is enabled.
        if(c.nameNodes)for(const [id,members] of roots){
            const signature=hash(JSON.stringify([this.store.get('branch',id).layoutHead,members.map(b=>[b.id,b.head,b.layoutHead,b.endpointName,b.parentId,b.forkEnd])]));
            if(this.data.trees[id]?.signature===signature)continue;
            if(members.length<2){this.data.trees[id]={signature,splits:[]};continue;}
            let graph;try{graph=this.store.treeGraph(id,'in-use');}catch{continue;}
            const before=new Set(this.data.trees[id]?.splits||[]),splits=graph.nodes.filter(n=>n.childIds.length>1||graph.assignments[n.chatIds[0]]?.nameOrigin==='automatic');
            for(const node of splits){
                const annotation=graph.assignments[node.chatIds[0]],changed=annotation?.nameOrigin==='automatic'&&annotation.chatHash!==hash(JSON.stringify(node.chatIds));
                if(!enqueue||node.empty||!changed&&(before.has(node.id)||node.name))continue;
                const key='node:'+id+':'+node.id;
                if(!this.data.jobs.some(j=>j.key===key))this.data.jobs.push({key,kind:'node',id,nodeId:node.id,chats:node.chatIds,name:node.name||null});
            }
            this.data.trees[id]={signature,splits:splits.map(n=>n.id)};
        }
        this.persist();if(enqueue){this.publish();this.kick();}
    }
    prepare(job){
        const b=this.store.find('branch',job.id);
        if(job.kind==='node'?!b:!nameable(this.store,b))return null;
        if(job.kind!=='node'){
            if(b.automaticName||b.name!==job.name||b.metaVersion!==job.metaVersion)return null;
            if(job.kind==='classify'&&(!ungrouped(b)||b.parentId))return null;
            const parsed=this.store.parsed(b.head,b.agent),evidence=sessionEvidence(parsed.records,b.agent,b.forkEnd||0);
            if(!evidence||hash(evidence.user)!==job.userHash)return null;
            evidence.workspace=parsed.cwd?.split(/[\\/]/).filter(Boolean).slice(-2).join('/')||'';
            return {evidence,branch:b,projects:this.store.all('project').filter(p=>!p.archived&&p.id!==BACKGROUND_PROJECT&&p.id!==INBOX_ID).map(p=>({id:p.id,name:p.name}))};
        }
        const graph=this.store.treeGraph(job.id,'in-use'),node=graph.nodes.find(n=>n.id===job.nodeId);
        if(!node||(node.name||null)!==(job.name||null)||JSON.stringify(node.chatIds)!==JSON.stringify(job.chats))return null;
        const evidence=nodeEvidence(this.store,graph,node);
        return evidence?{...evidence,graph,node}:null;
    }
    kick(){
        clearTimeout(this.timer);
        if(this.closed||this.error||!this.data.jobs.some(job=>!this.tasks.has(job.key)))return;
        const config=this.config();if(!config.apiKey||!config.classify&&!config.nameNodes)return;
        if(this.tasks.size>=config.concurrency)return;
        if(!this.canApply()){this.timer=setTimeout(()=>this.kick(),500);this.timer.unref?.();return;}
        this.timer=setTimeout(()=>{this.run();this.kick();},Math.max(25,this.lastStartedAt+config.minIntervalSeconds*1000-Date.now()));this.timer.unref?.();
    }
    retry(){this.error=null;this.persist();this.publish();this.kick();return this.status();}
    run(){
        if(this.closed||this.error)return;
        if(!this.canApply())return;
        const job=this.data.jobs.find(job=>!this.tasks.has(job.key));if(!job)return;
        const c=this.config();if(!c.apiKey||this.tasks.size>=c.concurrency)return;
        if(!c[job.kind==='node'?'nameNodes':'classify']){this.finish(job);return;}
        let prepared;
        try{prepared=this.prepare(job);}catch{prepared=null;}
        if(!prepared){this.finish(job);return;}
        const generation=this.generation,task={job,controller:new AbortController(),name:this.store.get('branch',job.id).name};this.tasks.set(job.key,task);this.lastStartedAt=Date.now();this.updateActivity();this.publish();
        task.promise=(async()=>{
        try {
            const result=await this.request(c.apiKey,job.kind,prepared.evidence,prepared.projects||[],{signal:task.controller.signal});
            if(this.closed||generation!==this.generation)return;
            // Delay only the metadata write while local capture or Trash owns the store.
            while(!this.canApply()) {await new Promise(r=>setTimeout(r,100));if(this.closed||generation!==this.generation)return;}
            const latest=this.prepare(job);
            const evidenceHash=value=>hash(JSON.stringify(job.kind==='classify'?{user:value.user,workspace:value.workspace}:value));
            if(!latest||evidenceHash(latest.evidence)!==evidenceHash(prepared.evidence)){
                // A manual rename/move wins, but a completed model pass is still
                // recorded rather than silently scheduling the same paid work again.
                const branch=this.store.find('branch',job.id);
                if(job.kind!=='node'&&nameable(this.store,branch)&&!branch.automaticName){
                    const evidence=sessionEvidence(this.store.parsed(branch.head,branch.agent).records,branch.agent,branch.forkEnd||0);
                    if(evidence&&hash(evidence.user)===job.userHash){this.recordName(job.id,result,prepared.evidence);this.onChange(job.id);}
                }
                this.finish(job);return;
            }
            if(job.kind!=='node'){
                if(job.kind==='classify'&&result.project_id&&!latest.projects.some(p=>p.id===result.project_id)){this.finish(job);return;}
                // Keep names established manually; classification changes Grove metadata only.
                if(job.kind==='classify'&&result.project_id)this.store.moveItems({itemIds:[job.id],projectId:result.project_id});
                else if(job.kind==='classify'&&result.new_project){const existing=latest.projects.find(p=>p.name.normalize('NFKC').toLocaleLowerCase()===result.new_project.trim().normalize('NFKC').toLocaleLowerCase());this.store.moveItems({itemIds:[job.id],...(existing?{projectId:existing.id}:{projectName:result.new_project.trim()})});}
                if(!latest.branch.groveNamed||latest.branch.nameOrigin==='automatic')this.store.edit(job.id,{name:result.name},{automatic:true});
                this.recordName(job.id,result,prepared.evidence);
            }else this.store.organize(job.id,{version:latest.graph.version,pathId:latest.branchId,nodeId:latest.node.id,action:'rename',name:result.name,nameOrigin:'automatic',evidenceHash:evidenceHash(prepared.evidence)});
            this.onChange(job.id);this.completed=(this.completed||0)+1;this.finish(job);
        }catch(error){if(!this.closed&&generation===this.generation){this.error=error.message;this.errorCurrent=task.name;}}
        finally{this.tasks.delete(job.key);this.updateActivity();this.persist();this.publish();this.kick();}
        })();return task.promise;
    }
    recordName(id,result,evidence){this.store.put('branch',{...this.store.get('branch',id),automaticName:{name:result.name,model:MODEL,at:now(),evidenceHash:hash(JSON.stringify(evidence))}});}
    updateActivity(){const tasks=[...this.tasks.values()];this.running=tasks.length>0;this.phase=tasks.length?(tasks.every(t=>t.job.kind==='node')?'Naming branch point':tasks.every(t=>t.job.kind==='classify')?'Classifying session':tasks.every(t=>t.job.kind==='session')?'Naming session':'Smart organization'):null;this.current=this.error?this.errorCurrent:tasks.map(t=>t.name).join(' · ')||null;}
    finish(job){this.data.jobs=this.data.jobs.filter(j=>j.key!==job.key);if(job.kind!=='node')this.data.waiting=this.data.waiting.filter(id=>id!==job.id);this.persist();}
    close(){this.closed=true;this.generation++;clearTimeout(this.timer);for(const task of this.tasks.values())task.controller.abort();}
}
