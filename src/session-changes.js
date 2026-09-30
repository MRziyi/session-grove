import { hash } from './util.js';
const fingerprint = value => hash(JSON.stringify(value));
const entries = rows => Object.fromEntries(rows.map(row => [row.id, row]));

// Small semantic baselines; original transcript bodies stay in SQLite/Git.
export function changeSnapshot(graph) {
    if (!graph) return null;
    const revisions = entries(graph.revisions), layouts = entries(graph.layouts || []);
    return {
        projects: entries(graph.projects.map(({id,name,description,archived}) => ({id,name,description:description || '',archived:!!archived}))),
        branches: entries(graph.branches.filter(b => !b.synthetic).map(b => {
            const r = revisions[b.head];
            return { id:b.id, name:b.name, projectId:b.projectId, head:b.head, records:r?.refs.length || 0,
                content:fingerprint(r?.refs || []), context:fingerprint(b.contextPolicy || {}), archived:!!b.archived,
                endpoint:b.endpointName || null };
        })),
        nodes: Object.fromEntries(graph.branches.flatMap(b => {
            const assigned = new Map();
            for (const [chat, annotation] of Object.entries(layouts[b.layoutHead]?.assignments || {})) {
                if (!assigned.has(annotation.id)) assigned.set(annotation.id, {name:annotation.name,chats:[]});
                assigned.get(annotation.id).chats.push(chat);
            }
            return [...assigned.values()].map(n => [fingerprint(n.chats.sort()), {name:n.name, branchId:b.id, chats:n.chats}]);
        })),
        // Older libraries may still use immutable named nodes rather than layouts.
        legacyNodes: Object.fromEntries((graph.nodes || []).map(n => [n.id, {name:n.name,branchId:n.branchId}])),
    };
}
export function sessionChanges(before, after, store) {
    const changes = [], add = (kind,label,data={}) => changes.push({kind,label,...data});
    if (!after) return changes;
    for (const b of Object.values(after.branches)) {
        const old = before?.branches[b.id], scope = {sessionId:b.id,session:b.name};
        if (!old) { add('session-added','Session added',scope); continue; }
        if (old.name !== b.name) add('session-renamed','Session renamed: {from} → {to}',{...scope,from:old.name,to:b.name});
        if (old.projectId !== b.projectId) add('session-moved','Moved: {from} → {to}',{...scope,from:before.projects[old.projectId]?.name || 'Ungrouped',to:after.projects[b.projectId]?.name || 'Ungrouped'});
        if (old.content !== b.content) {
            const prior = store.find('revision',old.head), current = store.find('revision',b.head);
            const appended = current && prior && current.refs.length > prior.refs.length && prior.refs.every((h,i)=>current.refs[i]===h);
            add(appended?'transcript-appended':'transcript-updated',appended?'Transcript appended: {count} records':'Transcript updated',{...scope,count:Math.max(0,b.records-old.records)});
        }
        if (old.context !== b.context) add('context-changed','Context settings changed',scope);
        if (old.archived !== b.archived) add('archive-changed',b.archived?'Session archived':'Session restored',scope);
        if (old.endpoint !== b.endpoint) add('node-renamed','Node renamed: {from} → {to}',{...scope,from:old.endpoint || 'Pending',to:b.endpoint || 'Pending'});
    }
    for (const b of Object.values(before?.branches || {})) if (!after.branches[b.id]) add('session-removed','Session removed',{sessionId:b.id,session:b.name});
    for (const p of Object.values(after.projects)) if (before?.projects[p.id] && before.projects[p.id].name !== p.name) add('project-renamed','Project renamed: {from} → {to}',{from:before.projects[p.id].name,to:p.name});
    for (const p of Object.values(after.projects)) {
        const old = before?.projects[p.id];
        if (old && (old.description || '') !== p.description) add('project-description','Project description changed');
        if (old && old.archived !== p.archived) add('project-archive',p.archived?'Project archived':'Project restored');
    }
    if (before) {
        for (const [key,n] of Object.entries({...after.legacyNodes,...after.nodes})) {
            const old = before.nodes[key] || before.legacyNodes[key];
            if (old && old.name !== n.name) add('node-renamed','Node renamed: {from} → {to}',{session:after.branches[n.branchId]?.name,from:old.name,to:n.name});
            else if (!old) {
                const regrouped = Object.values(before.nodes).some(previous => previous.chats?.some(chat => n.chats?.includes(chat)));
                add('node-added',regrouped?'Node regrouped: {name}':'Node named: {name}',{session:after.branches[n.branchId]?.name,name:n.name});
            }
        }
        for (const [key,n] of Object.entries({...before.legacyNodes,...before.nodes})) if (!after.nodes[key] && !after.legacyNodes[key] && (!n.chats || n.chats.some(chat => !Object.values(after.nodes).some(next=>next.chats?.includes(chat))))) add('node-removed','Node dissolved: {name}',{session:after.branches[n.branchId]?.name,name:n.name});
    }
    if (!changes.length) add('metadata-changed','Session metadata updated');
    return changes;
}
export const describeChange = change => change.label.replace(/\{(\w+)\}/g,(_,key)=>String(change[key] ?? ''));
const line = value => String(value || '').replace(/[\r\n\x00-\x1f]/g,' ').trim();
export function commitMessage(items) {
    const projects = [...new Set(items.map(i=>i.project || 'Ungrouped'))];
    const title = items.length === 1 ? `Grove: ${line(projects[0])} / ${line(items[0].name)}` : `Grove: update ${items.length} sessions in ${projects.length} projects`;
    return title.slice(0,140) + '\n\n' + items.map(i=>`[${line(i.project || 'Ungrouped')}] ${line(i.name)}\n` + i.changes.map(c=>`- ${c.session && c.session!==i.name ? line(c.session)+': ' : ''}${line(describeChange(c))}`).join('\n')).join('\n\n') + '\n';
}
