import {writePrivateFile} from './private-file.js';
import path from 'node:path';
import { json, assert, hash } from './util.js';
import { rootOf } from './organization.js';
import { isTrashed } from './trash.js';
import { INBOX_ID } from './inbox.js';
import { BACKGROUND_PROJECT } from './session-kind.js';
import { namingEvidence } from './intelligence-text.js';
import { MODEL, requestName } from './intelligence-api.js';
const ungrouped = b => !b.projectId || b.projectId === INBOX_ID;
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
        // Seed existing sessions and fork points without retroactively renaming the library.
        this.observe(false);
    }
    config(){return {classify:false,nameNodes:false,concurrency:2,minIntervalSeconds:0,...json(this.file,{})};}
    get pending(){return this.tasks.size?Promise.allSettled([...this.tasks.values()].map(task=>task.promise)):null;}
    status(){const c=this.config();return {model:MODEL,hasKey:!!c.apiKey,classify:c.classify,nameNodes:c.nameNodes,concurrency:c.concurrency,minIntervalSeconds:c.minIntervalSeconds,activeRequests:this.tasks.size,running:this.running,pending:this.data.jobs.length,phase:this.phase||null,current:this.current||null,error:this.error,completed:this.completed||0};}
    publish(){this.onStatus(this.status());}
    persist(){this.data.error=this.error;this.store.local('intelligenceState',this.data);}
    async save(body){
        const previous=this.config(),next={...previous};
        for(const key of ['classify','nameNodes'])if(key in body){assert(typeof body[key]==='boolean','Choose a smart organization setting.');next[key]=body[key];}
        if('concurrency' in body){assert(Number.isInteger(body.concurrency)&&body.concurrency>=1&&body.concurrency<=4,'Choose 1 to 4 concurrent requests.');next.concurrency=body.concurrency;}
        if('minIntervalSeconds' in body){assert(Number.isFinite(body.minIntervalSeconds)&&body.minIntervalSeconds>=0&&body.minIntervalSeconds<=60,'Choose a request interval from 0 to 60 seconds.');next.minIntervalSeconds=body.minIntervalSeconds;}
        if('apiKey' in body){assert(typeof body.apiKey==='string'&&body.apiKey.length<500,'Enter an API key.');next.apiKey=body.apiKey.trim();
            if(next.apiKey){await this.request(next.apiKey,'node',{user:'Verify connection',assistant:'Connection verified'});}}
        if(body.removeKey){next.apiKey='';next.classify=false;next.nameNodes=false;}
        assert(!(next.classify||next.nameNodes)||next.apiKey,'Add an API key first.');
        writePrivateFile(this.file,JSON.stringify(next));
        if(['apiKey','classify','nameNodes'].some(key=>next[key]!==previous[key])){this.generation++;for(const task of this.tasks.values())task.controller.abort();}
        if(next.classify&&!previous.classify || next.nameNodes&&!previous.nameNodes)this.observe(false);
        this.error=null;this.data.jobs=this.data.jobs.filter(j=>next[j.kind==='classify'?'classify':'nameNodes']);
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
        this.data.waiting=[...new Set(this.data.waiting)].filter(id=>{const b=this.store.find('branch',id);return b&&!b.archived&&!isTrashed(this.store,b.id)&&ungrouped(b)&&!b.parentId;});
        if(enqueue&&c.classify)for(const id of this.data.waiting){
            if(this.data.jobs.some(j=>j.key==='classify:'+id))continue;
            const b=this.store.get('branch',id);if(!active(this.store,b)||!this.store.find('revision',b.head))continue;
            const evidence=namingEvidence(this.store.parsed(b.head,b.agent).records,b.agent);
            if(evidence)this.data.jobs.push({key:'classify:'+id,kind:'classify',id,name:b.name,metaVersion:b.metaVersion,userHash:hash(evidence.user)});
        }
        // Only build changed graphs while node naming is enabled.
        if(c.nameNodes)for(const [id,members] of roots){
            const signature=hash(JSON.stringify(members.map(b=>[b.id,b.head,b.layoutHead,b.endpointName,b.parentId,b.forkEnd])));
            if(this.data.trees[id]?.signature===signature)continue;
            if(members.length<2){this.data.trees[id]={signature,splits:[]};continue;}
            let graph;try{graph=this.store.treeGraph(id,'in-use');}catch{continue;}
            const before=new Set(this.data.trees[id]?.splits||[]),splits=graph.nodes.filter(n=>n.childIds.length>1);
            for(const node of splits){
                if(!enqueue||before.has(node.id)||node.name||node.empty)continue;
                const key='node:'+id+':'+node.id;
                if(!this.data.jobs.some(j=>j.key===key))this.data.jobs.push({key,kind:'node',id,nodeId:node.id,chats:node.chatIds});
            }
            this.data.trees[id]={signature,splits:splits.map(n=>n.id)};
        }
        this.persist();if(enqueue){this.publish();this.kick();}
    }
    prepare(job){
        const b=this.store.find('branch',job.id);
        if(!active(this.store,b))return null;
        if(job.kind==='classify'){
            if(!ungrouped(b)||b.parentId||b.name!==job.name||b.metaVersion!==job.metaVersion)return null;
            const parsed=this.store.parsed(b.head,b.agent),evidence=namingEvidence(parsed.records,b.agent);
            if(!evidence||hash(evidence.user)!==job.userHash)return null;
            evidence.workspace=parsed.cwd?.split(/[\\/]/).filter(Boolean).slice(-2).join('/')||'';
            return {evidence,branch:b,projects:this.store.all('project').filter(p=>!p.archived&&p.id!==BACKGROUND_PROJECT&&p.id!==INBOX_ID).map(p=>({id:p.id,name:p.name}))};
        }
        const graph=this.store.treeGraph(job.id,'in-use'),node=graph.nodes.find(n=>n.id===job.nodeId);
        if(!node||node.name||node.childIds.length<2||JSON.stringify(node.chatIds)!==JSON.stringify(job.chats))return null;
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
        if(!c[job.kind==='classify'?'classify':'nameNodes']){this.finish(job);return;}
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
            if(!latest||evidenceHash(latest.evidence)!==evidenceHash(prepared.evidence)){this.finish(job);return;}
            if(job.kind==='classify'){
                if(result.project_id&&!latest.projects.some(p=>p.id===result.project_id)){this.finish(job);return;}
                // Keep names established manually; classification changes Grove metadata only.
                if(result.project_id)this.store.moveItems({itemIds:[job.id],projectId:result.project_id});
                else if(result.new_project){const existing=latest.projects.find(p=>p.name.normalize('NFKC').toLocaleLowerCase()===result.new_project.trim().normalize('NFKC').toLocaleLowerCase());this.store.moveItems({itemIds:[job.id],...(existing?{projectId:existing.id}:{projectName:result.new_project.trim()})});}
                if(!latest.branch.groveNamed)this.store.edit(job.id,{name:result.name});
            }else this.store.organize(job.id,{version:latest.graph.version,pathId:latest.branchId,nodeId:latest.node.id,action:'rename',name:result.name});
            this.onChange(job.id);this.completed=(this.completed||0)+1;this.finish(job);
        }catch(error){if(!this.closed&&generation===this.generation){this.error=error.message;this.errorCurrent=task.name;}}
        finally{this.tasks.delete(job.key);this.updateActivity();this.persist();this.publish();this.kick();}
        })();return task.promise;
    }
    updateActivity(){const tasks=[...this.tasks.values()];this.running=tasks.length>0;this.phase=tasks.length?(tasks.every(t=>t.job.kind==='node')?'Naming branch point':tasks.every(t=>t.job.kind==='classify')?'Classifying session':'Smart organization'):null;this.current=this.error?this.errorCurrent:tasks.map(t=>t.name).join(' · ')||null;}
    finish(job){this.data.jobs=this.data.jobs.filter(j=>j.key!==job.key);if(job.kind==='classify')this.data.waiting=this.data.waiting.filter(id=>id!==job.id);this.persist();}
    close(){this.closed=true;this.generation++;clearTimeout(this.timer);for(const task of this.tasks.values())task.controller.abort();}
}
