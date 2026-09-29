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
