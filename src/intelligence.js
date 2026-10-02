import {transcriptionPlan} from './transcription-titles.js';
import {writePrivateFile} from './private-file.js';
import path from 'node:path';
import { json, assert, hash, now } from './util.js';
import { rootOf,metadata } from './organization.js';
import { isTrashed } from './trash.js';
import { INBOX_ID } from './inbox.js';
import { BACKGROUND_PROJECT } from './session-kind.js';
import { namingEvidence, sessionEvidence } from './intelligence-text.js';
import { MODEL, requestName } from './intelligence-api.js';
const settingFor=kind=>kind==='node'?'nameNodes':kind==='transcript'?'nameTranscripts':'classify';
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
    constructor(store,{request=requestName,onChange=()=>{},onStatus=()=>{},canApply=()=>true,transcriptions=null}={}) {
        Object.assign(this,{store,request,onChange,onStatus,canApply,transcriptions});
        this.file=path.join(store.root,'intelligence.json');
        this.data=store.local('intelligenceState') || {seen:{},trees:{},waiting:[],jobs:[]};
        this.running=false;this.closed=false;this.error=this.data.error||null;this.timer=null;this.generation=0;this.tasks=new Map();this.lastStartedAt=0;
        // Preserve existing node labels; backfill missing session-name provenance when enabled.
        this.observe(false);this.kick();
    }
    config(){return {classify:false,nameNodes:false,nameTranscripts:false,concurrency:2,minIntervalSeconds:0,...json(this.file,{})};}
    get pending(){return this.tasks.size?Promise.allSettled([...this.tasks.values()].map(task=>task.promise)):null;}
    status(){const c=this.config();return {model:MODEL,hasKey:!!c.apiKey,classify:c.classify,nameNodes:c.nameNodes,nameTranscripts:c.nameTranscripts,transcriptionSupport:this.transcriptions?.capabilities()||{supported:false,reason:'A compatible Codex VS Code client is required for live transcription-title updates.'},concurrency:c.concurrency,minIntervalSeconds:c.minIntervalSeconds,activeRequests:this.tasks.size,running:this.running,pending:this.data.jobs.length,waitingForEvidence:c.classify?this.data.waiting.filter(id=>!this.data.jobs.some(j=>j.kind!=='node'&&j.id===id)).length:0,phase:this.phase||null,current:this.current||null,error:this.error,completed:this.completed||0};}
    publish(){this.onStatus(this.status());}
    persist(){this.data.error=this.error;this.store.local('intelligenceState',this.data);}
    async save(body){
        const previous=this.config(),next={...previous};
        for(const key of ['classify','nameNodes','nameTranscripts'])if(key in body){assert(typeof body[key]==='boolean','Choose a smart organization setting.');next[key]=body[key];}
        if('concurrency' in body){assert(Number.isInteger(body.concurrency)&&body.concurrency>=1&&body.concurrency<=4,'Choose 1 to 4 concurrent requests.');next.concurrency=body.concurrency;}
        if('minIntervalSeconds' in body){assert(Number.isFinite(body.minIntervalSeconds)&&body.minIntervalSeconds>=0&&body.minIntervalSeconds<=60,'Choose a request interval from 0 to 60 seconds.');next.minIntervalSeconds=body.minIntervalSeconds;}
        if('apiKey' in body){assert(typeof body.apiKey==='string'&&body.apiKey.length<500,'Enter an API key.');next.apiKey=body.apiKey.trim();
            if(next.apiKey){await this.request(next.apiKey,'node',{user:'Verify connection',assistant:'Connection verified'});next.classify=true;next.nameNodes=true;}}
        if(body.removeKey){next.apiKey='';next.classify=false;next.nameNodes=false;next.nameTranscripts=false;}
        assert(!(next.classify||next.nameNodes||next.nameTranscripts)||next.apiKey,'Add an API key first.');
        if(next.nameTranscripts&&!previous.nameTranscripts)assert(this.transcriptions?.capabilities().supported,'A compatible Codex VS Code client is required for live transcription-title updates.');
        writePrivateFile(this.file,JSON.stringify(next));
        if(['apiKey','classify','nameNodes','nameTranscripts'].some(key=>next[key]!==previous[key])){this.generation++;for(const task of this.tasks.values())task.controller.abort();}
        if(next.nameTranscripts&&!previous.nameTranscripts)this.observe(false);
        if(next.classify&&!previous.classify || next.nameNodes&&!previous.nameNodes)this.observe();
        this.error=null;this.data.jobs=this.data.jobs.filter(j=>next[settingFor(j.kind)]);
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
        // A logical Session is one tree (or standalone path), not each native
        // transcription. Migrate the existing naming record without another call.
        const families=this.store.collections().items.filter(item=>item.sessionIds.some(id=>nameable(this.store,this.store.find('branch',id))));
        this.data.jobs=this.data.jobs.filter(j=>['node','transcript'].includes(j.kind)||this.store.find('branch',j.id)&&rootOf(this.store,j.id).id===j.id);
        this.data.waiting=[];
        for(const item of families){
            let root=this.store.get('branch',item.id);
            const sourceId=item.sessionIds.find(id=>nameable(this.store,this.store.find('branch',id))),source=this.store.get('branch',sourceId);
            if(!root.sessionAutomaticName){
                const legacy=root.automaticName||source.automaticName;
                if(legacy){
                    const manual=root.sessionNameOrigin==='manual'||source.nameOrigin==='manual'||source.groveNamed&&!source.nameOrigin;
                    root=this.store.put('branch',metadata(root,{sessionAutomaticName:legacy,sessionName:root.sessionName||item.name,sessionNameOrigin:root.sessionNameOrigin||(manual?'manual':'automatic')}));
                }
            }
            if(root.sessionAutomaticName)continue;
            this.data.waiting.push(root.id);
            if(!c.classify||this.data.jobs.some(j=>j.id===root.id&&['classify','session'].includes(j.kind)))continue;
            const evidence=sessionEvidence(this.store.parsed(source.head,source.agent).records,source.agent);
            const kind=active(this.store,source)&&ungrouped(root)&&root.sessionNameOrigin!=='manual'&&!root.groveNamed?'classify':'session';
            if(evidence)this.data.jobs.push({key:kind+':'+root.id,kind,id:root.id,sourceId,name:root.sessionName||root.name,metaVersion:root.metaVersion,userHash:hash(evidence.user)});
        }
        for(const b of branches.filter(b=>b.excluded==='empty'&&!isTrashed(this.store,b.id))){const root=rootOf(this.store,b.id);if(!root.sessionAutomaticName&&!this.data.waiting.includes(root.id))this.data.waiting.push(root.id);}
        // Only build changed graphs while node naming is enabled.
        if(c.nameNodes)for(const [id,members] of roots){
            const signature=hash(JSON.stringify([this.store.get('branch',id).layoutHead,members.map(b=>[b.id,b.head,b.layoutHead,b.endpointName,b.parentId,b.forkEnd])]));
            if(this.data.trees[id]?.signature===signature&&this.data.trees[id]?.policy===2)continue;
            let graph;try{graph=this.store.treeGraph(id,'in-use');}catch{continue;}
            const compacted=new Set();
            for(const route of graph.paths)for(const event of route.context.compactions){
                const last=route.messages.findLast(m=>m.line<event.line),node=last&&graph.nodes.find(n=>n.chatIds.includes(last.id));
                if(node)compacted.add(node.id);
            }
            const before=new Set(this.data.trees[id]?.splits||[]),splits=graph.nodes.filter(n=>n.childIds.length>1||compacted.has(n.id)||graph.assignments[n.chatIds[0]]?.nameOrigin==='automatic');
            for(const node of splits){
                const annotation=graph.assignments[node.chatIds[0]],changed=annotation?.nameOrigin==='automatic'&&annotation.chatHash!==hash(JSON.stringify(node.chatIds));
                if(!enqueue&&!compacted.has(node.id)||node.empty||!changed&&(before.has(node.id)&&!compacted.has(node.id)||node.name))continue;
                const key='node:'+id+':'+node.id;
                if(!this.data.jobs.some(j=>j.key===key))this.data.jobs.push({key,kind:'node',id,nodeId:node.id,chats:node.chatIds,name:node.name||null});
            }
            this.data.trees[id]={signature,policy:2,splits:splits.map(n=>n.id)};
        }
        if(c.classify)this.syncFirstTitles(roots);
        if(c.nameTranscripts)this.observeTranscriptions(branches,enqueue);
        this.persist();if(enqueue){this.publish();this.kick();}
    }
    syncFirstTitles(roots){
        const cache=this.data.firstTitles||={};
        for(const [rootId,members] of roots){
            const root=this.store.get('branch',rootId);if(!root.layoutHead)continue;
            const signature=hash(JSON.stringify([root.layoutHead,members.map(b=>[b.id,b.nameOrigin,b.automaticName?.at])]));
            if(cache[rootId]===signature)continue;
            const graph=this.store.treeGraph(rootId,'all');
            const first=graph.paths[0]&&graph.nodes.find(n=>n.id===graph.paths[0].nodeIds[0]);
            if(first?.name&&root.sessionNameOrigin!=='manual'&&!(!root.sessionNameOrigin&&(root.nameOrigin==='manual'||root.groveNamed&&!root.nameOrigin))){
                if(root.sessionName!==first.name){
                    this.store.put('branch',metadata(root,{sessionName:first.name,sessionNameOrigin:'automatic',sessionAutomaticName:root.sessionAutomaticName||{name:first.name,basis:'first-node',nodeId:first.id,at:now(),model:graph.assignments[first.chatIds[0]]?.nameOrigin==='automatic'?MODEL:null}}));
                    this.onChange(rootId);
                }
            }
            cache[rootId]=signature;
        }
    }
    observeTranscriptions(branches,enqueue){
        const paths=this.data.transcriptPaths||={};
        for(const b of branches){
            if(!active(this.store,b)||b.agent!=='codex'||b.synthetic||b.transcriptionNameOrigin==='manual'||!this.transcriptions?.instances(b.id).length)continue;
            let plan;try{plan=transcriptionPlan(this.store,b.id);}catch{continue;}if(!plan)continue;
            let saved=paths[b.id];
            if(!saved){saved=paths[b.id]={keys:!enqueue||plan.keys.length<2?plan.keys:[],lastEvidenceHash:null};}
            const added=plan.keys.some(key=>!saved.keys.includes(key));
            if(!added||plan.evidenceHash===saved.lastEvidenceHash){saved.keys=plan.keys;continue;}
            if(!plan.completedNodes)continue;
            const key='transcript:'+b.id,old=this.data.jobs.find(j=>j.key===key),waitingForClient=!this.transcriptions.ready(b.id);
            if(old){old.waitingForClient=waitingForClient;continue;}
            this.data.jobs.push({key,kind:'transcript',id:b.id,shape:plan.shape,keys:plan.keys,evidenceHash:plan.evidenceHash,waitingForClient,expectedNames:Object.fromEntries(this.transcriptions.instances(b.id).map(i=>[i.nativeId,i.observedTitle||i.title]))});
        }
    }
    prepare(job){
        const b=this.store.find('branch',job.id);
        if(job.kind==='transcript'){
            if(!active(this.store,b)||b.transcriptionNameOrigin==='manual')return null;
            const plan=transcriptionPlan(this.store,b.id);
            return plan?.shape===job.shape&&plan.evidenceHash===job.evidenceHash?{...plan,branch:b}:null;
        }
        if(!b)return null;
        if(job.kind!=='node'){
            const source=this.store.find('branch',job.sourceId||job.id);
            if(!nameable(this.store,source)||b.sessionAutomaticName||(b.sessionName||b.name)!==job.name||b.metaVersion!==job.metaVersion)return null;
            if(job.kind==='classify'&&!ungrouped(b))return null;
            const parsed=this.store.parsed(source.head,source.agent),evidence=sessionEvidence(parsed.records,source.agent);
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
        if(this.closed||this.error||!this.data.jobs.some(job=>!this.tasks.has(job.key)&&!job.waitingForClient))return;
        const config=this.config();if(!config.apiKey||!config.classify&&!config.nameNodes&&!config.nameTranscripts)return;
        if(this.tasks.size>=config.concurrency)return;
        if(!this.canApply()){this.timer=setTimeout(()=>this.kick(),500);this.timer.unref?.();return;}
        this.timer=setTimeout(()=>{this.run();this.kick();},Math.max(25,this.lastStartedAt+config.minIntervalSeconds*1000-Date.now()));this.timer.unref?.();
    }
    retry(){this.error=null;this.observe();this.persist();this.publish();this.kick();return this.status();}
    run(){
        if(this.closed||this.error)return;
        if(!this.canApply())return;
        const job=this.data.jobs.find(job=>!this.tasks.has(job.key)&&!job.waitingForClient);if(!job)return;
        const c=this.config();if(!c.apiKey||this.tasks.size>=c.concurrency)return;
        if(!c[settingFor(job.kind)]){this.finish(job);return;}
        if(job.kind==='transcript'&&!this.transcriptions.ready(job.id)){job.waitingForClient=true;this.persist();this.publish();return;}
        let prepared;
        try{prepared=this.prepare(job);}catch{prepared=null;}
        if(!prepared){this.finish(job);if(job.kind==='transcript')this.observe();return;}
        const generation=this.generation,task={job,controller:new AbortController(),name:this.store.get('branch',job.id).name};this.tasks.set(job.key,task);this.lastStartedAt=Date.now();this.updateActivity();this.publish();
        task.promise=(async()=>{
        try {
            const cached=job.kind==='transcript'&&(job.result||this.data.transcriptResults?.[job.evidenceHash]);
            let request;
            if(!cached){
                if(job.kind==='transcript'){
                    this.titleRequests||=new Map();request=this.titleRequests.get(job.evidenceHash);
                    if(!request){request=this.request(c.apiKey,job.kind,prepared.evidence,[],{signal:task.controller.signal});this.titleRequests.set(job.evidenceHash,request);request.finally(()=>this.titleRequests.delete(job.evidenceHash)).catch(()=>{});}
                }else request=this.request(c.apiKey,job.kind,prepared.evidence,prepared.projects||[],{signal:task.controller.signal});
            }
            const result=cached||await request;
            if(job.kind==='transcript'&&!cached){job.result={name:result.name};(this.data.transcriptResults||={})[job.evidenceHash]=job.result;const keys=Object.keys(this.data.transcriptResults);for(const key of keys.slice(0,Math.max(0,keys.length-512)))delete this.data.transcriptResults[key];this.persist();}
            if(this.closed||generation!==this.generation)return;
            // Delay only the metadata write while local capture or Trash owns the store.
            while(!this.canApply()) {await new Promise(r=>setTimeout(r,100));if(this.closed||generation!==this.generation)return;}
            const latest=this.prepare(job);
            const evidenceHash=value=>hash(JSON.stringify(job.kind==='classify'?{user:value.user,workspace:value.workspace}:value));
            if(!latest||evidenceHash(latest.evidence)!==evidenceHash(prepared.evidence)){
                // A manual rename/move wins, but a completed model pass is still
                // recorded rather than silently scheduling the same paid work again.
                const branch=this.store.find('branch',job.id);
                if(!['node','transcript'].includes(job.kind)&&branch&&!branch.sessionAutomaticName){
                    const source=this.store.find('branch',job.sourceId||job.id);
                    const evidence=source&&sessionEvidence(this.store.parsed(source.head,source.agent).records,source.agent);
                    if(evidence&&hash(evidence.user)===job.userHash){this.recordName(job.id,result,prepared.evidence);this.onChange(job.id);}
                }
                this.finish(job);return;
            }
            if(job.kind==='transcript'){
                const renamed=await this.transcriptions.rename(job.id,result.name,{signal:task.controller.signal,expected:job.expectedNames,validate:()=>!!this.prepare(job)});
                this.store.put('branch',{...this.store.get('branch',job.id),transcriptionNaming:{name:result.name,model:MODEL,at:now(),shape:job.shape,evidenceHash:job.evidenceHash,...renamed}});
                this.data.transcriptPaths[job.id]={keys:job.keys,lastEvidenceHash:job.evidenceHash};
            }else if(job.kind!=='node'){
                if(job.kind==='classify'&&result.project_id&&!latest.projects.some(p=>p.id===result.project_id)){this.finish(job);return;}
                // Keep names established manually; classification changes Grove metadata only.
                if(job.kind==='classify'&&result.project_id)this.store.moveItems({itemIds:[job.id],projectId:result.project_id});
                else if(job.kind==='classify'&&result.new_project){const existing=latest.projects.find(p=>p.name.normalize('NFKC').toLocaleLowerCase()===result.new_project.trim().normalize('NFKC').toLocaleLowerCase());this.store.moveItems({itemIds:[job.id],...(existing?{projectId:existing.id}:{projectName:result.new_project.trim()})});}
                if(latest.branch.sessionNameOrigin!=='manual'&&(!latest.branch.groveNamed||latest.branch.nameOrigin==='automatic'))this.store.put('branch',metadata(this.store.get('branch',job.id),{sessionName:result.name,sessionNameOrigin:'automatic'}));
                this.recordName(job.id,result,prepared.evidence);
            }else this.store.organize(job.id,{version:latest.graph.version,pathId:latest.branchId,nodeId:latest.node.id,action:'rename',name:result.name,nameOrigin:'automatic',evidenceHash:evidenceHash(prepared.evidence)});
            this.onChange(job.id);this.completed=(this.completed||0)+1;this.finish(job);this.observe();
        }catch(error){if(error.code==='CLIENT_TITLE_CHANGED'){this.finish(job);this.onChange(job.id);}else if(!this.closed&&generation===this.generation){this.error=error.message;this.errorCurrent=task.name;}}
        finally{this.tasks.delete(job.key);this.updateActivity();this.persist();this.publish();this.kick();}
        })();return task.promise;
    }
    recordName(id,result,evidence){const b=this.store.get('branch',id),record={name:result.name,model:MODEL,basis:'session-start',at:now(),evidenceHash:hash(JSON.stringify(evidence))};this.store.put('branch',metadata(b,{sessionAutomaticName:record}));}
    updateActivity(){const tasks=[...this.tasks.values()];this.running=tasks.length>0;this.phase=tasks.length?(tasks.every(t=>t.job.kind==='node')?'Naming branch point':tasks.every(t=>t.job.kind==='classify')?'Classifying session':tasks.every(t=>t.job.kind==='session')?'Naming session':tasks.every(t=>t.job.kind==='transcript')?'Updating transcription title':'Smart organization'):this.data.jobs.some(j=>j.waitingForClient)?'Waiting for Codex client':null;this.current=this.error?this.errorCurrent:tasks.map(t=>t.name).join(' · ')||null;}
    finish(job){this.data.jobs=this.data.jobs.filter(j=>j.key!==job.key);if(!['node','transcript'].includes(job.kind))this.data.waiting=this.data.waiting.filter(id=>id!==job.id);this.persist();}
    close(){this.closed=true;this.generation++;clearTimeout(this.timer);for(const task of this.tasks.values())task.controller.abort();}
}
