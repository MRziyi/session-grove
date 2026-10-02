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
}
export const matchesCompaction=(event,id)=>event.id===id||event.legacyId===id;
export const compactionDisabled=(policy,event)=>(policy?.disabled||[]).some(id=>matchesCompaction(event,id));
export function policyForCompactions(policy,events){
    if(!policy)return undefined;
    return {disabled:events.filter(event=>compactionDisabled(policy,event)).map(event=>event.id).sort()};
}

// Shared control groups are a backend projection, not a display heuristic.
// The preceding shared chat identifies the inherited history location. Different
// results or separate occurrences cannot join even if the visible prose matches.
export function compactionPaths(paths){
    const groups=new Map(),result=paths.map(path=>({...path,context:{...path.context,compactions:path.context.compactions.map(event=>({...event}))}}));
    for(const path of result)for(const event of path.context.compactions){
        const before=path.messages.findLast(m=>m.line<event.line)?.id;
        event.groupId=hash(JSON.stringify([event.id,before||path.branchId,event.shareable===false?path.branchId:null]));
        if(!groups.has(event.groupId))groups.set(event.groupId,[]);
        groups.get(event.groupId).push({path,event});
    }
    for(const members of groups.values()){
        const states=new Set(members.map(({event})=>event.enabled));
        for(const {event} of members)Object.assign(event,{groupSize:members.length,groupMixed:states.size>1,groupEnabled:states.size===1?members[0].event.enabled:null,groupCanDisable:members.every(({path,event})=>path.canRewriteContext&&event.canDisable),groupCanRewrite:members.every(({path})=>path.canRewriteContext)});
    }
    return result;
}
