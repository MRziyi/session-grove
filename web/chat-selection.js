import {selectRange} from './library-view.js';

// Native completion boundaries include multiple user inputs and assistant updates.
// Older transcripts without checkpoints fall back to adjacent user/assistant runs.
export function turnMessages(messages,index,checkpoints=[]){
    const line=messages[index]?.line;
    if(line===undefined)return [];
    if(checkpoints.length){
        const before=checkpoints.findLast(c=>c.end<line)?.end??-Infinity;
        const after=checkpoints.find(c=>c.end>=line)?.end??Infinity;
        return messages.filter(m=>m.line>before&&m.line<=after);
    }
    let start=index,end=index;
    if(messages[index].role==='assistant'){
        while(start>0&&messages[start-1].role==='assistant')start--;
        while(start>0&&messages[start-1].role==='user')start--;
    }else while(start>0&&messages[start-1].role==='user')start--;
    end=start;
    while(end<messages.length&&messages[end].role==='user')end++;
    while(end<messages.length&&messages[end].role==='assistant')end++;
    return messages.slice(start,Math.max(index+1,end));
}
export function selectChats(messages,selected,index,mode='turn',start=null,end=null,shift=false,checkpoints=[]){
    if(mode==='range'){
        const range=selectRange(start,end,index,shift),last=range.end??range.start;
        return {...range,chats:new Set(range.start===null?[]:messages.slice(Math.min(range.start,last),Math.max(range.start,last)+1).map(m=>m.id))};
    }
    const chats=new Set(selected),group=mode==='single'?[messages[index]]:turnMessages(messages,index,checkpoints);
    const remove=chats.has(messages[index].id);
    for(const m of group)remove?chats.delete(m.id):chats.add(m.id);
    let positions=messages.flatMap((m,i)=>chats.has(m.id)?[i]:[]);
    if(positions.length){
        if(remove){
            // Removing an interior message/turn trims the trailing fragment.
            const gap=positions.findIndex((position,i)=>i>0&&position!==positions[i-1]+1);
            if(gap>=0){for(const position of positions.slice(gap))chats.delete(messages[position].id);positions=positions.slice(0,gap);}
        }else{
            // Extend the interval through all intermediate messages, in either direction.
            positions=Array.from({length:positions.at(-1)-positions[0]+1},(_,i)=>positions[0]+i);
            for(const position of positions)chats.add(messages[position].id);
        }
    }
    return {chats:new Set(positions.map(i=>messages[i].id)),start:positions[0]??null,end:positions.at(-1)??null};
}
