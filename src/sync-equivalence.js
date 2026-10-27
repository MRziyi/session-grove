import {isDeepStrictEqual} from 'node:util';
import {id,now} from './util.js';

export const conflictBranchFields=['name','endpointName','archived','group','projectId','parentId','forkRevision','forkEnd','forkParentEnd','contextPolicy','sessionName','sessionNameOrigin'];
export const sameConflictField=(key,a,b)=>key==='contextPolicy'?samePolicy(a,b):key==='archived'?!!a===!!b:isDeepStrictEqual(a??null,b??null);

export function canonicalPolicy(value){
    const {disabled=[],...rest}=value||{};
    return {...rest,...(disabled.length?{disabled:[...new Set(disabled)].sort()}:{})};
}
export const samePolicy=(a,b)=>isDeepStrictEqual(canonicalPolicy(a),canonicalPolicy(b));

// Node UUIDs identify each editing lineage, while the partition of chat IDs
// determines grouping. Require a bijection: equal titles alone are insufficient.
export function equivalentLayouts(a,b){
    if(!a||!b||a.rootId!==b.rootId)return false;
    const left=a.assignments,right=b.assignments,keys=new Set([...Object.keys(left||{}),...Object.keys(right||{})]);
    if(!left||!right)return false;
    const forward=new Map(),backward=new Map();
    for(const key of keys){
        const x=left[key],y=right[key];if(x==null&&y==null)continue;
        if(!x||!y)return false;
        const {id:xi,...xx}=x,{id:yi,...yy}=y;
        if(!isDeepStrictEqual(xx,yy)||forward.has(xi)&&forward.get(xi)!==yi||backward.has(yi)&&backward.get(yi)!==xi)return false;
        forward.set(xi,yi);backward.set(yi,xi);
    }
    return true;
}

export function mergeEquivalentLayouts(store,current,remote){
    const local=store.get('layout',current.layoutHead),other=store.get('layout',remote);
    if(!equivalentLayouts(local,other))return false;
    const pending=[local.id],seen=new Set();
    while(pending.length){const head=pending.pop();if(head===other.id)return true;if(!head||seen.has(head))continue;seen.add(head);const row=store.get('layout',head);pending.push(row.parent,...(row.mergeParents||[]));}
    const merged={...local,id:id(),parent:local.id,mergeParents:[other.id],createdAt:now()};store.put('layout',merged);store.put('branch',{...current,layoutHead:merged.id});return true;
}

// Repair already stored false conflicts as well as preventing new ones. Keep
// the local labels, UUIDs, titles and history; acknowledge both editing lineages.
export function reconcileEquivalentConflicts(store){
    const conflicts=store.local('conflicts')||[];if(!conflicts.length)return 0;
    const apply=()=>{
        const kept=[],repairs=[];
        for(const c of conflicts){
            const kind=c.kind==='project'?'project':'branch',current=store.find(kind,c.local.id);let equivalent=false;
            if(current&&c.kind==='layout'&&current.layoutHead&&store.find('layout',c.remote.layoutHead))equivalent=mergeEquivalentLayouts(store,current,c.remote.layoutHead);
            if(current&&['branch','project'].includes(c.kind)){
                const keys=c.kind==='project'?['name','description','archived']:conflictBranchFields;
                equivalent=keys.every(k=>sameConflictField(k,current[k],c.remote[k]));
                if(equivalent&&c.remote.metaVersion&&current.metaVersion!==c.remote.metaVersion&&!current.metaAncestors?.includes(c.remote.metaVersion))store.put(kind,{...current,metaVersion:id(),metaAncestors:[...new Set([...(current.metaAncestors||[]),...(c.remote.metaAncestors||[]),current.metaVersion,c.remote.metaVersion].filter(Boolean))]});
            }
            if(equivalent)repairs.push({kind:c.kind,id:c.local.id});else kept.push(c);
        }
        if(repairs.length){store.local('conflicts',kept);store.local('equivalentConflictRepairs',[...(store.local('equivalentConflictRepairs')||[]).slice(-49),{at:now(),repairs}]);}
        return repairs.length;
    };
    return store.db.isTransaction?apply():store.transaction(apply);
}
