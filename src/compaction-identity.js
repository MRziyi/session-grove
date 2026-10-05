import {hash} from './util.js';

// A rollout timestamp/ordinal describes a physical copy, not a compaction.
// Retain every payload field (including window IDs, opaque bytes and unknown
// fields); sort object keys only. Repeated identical events remain occurrences.
function canonicalNumber(source){
    const match=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
    if(!match)return source;
    let digits=(match[2]+(match[3]||'')).replace(/^0+/,''),exponent=BigInt(match[4]||0)-BigInt((match[3]||'').length);
    if(!digits)return '0';
    const zeros=/0+$/.exec(digits)?.[0].length||0;if(zeros){digits=digits.slice(0,-zeros);exponent+=BigInt(zeros);}
    return match[1]+digits+'e'+exponent;
}
class RecordedNumber { constructor(source){this.source=canonicalNumber(source);} }
const exactRecord=record=>record.raw?JSON.parse(record.raw,(_key,value,context)=>typeof value==='number'&&context?.source?new RecordedNumber(context.source):value):record.value;
const canonical=value=>value instanceof RecordedNumber?value.source:typeof value==='number'?canonicalNumber(JSON.stringify(value)):Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export function identifyCompactions(records,events,agent){
    const occurrences=new Map();
    for(const event of events){
        const record=records[event.line-1].value;
        const exact=exactRecord(records[event.line-1]);
        const result=agent==='codex'?exact.payload:{boundary:((({timestamp,uuid,parentUuid,sessionId,...body})=>body)(exact)),summary:event.summaryLine?exactRecord(records[event.summaryLine-1])?.message:null};
        event.shareable=agent==='codex'?!!(record.payload?.window_id||record.payload?.compaction_response_id||record.payload?.replacement_history?.length||(typeof record.payload?.message==='string'&&record.payload.message.trim())):!!event.summary;
        event.legacyId=hash(JSON.stringify(record));
        event.resultId=hash(JSON.stringify(agent)+':'+canonical(result));
        const occurrence=occurrences.get(event.resultId)||0;occurrences.set(event.resultId,occurrence+1);
        event.id=hash(JSON.stringify(['compaction-v2',event.resultId,occurrence]));
    }
    // Some older paginated forks emit a user-only window snapshot, then replace
    // it with the same window's completed encrypted compaction on the next start.
    // Only this exact shape, with no conversation/tool work between, is a revision.
    if(agent==='codex')for(let i=1;i<events.length;i++){
        const old=events[i-1],event=events[i],a=records[old.line-1].value.payload,b=records[event.line-1].value.payload;
        if(a.window_number==null||a.window_number!==b.window_number||!a.first_window_id||!a.previous_window_id||a.first_window_id!==b.first_window_id||a.previous_window_id!==b.previous_window_id)continue;
        if(a.message&&String(a.message).trim())continue;
        if(!a.replacement_history?.length||!a.replacement_history.every(v=>v.type==='message'&&v.role==='user'))continue;
        if(!b.replacement_history?.some(v=>v.type==='compaction'&&(v.encrypted_content||v.summary||v.text)))continue;
        if(!records.slice(old.line,event.line-1).every(({value:v})=>v?.type==='event_msg'&&['thread_settings_applied','task_started','token_count'].includes(v.payload?.type)))continue;
        const first=exactRecord(records[old.line-1]).payload,next=exactRecord(records[event.line-1]).payload;
        const remainder=({window_id,replacement_history,...rest})=>rest;
        if(canonical(remainder(first))!==canonical(remainder(next))||canonical(first.replacement_history)!==canonical(next.replacement_history.filter(v=>v.type!=='compaction')))continue;
        event.replaces=old.id;old.supersededBy=event.id;
    }
}
export const matchesCompaction=(event,id)=>event.id===id||event.legacyId===id;
export const compactionDisabled=(policy,event)=>(policy?.disabled||[]).some(id=>matchesCompaction(event,id));
export function policyForCompactions(policy,events){
    if(!policy)return undefined;
    return {disabled:events.filter(event=>compactionDisabled(policy,event)).map(event=>event.id).sort()};
}

// Each control belongs to one directed graph edge. Stable event identity still
// recognizes copied history, but never links policies across different edges.
// Consecutive compactions require explicit context-only intermediate points.
export function compactionPaths(paths,nodes=[]){
    const byChat=new Map(nodes.flatMap(n=>n.chatIds.map(id=>[id,n.id]))),groups=new Map();
    const result=paths.map(path=>({...path,context:{...path.context,compactions:path.context.compactions.map(event=>({...event}))}}));
    for(const path of result){
        const boundaries=new Map();
        for(const event of path.context.compactions){
            const previous=path.messages.findLast(m=>m.line<event.line),next=path.messages.find(m=>m.line>event.line);
            const from=byChat.get(previous?.id)||previous?.id||'context-start:'+path.branchId;
            const index=path.nodeIds?.indexOf(from)??-1;
            const to=byChat.get(next?.id)||next?.id||(index>=0?path.nodeIds[index+1]:null)||'context-end:'+path.branchId;
            const key=JSON.stringify([from,to]);if(!boundaries.has(key))boundaries.set(key,[]);
            boundaries.get(key).push(event);
            Object.assign(event,{baseFrom:from,baseTo:to});
        }
        for(const events of boundaries.values()){
            const steps=[];for(const event of events){if(event.replaces&&steps.at(-1)?.some(e=>e.id===event.replaces))steps.at(-1).push(event);else steps.push([event]);}
            for(let i=0;i<steps.length;i++){
                const primary=steps[i].at(-1),point=index=>'context-between:'+hash(JSON.stringify([primary.baseFrom,primary.baseTo,steps.slice(0,index+1).map(step=>step.at(-1).id)]));
                const edgeFrom=i?point(i-1):primary.baseFrom,edgeTo=i<steps.length-1?point(i):primary.baseTo,groupId=hash(JSON.stringify(['edge-compaction-v1',edgeFrom,edgeTo,primary.id]));
                for(const event of steps[i]){Object.assign(event,{edgeFrom,edgeTo,groupId,controlPrimary:event===primary});if(!groups.has(groupId))groups.set(groupId,[]);groups.get(groupId).push({path,event});}
            }
        }
    }
    for(const members of groups.values()){
        const states=new Set(members.map(({event})=>event.enabled));
        const group={groupSize:new Set(members.map(m=>m.path.branchId)).size,groupMixed:states.size>1,groupEnabled:states.size===1?members[0].event.enabled:null,groupCanDisable:members.every(({path,event})=>path.canRewriteContext&&event.canDisable),groupCanRewrite:members.every(({path})=>path.canRewriteContext)};
        for(const {event} of members)Object.assign(event,group);
    }
    return result;
}
