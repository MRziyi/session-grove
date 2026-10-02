export function projectGroups(items, projects) {
    const names = new Map(projects.map(p => [p.id, p.name])), groups = new Map();
    for (const item of items) {
        const id = item.projectId || '00000000-0000-4000-8000-000000000001';
        if (!groups.has(id)) groups.set(id, { id, name: names.get(id) || 'Ungrouped', items: [], updatedAt: '' });
        const group = groups.get(id); group.items.push(item); if (item.updatedAt > group.updatedAt) group.updatedAt = item.updatedAt;
    }
    for (const g of groups.values()) g.items.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return [...groups.values()].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
export function selectRange(start, end, index, shift = false) {
    if (start === index && (end === null || end === index) && !shift) return { start: null, end: null };
    if (start === null || end !== null && !shift) return { start: index, end: null };
    return { start, end: index };
}

export function inactiveProject(updatedAt, days = 30, at = Date.now()) {
    const stamp = Date.parse(updatedAt);
    return Number.isFinite(stamp) && stamp < at - days * 86400000;
}

export function foldedItems(items, preferences={}, at=Date.now()) {
    const mode=preferences.projectFoldMode||'time';
    if(mode==='none')return items;
    if(mode==='count')return items.slice(0,preferences.projectFoldCount??4);
    return items.filter(i=>!inactiveProject(i.updatedAt,preferences.projectFoldDays??7,at));
}
export function pendingLabels(nodes) {
    const counts=new Map(), labels=new Map();
    for(const n of nodes){const level=n.depth+1,index=(counts.get(level)||0)+1;counts.set(level,index);labels.set(n.id,level===1?'1':level+'.'+index);}
    return labels;
}
export function forkBeforeNode(path,node) {
    if(!path||!node||!path.nodeIds.includes(node.id))return null;
    const position=path.nodeIds.indexOf(node.id);if(position<=0)return null;
    const first=path.messages.find(m=>node.chatIds.includes(m.id));
    const previous=first?path.messages[path.messages.indexOf(first)-1]:path.messages.at(-1);
    if(!previous)return null;
    return path.checkpoints.findLast(c=>c.end>=previous.line&&(!first||c.end<first.line))||null;
}

export function transferStages(operation) {
    const stages = { pull: 'pending', push: 'pending' };
    if (!operation) return stages;
    const step = operation.step || 'pull';
    if (operation.pullComplete || step === 'push') stages.pull = 'complete';
    if (operation.state === 'running') stages[step] = 'running';
    else if (operation.state === 'error') stages[step] = 'failed';
    else if (operation.state === 'interrupted') stages[step] = 'paused';
    else if (operation.state === 'success') { stages.pull = 'complete'; if (operation.direction === 'push' || operation.direction === 'both') stages.push = 'complete'; }
    return stages;
}

export function olderProject(items,preferences={},at=Date.now()) {
    return items.length>0&&foldedItems(items,preferences,at).length===0;
}

// Reserve space for compaction controls before placing node rows. Shared events
// use the shared control groups supplied by the backend, including mixed state.
export function graphLayout(tree,selectedBranchId){
    const nodes=tree.nodes,byNode=new Map(nodes.map(n=>[n.id,n])),positions=new Map(),byChat=new Map();
    for(const n of nodes)for(const id of n.chatIds)byChat.set(id,n);
    let lane=0;
    // Explicit postorder preserves lane order without a recursive call per node.
    const stack=nodes.filter(n=>!n.parentIds.length).reverse().map(n=>({n,expanded:false}));
    while(stack.length){
        const {n,expanded}=stack.pop();if(positions.has(n.id))continue;
        if(!expanded&&n.childIds.length){stack.push({n,expanded:true});for(let i=n.childIds.length-1;i>=0;i--)stack.push({n:byNode.get(n.childIds[i]),expanded:false});continue;}
        const children=n.childIds.map(id=>positions.get(id));
        positions.set(n.id,{x:children.length?children.reduce((sum,p)=>sum+p.x,0)/children.length:lane++*174+12,y:0});
    }
    const compactions=new Map();
    for(const owner of [...tree.paths.filter(p=>p.branchId!==selectedBranchId),...tree.paths.filter(p=>p.branchId===selectedBranchId)]){
        for(const e of owner.context?.compactions||[]){
            const previous=owner.messages.findLast(m=>m.line<e.line),next=owner.messages.find(m=>m.line>e.line);
            const before=byChat.get(previous?.id),after=byChat.get(next?.id);
            if(!before&&!after)continue;
            const key=e.groupId||owner.branchId+':'+e.id;
            const old=compactions.get(key),afterIds=[...new Set([...(old?.afterIds||[]),...(after?[after.id]:[])])];
            compactions.set(key,{key,owner,e,before,after,afterIds,depth:before?.depth??-1,x:positions.get((after||before).id).x+74});
        }
    }
    // An inherited compaction can precede a later fork: one shared stem fans
    // out to all following nodes. Independent results get separate connectors.
    for(const c of compactions.values())if(c.afterIds.length>1)c.x=positions.get(c.before.id).x+74;
    const bands=new Map();
    for(const c of [...compactions.values()].sort((a,b)=>a.depth-b.depth||a.x-b.x||a.key.localeCompare(b.key))){
        if(!bands.has(c.depth))bands.set(c.depth,[]);
        const rows=bands.get(c.depth);let row=rows.findIndex(xs=>xs.every(x=>Math.abs(x-c.x)>=148));
        if(row<0){row=rows.length;rows.push([]);}rows[row].push(c.x);c.row=row;
    }
    const depthY=new Map(),bandY=new Map();let y=12;
    if(bands.has(-1)){bandY.set(-1,y);y+=bands.get(-1).length*28+12;}
    let maxDepth=0;const endpointDepths=new Set();
    for(const n of nodes){maxDepth=Math.max(maxDepth,n.depth);if(n.endBranchIds.length)endpointDepths.add(n.depth);}
    for(let depth=0;depth<=maxDepth;depth++){
        depthY.set(depth,y);
        const body=endpointDepths.has(depth)?110:80;
        bandY.set(depth,y+body+8);
        y+=Math.max(116,body+16+(bands.get(depth)?.length||0)*28);
    }
    for(const n of nodes)positions.get(n.id).y=depthY.get(n.depth);
    const controls=[...compactions.values()].map(c=>({...c,y:bandY.get(c.depth)+c.row*28+12}));
    const connections=tree.edges.map(edge=>({...edge,controls:controls.filter(c=>c.before?.id===edge.from&&c.afterIds.includes(edge.to))}));
    for(const c of controls)if(!connections.some(edge=>edge.controls.includes(c)))connections.push({from:c.before?.id,to:c.after?.id,controls:[c]});
    const edges=connections.map(edge=>{
        const from=edge.from&&positions.get(edge.from),to=edge.to&&positions.get(edge.to),points=[...(from?[{x:from.x+74,y:from.y+80}]:[]),...edge.controls.sort((a,b)=>a.y-b.y),...(to?[{x:to.x+74,y:to.y}]:[])];
        const d=points.map((p,i)=>{if(!i)return `M${p.x},${p.y}`;const a=points[i-1],mid=(a.y+p.y)/2;return `C${a.x},${mid} ${p.x},${mid} ${p.x},${p.y}`;}).join(' ');
        return {...edge,d};
    });
    return {positions,controls,edges,width:Math.max(180,lane*174),height:Math.max(160,y),rootX:(positions.get(nodes.find(n=>!n.parentIds.length)?.id)?.x||0)+74};
}
