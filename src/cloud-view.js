import { projectView } from './project-view.js';
import {createHash} from 'node:crypto';
import {isTrashed} from './trash.js';
import { INBOX_ID, inboxProject, cloudProjectId } from './inbox.js';
import { preferences } from './preferences.js';
import { BACKGROUND_PROJECT } from './session-kind.js';
import { assert, hash, now } from './util.js';
import { rootOf } from './organization.js';
const digest = value => hash(JSON.stringify(value));
// Graph fields are plain JSON. Hash arrays one row at a time so a status check
// never allocates a second, library-sized serialized history alongside the graph.
export function graphFingerprint(graph) {
    if(!graph)return digest(graph);
    const h=createHash('sha256');h.update('{');let first=true;
    for(const [key,value] of Object.entries(graph)){
        if(value===undefined)continue;
        if(!first)h.update(',');first=false;
        h.update(JSON.stringify(key)+':');
        if(Array.isArray(value)){
            h.update('[');
            for(let i=0;i<value.length;i++){if(i)h.update(',');h.update(JSON.stringify(value[i])??'null');}
            h.update(']');
        }else h.update(JSON.stringify(value));
    }
    return h.update('}').digest('hex');
}

const sorted = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
export function treeSnapshot(store, treeId) { return store.memo('cloud-tree:' + treeId, () => buildSnapshot(store, treeId)); }
function buildSnapshot(store, treeId) {
    const index = store.memo('cloud-snapshot-index', () => {
        const graph = store.exportGraph(), families = new Map(), nodes = new Map(), layouts = new Map();
        const add = (map, id, value) => { if (!map.has(id)) map.set(id, []); map.get(id).push(value); };
        for (const b of graph.branches) add(families, rootOf(store, b.id).id, b);
        for (const n of graph.nodes || []) add(nodes, n.branchId, n);
        for (const l of graph.layouts || []) add(layouts, l.rootId, l);
        return { graph, families, nodes, layouts, revisions: new Map(graph.revisions.map(r => [r.id, r])) };
    });
    const branches = index.families.get(treeId) || [];
    if (!branches.length) return null;
    const graph = { ...index.graph, branches, nodes: branches.flatMap(b => index.nodes.get(b.id) || []), layouts: branches.flatMap(b => index.layouts.get(b.id) || []) };
    return sliceGraph(graph, branches.map(b => b.id), index.revisions);
}
function sliceGraph(graph, ids, revisionIndex) {
    const selected = new Set(ids), branches = graph.branches.filter(b => selected.has(b.id));
    const projectIds = new Set(branches.map(b => b.projectId)), revisions = new Map(), all = revisionIndex || new Map(graph.revisions.map(r => [r.id, r]));
    const visit = id => { if (!id || revisions.has(id)) return; const r = all.get(id); assert(r, 'Missing revision in cloud tree.'); revisions.set(id, r); visit(r.parent); };
    const nodes = (graph.nodes || []).filter(n => selected.has(n.branchId));
    for (const b of branches) { visit(b.head); visit(b.forkRevision); }
    nodes.forEach(n => visit(n.revisionId));
    return { schema: 3, projects: sorted(graph.projects.filter(p => projectIds.has(p.id))), branches: sorted(branches), nodes: sorted(nodes), layouts: sorted((graph.layouts || []).filter(l => selected.has(l.rootId))), revisions: sorted([...revisions.values()]), ...(graph.retention?{retention:{schema:1,extras:Object.fromEntries(Object.entries(graph.retention.extras||{}).filter(([id])=>revisions.has(id))),ranges:Object.fromEntries(Object.entries(graph.retention.ranges).filter(([id])=>revisions.has(id)))}}:{}) };
}
const cacheDefault = () => ({ heads: {}, indexes: {}, loaded: {}, ack: {}, ownProjects: [] });
// Drop superseded references by ancestry, never by wall-clock timestamps.
function tips(items) {
    const unique = [...new Map(items.map(i => [i.ref, i])).values()];
    return unique.filter(i => !unique.some(other => other.ref !== i.ref && other.ancestors?.includes(i.ref)));
}
export class CloudView {
    constructor(store, readConfig) { this.store = store; this.readConfig = readConfig; this.connection = null; this.metrics = { requests: 0, methods: {}, bytesSent: 0, bytesReceived: 0, requestMs: 0, responseBodyMs: 0, failures: 0 }; }
    cache() { return this.store.local(this.cacheKey || 'cloud:unconfigured') || cacheDefault(); }
    save(c, quiet = false) { this.store.local(this.cacheKey, c, { quiet }); }
    useSavedCache() { this.cacheKey ||= 'cloud:unconfigured'; }
    lock() { this.connection = null; }
    projectRefs() {
        this.useSavedCache(); const groups = new Map();
        for (const head of Object.values(this.cache().heads)) for (const p of head.projects || []) {
            if (!groups.has(p.id)) groups.set(p.id, []); groups.get(p.id).push(p);
        }
        return [...groups.values()].flatMap(rows => [...new Map(rows.map(p => [p.index, p])).values()].filter(p => !rows.some(other => other.index !== p.index && other.indexAncestors?.includes(p.index))));
    }
    summaries() {
        const grouped = new Map();
        for (const p of this.projectRefs()) { if (!grouped.has(p.id)) grouped.set(p.id, []); grouped.get(p.id).push(p); }
        return [...grouped.values()].map(rows => {
            const chosen = rows.reduce((a, b) => b.metaAncestors?.includes(a.metaVersion) ? b : a.metaAncestors?.includes(b.metaVersion) ? a : (b.updatedAt || '') > (a.updatedAt || '') ? b : a);
            return { ...chosen, count: rows.every(p => Array.isArray(p.treeIds)) ? new Set(rows.flatMap(p => p.treeIds)).size : Math.max(...rows.map(p => p.count || 0)) };
        });
    }
    report(phase, completed=0, total=null, startedAt=Date.now(), detail = null) {
        const elapsed=(Date.now()-startedAt)/1000;
        this.onProgress?.({phase,completed,total,detail,etaSeconds:total && completed>0 && elapsed>=1 ? Math.ceil(elapsed/completed*(total-completed)) : null});
    }
    items({includeTrashed=false} = {}) {
        this.useSavedCache(); const c = this.cache(), grouped = new Map(), localIds = new Set(this.store.all('branch').map(b => b.id));
        for (const p of this.projectRefs()) for (const item of c.indexes[p.index]?.items || []) {
            if (!grouped.has(item.id)) grouped.set(item.id, []); grouped.get(item.id).push(item);
        }
        return [...grouped.values()].map(rows => {
            const versions = tips(rows), chosen = [...versions].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
            return { ...chosen, versions, sessions:chosen.sessions.filter(s=>includeTrashed||!isTrashed(this.store,s.id)), cloudState: versions.every(v => (c.loaded[chosen.id] || []).includes(v.ref)) ? 'cached' : localIds.has(chosen.id) ? 'update' : 'cloud' };
        }).filter(i=>includeTrashed||i.sessions.length);
    }
    saveDirectory({ onlyIfMissing = false } = {}) {
        this.useSavedCache();
        if (!this.cacheKey) return;
        const c = this.cache();
        if (onlyIfMissing && c.directorySnapshot) return;
        c.directorySnapshot = { projects: this.summaries(), items: this.items(), at: now() };
        this.save(c);
    }
    dirtyIds() {
        this.useSavedCache(); const ack = this.cache().ack;
        const transient = key => key==='exportGraph'||key==='cloud-snapshot-index'||key.startsWith('cloud-tree:');
        const existing = new Set([...this.store.memoCache.keys()].filter(transient));
        try {
            return this.store.syncCollections().items.filter(i => this.store.memo('fingerprint:' + i.id, () => {
                const graph=treeSnapshot(this.store,i.id),entities=new Set(),revisions=new Set();
                for(const [kind,key]of [['project','projects'],['branch','branches'],['node','nodes'],['layout','layouts'],['revision','revisions']])for(const value of graph[key]||[]){const id=JSON.parse(JSON.stringify(value.id));entities.add(kind+':'+id);if(kind==='revision')revisions.add(id);}
                this.store.syncFingerprintDeps.set(i.id,{entities,revisions,retention:!!graph.retention});return graphFingerprint(graph);
            }) !== ack[i.id]).map(i => i.id);
        } finally {
            // Status polling retains only small fingerprints. Full export graphs
            // can contain millions of refs and are rebuilt only for changed data
            // or an actual transfer. Leave a caller's pre-existing snapshots alone.
            for(const key of this.store.memoCache.keys())if(transient(key)&&!existing.has(key))this.store.memoCache.delete(key);
        }
    }
    decorate(data) {
        this.useSavedCache(); const directory = this.cache().directorySnapshot;
        const remote=(directory?.items||this.items()).map(i=>({...i,sessions:i.sessions.filter(s=>!isTrashed(this.store,s.id))})).filter(i=>i.sessions.length);
        const summaries=(directory?.projects||this.summaries()).map(p=>{if(!p.treeIds)return p;const treeIds=p.treeIds.filter(id=>!isTrashed(this.store,id)||remote.some(i=>i.id===id));return{...p,treeIds,count:treeIds.length};});
        const dirty = new Set(this.dirtyIds()), projects = new Map(summaries.map(p => [p.id, p]));
        for (const p of data.projects) {
            const remote = projects.get(p.id);
            projects.set(p.id, remote?.metaAncestors?.includes(p.metaVersion) ? remote : { ...remote, ...p });
        }
        const items = new Map(remote.map(i => [i.id, { ...i, projectId: i.projectId === INBOX_ID ? null : i.projectId }]));
        for (const i of data.items) {
            const r = remote.find(r => r.id === i.id);
            const chosen = i;
            items.set(i.id, { ...chosen, projectId: chosen.projectId === INBOX_ID ? null : chosen.projectId, cloudState: dirty.has(i.id) ? 'local' : 'cached', remoteUpdate: r?.cloudState === 'update' });
        }
        const inboxIds = new Set(summaries.filter(p => p.id === INBOX_ID).flatMap(p => p.treeIds || []));
        for (const i of data.items) { if (!i.projectId && !i.archived) inboxIds.add(i.id); else inboxIds.delete(i.id); for (const id of i.sessionIds || []) if (id !== i.id) inboxIds.delete(id); }
        projects.set(INBOX_ID, { ...projects.get(INBOX_ID), ...inboxProject(), count: inboxIds.size });
        const show = preferences(this.store).showScheduledSessions;
        const result = { ...data, projects: [...projects.values()].filter(p=>show||!p.background&&p.id!==BACKGROUND_PROJECT), items: [...items.values()].filter(i=>show||i.projectId!==BACKGROUND_PROJECT), cloudProjects: summaries };
        const incomplete = new Set(this.projectRefs().filter(p=>!this.cache().indexes[p.index]).map(p=>p.id));
        const view=projectView({...result,branches:this.store.all('branch')},incomplete);
        return {...result,projectDirectory:view.directory,projectAvailability:view.availability,projectItems:view.items};
    }
    listing(scope, query) {
        const dirty = new Set(this.dirtyIds());
        if (scope.startsWith('active:')) {
            const local = this.store.listing(scope, query);
            return { ...local, items: local.items.map(i => ({ ...i, cloudState: dirty.has(i.id) ? 'local' : 'cached' })) };
        }
        const data = this.decorate({ ...this.store.collections(), projects: this.store.all('project') }), q = String(query || '').toLocaleLowerCase();
        const branches = new Map(this.store.all('branch').map(b => [b.id, b]));
        const items = (scope==='archived'?data.items:data.projectItems).flatMap(i => {
            const project = data.projects.find(p => p.id === i.projectId);
            const sessions = i.sessions.filter(s => scope === 'archived' ? s.archived || project?.archived : (scope === 'projects' || cloudProjectId(i.projectId) === scope) && !s.archived && !project?.archived);
            if (!sessions.length) return [];
            const matching = sessions.filter(s => !q || s.name.toLocaleLowerCase().includes(q) || branches.has(s.id) && this.store.parsed(branches.get(s.id).head, s.agent).messages.some(m => m.text.toLocaleLowerCase().includes(q)));
            if (!matching.length && !i.name.toLocaleLowerCase().includes(q)) return [];
            return [{ ...i, agents:[...new Set(sessions.map(s=>s.agent))], origin:[...sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.origin || i.origin, sessions, sessionIds: sessions.map(s => s.id), name: i.sessionName || sessions.find(s => s.id === i.id)?.name || sessions[0].name, kind: sessions.length > 1 ? 'tree' : 'session', visibleSessionIds: sessions.map(s => s.id), matchedSessionIds: matching.map(s => s.id), visibleCount: sessions.length, updatedAt: sessions.map(s=>s.updatedAt).sort().at(-1) || i.updatedAt, groupId: i.projectId, groupName: project?.name }];
        });
        const latest = new Map(); for (const i of items) latest.set(i.groupId, [latest.get(i.groupId) || '', i.updatedAt].sort().at(-1));
        items.sort((a, b) => latest.get(b.groupId).localeCompare(latest.get(a.groupId)) || String(a.groupId).localeCompare(String(b.groupId)) || b.updatedAt.localeCompare(a.updatedAt));
        return { items, itemCount: items.length, sessionCount: items.reduce((n, i) => n + i.visibleCount, 0) };
    }
}
