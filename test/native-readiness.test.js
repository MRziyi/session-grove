import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from '../src/transcript.js';
import {readyToDeactivate} from '../src/native-readiness.js';
const event=type=>({type:'event_msg',payload:{type}});
const tool={type:'response_item',payload:{type:'function_call',call_id:'cancelled',name:'exec',arguments:'{}'}};
function readiness(records){
    const parsed=parse(records.map(v=>JSON.stringify(v)+'\n').join(''),'codex');
    const store={find:()=>({head:'head',agent:'codex'}),parsed:()=>parsed};
    return {ready:readyToDeactivate(store,{branchId:'branch'}),parsed};
}
test('explicit abort permits deactivation of cancelled tools without creating a checkpoint',()=>{
    const {ready,parsed}=readiness([event('task_started'),tool,event('turn_aborted'),event('token_count'),event('thread_settings_applied')]);
    assert.equal(ready,true);
    assert.equal(parsed.complete,false);
    assert.equal(parsed.checkpoints.length,0);
});
test('an abort never permits new work or malformed trailing records',()=>{
    for(const suffix of [[event('task_started')],[tool],[{type:'response_item',payload:{type:'message',role:'user',content:[]}}]]){
        assert.equal(readiness([event('task_started'),tool,event('turn_aborted'),...suffix]).ready,false);
    }
    const parsed=parse(JSON.stringify(event('turn_aborted'))+'\n{','codex');
    assert.equal(readyToDeactivate({find:()=>({agent:'codex',head:'head'}),parsed:()=>parsed},{branchId:'b'}),false);
    assert.equal(readiness([event('task_started'),tool]).ready,false);
});
