// An activation at a mid-turn boundary can inherit task_started without task_complete.
// Only an unused continuation with no new conversation/tool work may ignore that marker.
export function readyToDeactivate(store,instance) {
    const branch=store.find('branch',instance.branchId);if(!branch)return false;
    const parsed=store.parsed(branch.head,branch.agent);
    if(parsed.errors.length)return false;
    // An explicit client abort settles the turn for archival, even when a
    // cancelled tool has no output. It is not a completed fork checkpoint.
    if(branch.agent==='codex'){
        const lastWork=parsed.records.findLast(({value:v})=>v?.type==='response_item'||v?.type==='event_msg'&&['task_started','task_complete','turn_aborted'].includes(v.payload?.type));
        if(lastWork?.value?.type==='event_msg'&&lastWork.value.payload?.type==='turn_aborted')return true;
    }
    if(parsed.pendingToolCalls)return false;
    if(parsed.complete)return true;
    if(!branch.activationNodeName||!branch.parentId||parsed.messages.some(m=>m.line>branch.forkEnd))return false;
    return parsed.records.slice(branch.forkEnd).every(({value:v})=>v?.type==='token_usage_record'||v?.type==='turn_context'||v?.type==='event_msg'&&['thread_settings_applied','token_count'].includes(v.payload?.type));
}
