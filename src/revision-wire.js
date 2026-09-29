import { assert } from './util.js';
const valid = h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h);
// Transport-only sharing. Local revisions and original record bytes are unchanged.
export function encodeRevisionRefs(graph) {
    const rows=new Map(graph.revisions.map(r=>[r.id,r])), hints=new Map(graph.branches.filter(b=>b.forkRevision).map(b=>[b.head,b.forkRevision]));
    const bases=new Map(), children=new Map(), ready=[];
    for(const r of rows.values()){
        const base=r.parent||hints.get(r.id);
        if(base&&base!==r.id&&rows.has(base)){bases.set(r.id,base);if(!children.has(base))children.set(base,[]);children.get(base).push(r.id);}else ready.push(r.id);
    }
    const result=new Map();
    for(let cursor=0;cursor<ready.length;cursor++){
        const r=rows.get(ready[cursor]),base=rows.get(bases.get(r.id));let refs=r.refs;
        if(base){let prefix=0;const patches=[];while(prefix<r.refs.length&&prefix<base.refs.length){if(r.refs[prefix]!==base.refs[prefix]){if(patches.length===4)break;patches.push([prefix,r.refs[prefix]]);}prefix++;}
            if(prefix-patches.length>=16)refs={base:base.id,prefix,patches,tail:r.refs.slice(prefix)};
        }
        result.set(r.id,{...r,refs});ready.push(...(children.get(r.id)||[]));
    }
    // A speculative sharing hint may form a cycle. Fall back to literal arrays.
    return {...graph,revisions:graph.revisions.map(r=>result.get(r.id)||r)};
}
export function decodeRevisionRefs(graph) {
    const rows=new Map(graph.revisions.map(r=>[r.id,r])), resolved=new Map();let total=0;
    for(const row of graph.revisions){
        const stack=[],seen=new Set();let current=row;
        while(!resolved.has(current.id)){
            assert(!seen.has(current.id),'Cyclic revision reference encoding.');seen.add(current.id);const refs=current.refs;
            if(Array.isArray(refs)){assert(refs.every(valid),'Invalid revision references.');total+=refs.length;assert(total<=4000000,'Expanded revision references exceed the supported bound.');resolved.set(current.id,refs);break;}
            assert(refs&&typeof refs.base==='string'&&Number.isSafeInteger(refs.prefix)&&refs.prefix>=0&&Array.isArray(refs.patches)&&refs.patches.length<=4&&Array.isArray(refs.tail)&&refs.tail.every(valid),'Invalid revision reference encoding.');
            stack.push(current);current=rows.get(refs.base);assert(current,'Missing revision reference base.');
        }
        while(stack.length){const r=stack.pop(),d=r.refs,base=resolved.get(d.base);assert(d.prefix<=base.length,'Invalid reference prefix length.');const refs=base.slice(0,d.prefix).concat(d.tail);
            for(const patch of d.patches){assert(Array.isArray(patch)&&patch.length===2&&Number.isSafeInteger(patch[0])&&patch[0]>=0&&patch[0]<d.prefix&&valid(patch[1]),'Invalid reference patch.');refs[patch[0]]=patch[1];}
            total+=refs.length;assert(total<=4000000,'Expanded revision references exceed the supported bound.');resolved.set(r.id,refs);
        }
    }
    return {...graph,revisions:graph.revisions.map(r=>({...r,refs:resolved.get(r.id)}))};
}
