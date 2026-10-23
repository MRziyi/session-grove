import { cloudProjectId } from './inbox.js';

// A project entity is durable metadata, not evidence that it has visible sessions.
// Both navigation and the Projects listing consume this projection.
export function projectView(data, incompleteIds = new Set()) {
    const projects = new Map(data.projects.map(p=>[p.id,p])), groups = new Map();
    const items = data.items.flatMap(item=>{
        const projectId=cloudProjectId(item.projectId),project=projects.get(projectId);
        if(project?.archived)return [];
        const sessions=item.sessions.filter(s=>!s.archived);
        if(!sessions.length)return [];
        const value={...item,sessions,sessionIds:sessions.map(s=>s.id),archived:false,updatedAt:sessions.map(s=>s.updatedAt).sort().at(-1)||item.updatedAt};
        if(!groups.has(projectId))groups.set(projectId,[]);groups.get(projectId).push(value);
        return [value];
    });
    const availability=data.projects.map(p=>{
        const rows=groups.get(p.id)||[],complete=!incompleteIds.has(p.id);
        const hasHistory=data.items.some(i=>cloudProjectId(i.projectId)===p.id)||data.branches?.some(b=>cloudProjectId(b.projectId)===p.id);
        return {...p,itemCount:rows.length,sessionCount:rows.reduce((n,i)=>n+i.sessions.length,0),complete,
            state:p.archived?'archived':!complete?'unloaded':rows.length?'available':hasHistory?'filtered':'empty',
            updatedAt:rows.map(i=>i.updatedAt).sort().at(-1)||p.updatedAt};
    });
    return {items,availability,directory:availability.filter(p=>!p.archived&&p.itemCount>0)};
}
