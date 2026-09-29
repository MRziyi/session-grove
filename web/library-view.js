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
