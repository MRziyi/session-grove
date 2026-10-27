import {assert} from './util.js';

const format='grove-refs-delta-v1';
export const isRevisionDelta=row=>row?.format===format;
export const revisionId=row=>isRevisionDelta(row)?row.data.id:row.id;
export function packRevision(row,base){
    if(!base||base.id===row.id||!Array.isArray(row.refs)||row.refs.length<32)return row;
    let prefix=0;const limit=Math.min(row.refs.length,base.refs.length);
    while(prefix<limit&&row.refs[prefix]===base.refs[prefix])prefix++;
    if(prefix<32)return row;
    const {refs,...data}=row,append=refs.slice(prefix);
    const packed={format,fields:Object.keys(row),data,base:base.id,prefix,append};
    // Short vectors and unrelated rewrites stay self-contained.
    return (append.length*67+JSON.stringify({...packed,append:[]}).length)<refs.length*50?packed:row;
}
export function unpackRevision(row,base){
    assert(isRevisionDelta(row)&&Array.isArray(row.fields)&&row.fields.length<=64&&new Set(row.fields).size===row.fields.length&&row.fields.includes('refs')&&row.data&&typeof row.data.id==='string','Invalid revision delta.');
    assert(base&&base.id===row.base&&Array.isArray(base.refs)&&Number.isSafeInteger(row.prefix)&&row.prefix>=0&&row.prefix<=base.refs.length&&Array.isArray(row.append)&&row.append.every(h=>typeof h==='string'),'Invalid revision prefix.');
    const refs=base.refs.slice(0,row.prefix);for(const h of row.append)refs.push(h);
    return Object.fromEntries(row.fields.map(key=>[key,key==='refs'?refs:Object.hasOwn(row.data,key)?row.data[key]:undefined]));
}
export function packRevisions(rows){
    const byId=new Map(rows.map(row=>[row.id,row]));
    return rows.map(row=>packRevision(row,byId.get(row.parent)));
}
export function unpackRevisions(rows){
    const encoded=new Map(rows.map(row=>[revisionId(row),row])),decoded=new Map();
    assert(encoded.size===rows.length,'Duplicate revision identity.');
    for(const original of rows){
        const stack=[],seen=new Set();let row=original;
        while(isRevisionDelta(row)&&!decoded.has(revisionId(row))){
            const id=revisionId(row);assert(!seen.has(id),'Revision encoding cycle.');seen.add(id);stack.push(row);row=encoded.get(row.base);assert(row,'Missing revision delta base.');
        }
        let base=decoded.get(revisionId(row))||row;decoded.set(base.id,base);
        while(stack.length){const delta=stack.pop();base=unpackRevision(delta,base);decoded.set(base.id,base);}
    }
    return rows.map(row=>decoded.get(revisionId(row)));
}

export function packGraph(graph){return {...graph,revisions:packRevisions(graph.revisions||[])};}
export function unpackGraph(graph){return {...graph,revisions:unpackRevisions(graph.revisions||[])};}
