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

// Render the backend's directed-edge controls. Context points make repeated
// compactions explicit without inventing conversation messages or sharing toggles.
export function graphLayout(tree,selectedBranchId){
    const selected=tree.paths.find(p=>p.branchId===selectedBranchId),activeNodes=new Set(selected?.nodeIds||[]),activePairs=new Set();
    for(let i=1;i<(selected?.nodeIds.length||0);i++)activePairs.add(JSON.stringify([selected.nodeIds[i-1],selected.nodeIds[i]]));
    for(const e of selected?.context.compactions||[])if(e.edgeFrom&&e.edgeTo){activeNodes.add(e.edgeFrom);activeNodes.add(e.edgeTo);activePairs.add(JSON.stringify([e.edgeFrom,e.edgeTo]));}
    const nodes=tree.nodes.map((n,rank)=>({...n,rank,depth:0,childIds:[],parentIds:[]})),byNode=new Map(nodes.map(n=>[n.id,n])),positions=new Map();
    const connections=new Map((tree.edges.length?tree.edges:tree.nodes.flatMap(n=>n.childIds.map(to=>({from:n.id,to})))).map(e=>[JSON.stringify([e.from,e.to]),{...e,controls:[]}])) ,compactions=new Map();
    const orderedPaths=[...tree.paths.filter(p=>p.branchId!==selectedBranchId),...tree.paths.filter(p=>p.branchId===selectedBranchId)];
    for(const owner of orderedPaths)for(const e of owner.context?.compactions||[]){
        if(e.controlPrimary===false||!e.edgeFrom||!e.edgeTo)continue;
        for(const id of [e.edgeFrom,e.edgeTo])if(!byNode.has(id)){const node={id,rank:byNode.get(e.baseTo)?.rank??byNode.get(e.baseFrom)?.rank??nodes.length,contextOnly:true,chatIds:[],endBranchIds:[],childIds:[],parentIds:[],color:'color-0'};nodes.push(node);byNode.set(id,node);}
        connections.delete(JSON.stringify([e.baseFrom,e.baseTo]));
        const key=JSON.stringify([e.edgeFrom,e.edgeTo]);
        const c={key:e.groupId,owner,e,before:byNode.get(e.edgeFrom),after:byNode.get(e.edgeTo)};
        if(connections.get(key)?.controls.some(v=>v.key!==c.key))throw Error('Multiple compactions require separate context edges.');
        compactions.set(e.groupId,c);connections.set(key,{from:e.edgeFrom,to:e.edgeTo,controls:[c]});
    }
    // Use the representative chosen for the selected path, without changing scope.
    for(const edge of connections.values())edge.controls=edge.controls.map(c=>compactions.get(c.key));
    for(const edge of connections.values()){byNode.get(edge.from)?.childIds.push(edge.to);byNode.get(edge.to)?.parentIds.push(edge.from);}
    const order=(a,b)=>a.rank-b.rank||a.id.localeCompare(b.id);for(const n of nodes)n.childIds.sort((a,b)=>order(byNode.get(a),byNode.get(b)));
    const indegree=new Map(nodes.map(n=>[n.id,n.parentIds.length])),ready=nodes.filter(n=>!n.parentIds.length);for(const n of ready)n.depth=0;
    for(let i=0;i<ready.length;i++){const n=ready[i];for(const id of n.childIds){const child=byNode.get(id);child.depth=Math.max(child.depth||0,n.depth+1);indegree.set(id,indegree.get(id)-1);if(!indegree.get(id))ready.push(child);}}
    if(ready.length!==nodes.length)throw Error('Graph contains an invalid context cycle.');
    let lane=0;const stack=nodes.filter(n=>!n.parentIds.length).sort(order).reverse().map(n=>({n,expanded:false}));
    while(stack.length){const {n,expanded}=stack.pop();if(positions.has(n.id))continue;if(!expanded&&n.childIds.length){stack.push({n,expanded:true});for(let i=n.childIds.length-1;i>=0;i--)stack.push({n:byNode.get(n.childIds[i]),expanded:false});continue;}const children=n.childIds.map(id=>positions.get(id));positions.set(n.id,{x:children.length?children.reduce((sum,p)=>sum+p.x,0)/children.length:lane++*190+12,y:0});}
    const endpoints=new Map();for(const p of tree.paths){const tail=p.context.compactions.findLast(e=>e.edgeTo?.startsWith('context-end:')),id=tail?.edgeTo||p.nodeIds?.at(-1);if(id){if(!endpoints.has(id))endpoints.set(id,[]);endpoints.get(id).push(p);}}
    const controls=[...compactions.values()],bands=new Map();
    for(const c of controls){c.depth=c.after.depth;c.x=positions.get(c.after.id).x+74;}
    for(const c of [...controls].sort((a,b)=>a.depth-b.depth||a.x-b.x||a.key.localeCompare(b.key))){if(!bands.has(c.depth))bands.set(c.depth,[]);const rows=bands.get(c.depth);let row=rows.findIndex(xs=>xs.every(x=>Math.abs(x-c.x)>=148));if(row<0){row=rows.length;rows.push([]);}rows[row].push(c.x);c.row=row;}
    let y=12,maxDepth=0;const endpointDepths=new Set();for(const n of nodes){maxDepth=Math.max(maxDepth,n.depth);if(endpoints.has(n.id))endpointDepths.add(n.depth);}
    const levels=new Map();for(const n of nodes){if(!levels.has(n.depth))levels.set(n.depth,[]);levels.get(n.depth).push(n);}
    for(let depth=0;depth<=maxDepth;depth++){if(depth)y+=Math.max(36,(endpointDepths.has(depth-1)?30:0)+16+(bands.get(depth)?.length||0)*28);for(const n of levels.get(depth)||[])positions.get(n.id).y=y;y+=80;}
    for(const c of controls)c.y=positions.get(c.after.id).y-16-c.row*28;
    // A fan-out is one clean junction plus separate vertical branches. Drawing
    // every long curve over the same narrow band produces a dark unreadable braid.
    const junctions=[],junctionByParent=new Map();
    for(const node of nodes)if(node.childIds.length>1&&new Set(node.childIds.map(id=>byNode.get(id).depth)).size===1){
        const from=positions.get(node.id),xs=node.childIds.map(id=>positions.get(id).x+74),busY=from.y+(endpoints.has(node.id)?110:80)+8;
        const left=xs.reduce((a,x)=>Math.min(a,x),Infinity),right=xs.reduce((a,x)=>Math.max(a,x),-Infinity);junctions.push({from:node.id,d:`M${from.x+74},${from.y+80} L${from.x+74},${busY} M${left},${busY} L${right},${busY}`});junctionByParent.set(node.id,busY);
        const child=node.childIds.find(id=>activePairs.has(JSON.stringify([node.id,id])));if(child)junctions.at(-1).activeD=`M${from.x+74},${from.y+80} L${from.x+74},${busY} L${positions.get(child).x+74},${busY}`;
    }
    const edges=[...connections.values()].map(edge=>{const from=positions.get(edge.from),to=positions.get(edge.to),busY=junctionByParent.get(edge.from),points=[busY===undefined?{x:from.x+74,y:from.y+80}:{x:to.x+74,y:busY},...edge.controls,{x:to.x+74,y:to.y}];const d=points.map((p,i)=>{if(!i)return `M${p.x},${p.y}`;const a=points[i-1],mid=(a.y+p.y)/2;return `C${a.x},${mid} ${p.x},${mid} ${p.x},${p.y}`;}).join(' ');return {...edge,d,active:activePairs.has(JSON.stringify([edge.from,edge.to])),color:byNode.get(edge.to).color||byNode.get(edge.from).color||'color-0',pending:!!byNode.get(edge.to).pending};});
    return {positions,controls,edges,junctions,activeNodes,contextNodes:nodes.filter(n=>n.contextOnly),endpoints,width:Math.max(180,lane*190),height:Math.max(160,y+42),rootX:(positions.get(nodes.find(n=>!n.parentIds.length)?.id)?.x||0)+74};
}


// Keep a short path wholly visible; for a long path show its endpoint and nearby
// ancestors at a readable scale. Only explicit path changes invoke this framing.
export function pathCamera(layout,branchId,width,height){
    const ids=[...layout.activeNodes].filter(id=>layout.positions.has(id)).sort((a,b)=>layout.positions.get(a).y-layout.positions.get(b).y);
    if(!ids.length)return {x:0,y:20,zoom:1};
    const frame=items=>{
        let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
        for(const id of items){const p=layout.positions.get(id);left=Math.min(left,p.x);right=Math.max(right,p.x+148);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y+(layout.endpoints.has(id)?110:80));}
        const zoom=Math.max(.02,Math.min(1,(width-48)/(right-left),(height-48)/(bottom-top)));
        return {x:(width-(right-left)*zoom)/2-left*zoom,y:(height-(bottom-top)*zoom)/2-top*zoom,zoom};
    };
    const all=frame(ids);if(all.zoom>=.65)return all;
    const tail=frame(ids.slice(-3));return tail.zoom>=.75?tail:frame(ids.slice(-1));
}
