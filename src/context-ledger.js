import { estimateTokens } from './context.js';
const text = v => typeof v === 'string' ? v : JSON.stringify(v ?? '');
const content = v => typeof v === 'string' ? v : Array.isArray(v) ? v.filter(x=>['text','input_text','output_text','summary_text'].includes(x.type)).map(x=>x.text||'').join('\n') : '';
function fileNames(args) {
    if(typeof args==='string'){try{return fileNames(JSON.parse(args));}catch{return [];}}
    if(!args||typeof args!=='object')return [];
    return [...new Set(Object.entries(args).flatMap(([k,v])=>/^(file_path|filePath|path|filename|file|paths|files)$/.test(k)?(Array.isArray(v)?v:[v]).filter(x=>typeof x==='string'):[]))];
}
export function ledger(parsed, agent) {
    const entries=[],calls=new Map();
    const add=(line,kind,label,body,extra={})=>{const e={id:line+':'+entries.length,line,kind,label,tokens:estimateTokens(body),preview:body.slice(0,180),...extra};entries.push(e);return e;};
    for(const [index,r] of parsed.records.entries()){
        const v=r.value;if(!v)continue;const line=index+1,p=v.payload||{};
        if(agent==='codex'){
            if(v.type==='response_item'){
                if(['function_call','custom_tool_call'].includes(p.type)){const args=p.arguments??p.input??'',e=add(line,'tool-call',p.name||p.type,text(args),{files:fileNames(args),callId:p.call_id});calls.set(p.call_id,e);}
                else if(['function_call_output','custom_tool_call_output'].includes(p.type)){const call=calls.get(p.call_id);add(line,'tool-result',call?.label||p.type,text(p.output),{files:call?.files||[],callId:p.call_id});}
                else if(p.type==='reasoning'){add(line,'reasoning','Reasoning',content(p.summary)+'\n'+content(p.content),{opaque:!!p.encrypted_content});}
                else if(p.type==='message'&&!['user','assistant'].includes(p.role))add(line,'instructions',p.role||'Instructions',content(p.content));
                else if(p.type==='message'){for(const c of Array.isArray(p.content)?p.content:[])if(!['text','input_text','output_text'].includes(c.type))add(line,'attachment',c.type,'',{opaque:true});}
                else add(line,'other',p.type||'Response item','',{opaque:true});
            }
            if(v.type==='session_meta'){
                for(const k of ['base_instructions','developer_instructions','dynamic_tools'])if(p[k])add(line,'instructions',k,text(p[k]));
            }
            if(['turn_context','world_state'].includes(v.type))add(line,'settings',v.type,'',{opaque:true});
        } else {
            for(const c of Array.isArray(v.message?.content)?v.message.content:[]){
                if(c.type==='tool_use'){const e=add(line,'tool-call',c.name||'Tool',text(c.input),{files:fileNames(c.input),callId:c.id});calls.set(c.id,e);}
                else if(c.type==='tool_result'){const call=calls.get(c.tool_use_id);add(line,'tool-result',call?.label||'Tool result',text(c.content),{files:call?.files||[],callId:c.tool_use_id});}
                else if(c.type==='thinking')add(line,'reasoning','Reasoning',c.thinking||'');
                else if(['redacted_thinking','image','document'].includes(c.type))add(line,c.type==='redacted_thinking'?'reasoning':'attachment',c.type,'',{opaque:true});
            }
        }
    }
    const visible=parsed.messages.filter(m=>m.role!=='tool');
    let cursor = -1;
    for(const e of entries){while(cursor+1<visible.length && visible[cursor+1].line<=e.line)cursor++; e.chatLine=visible[cursor]?.line??null;}
    return { entries, totals: Object.fromEntries(['tool-call','tool-result','reasoning','instructions'].map(kind=>[kind,entries.filter(e=>e.kind===kind).reduce((n,e)=>n+e.tokens,0)])), opaqueCount:entries.filter(e=>e.opaque).length };
}
