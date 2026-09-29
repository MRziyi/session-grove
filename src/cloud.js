import {bodyRefs,retainedGraph} from './retention.js';
import {applyTrashState,deletedIds,isTrashed} from './trash.js';
import {withVaultLock} from './dav-lock.js';
import { INBOX_ID, inboxProject, cloudProjectId } from './inbox.js';
import { preferences } from './preferences.js';
import { BACKGROUND_PROJECT } from './session-kind.js';
import { createVault, vaultKey } from './vault.js';
import { WebDAV, seal, sealAsync, unseal, assertDavListing } from './sync.js';
import { encodeRevisionRefs, decodeRevisionRefs } from './revision-wire.js';
import { assert, hash, now, mapConcurrent } from './util.js';
import { uploadPacks, downloadRecords } from './record-packs.js';
import { rootOf } from './organization.js';
const digest = value => hash(JSON.stringify(value));
const sorted = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
export function treeSnapshot(store, treeId) { return store.memo('cloud-tree:' + treeId, () => buildSnapshot(store, treeId)); }
function buildSnapshot(store, treeId) {
    const graph = store.exportGraph(), branches = graph.branches.filter(b => rootOf(store, b.id).id === treeId);
    if (!branches.length) return null;
    return sliceGraph(graph, branches.map(b => b.id));
}
function sliceGraph(graph, ids) {
    const selected = new Set(ids), branches = graph.branches.filter(b => selected.has(b.id));
    const projectIds = new Set(branches.map(b => b.projectId)), revisions = new Map(), all = new Map(graph.revisions.map(r => [r.id, r]));
    const visit = id => { if (!id || revisions.has(id)) return; const r = all.get(id); assert(r, 'Missing revision in cloud tree.'); revisions.set(id, r); visit(r.parent); };
    const nodes = (graph.nodes || []).filter(n => selected.has(n.branchId));
    for (const b of branches) { visit(b.head); visit(b.forkRevision); }
    nodes.forEach(n => visit(n.revisionId));
    return { schema: 3, projects: sorted(graph.projects.filter(p => projectIds.has(p.id))), branches: sorted(branches), nodes: sorted(nodes), layouts: sorted((graph.layouts || []).filter(l => selected.has(l.rootId))), revisions: sorted([...revisions.values()]), ...(graph.retention?{retention:{schema:1,extras:Object.fromEntries(Object.entries(graph.retention.extras||{}).filter(([id])=>revisions.has(id))),ranges:Object.fromEntries(Object.entries(graph.retention.ranges).filter(([id])=>revisions.has(id)))}}:{}) };
}
const cacheDefault = () => ({ heads: {}, indexes: {}, loaded: {}, ack: {}, ownProjects: [], legacyGraphs: {} });
// Drop superseded references by ancestry, never by wall-clock timestamps.
function tips(items) {
    const unique = [...new Map(items.map(i => [i.ref, i])).values()];
    return unique.filter(i => !unique.some(other => other.ref !== i.ref && other.ancestors?.includes(i.ref)));
}
export class Cloud {
    constructor(store, readConfig) { this.store = store; this.readConfig = readConfig; this.connection = null; }
    cache() { return this.store.local(this.cacheKey || 'cloud:no-vault') || cacheDefault(); }
    save(c, quiet = false) { this.store.local(this.cacheKey, c, { quiet }); }
    async connect(passphrase) {
        const config = this.readConfig(), signature = digest([config, passphrase]);
        if (this.connection?.signature === signature) return this.connection;
        const dav = new WebDAV(config);
        let created=false;
        let bytes = await dav.get('vault.json');
        if (!bytes) {
            await dav.mkdir();created=true;
            const { vault } = createVault(passphrase);
            await dav.put('vault.json', Buffer.from(JSON.stringify(vault)), true);
            bytes = await dav.get('vault.json');
        }
        const vault = JSON.parse(bytes.toString()), key = vaultKey(vault, passphrase);
        const rootDav = dav, dataDav = vault.generation ? dav.scoped('generations/' + vault.generation + '/') : dav;
        if(created)for (const dir of ['objects/', 'trees/', 'projects/', 'heads/']) await dataDav.mkdir(dir);
        this.cacheKey = 'cloud:' + hash(dav.base + vault.salt);
        this.store.local('cloudCacheKey', this.cacheKey);
        if(vault.schema===3&&this.cache().generation!==vault.generation){this.store.local('trashDirtyRoots',this.dirtyIds());this.save({...cacheDefault(),generation:vault.generation});}
        return this.connection = { dav: dataDav, rootDav, vaultBytes: bytes, key, signature, protocol:vault.schema };
    }
    useSavedCache() { this.cacheKey ||= this.store.local('cloudCacheKey'); }
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
    report(phase, completed=0, total=null, startedAt=Date.now()) {
        const elapsed=(Date.now()-startedAt)/1000;
        this.onProgress?.({phase,completed,total,etaSeconds:total && completed>0 && elapsed>=1 ? Math.ceil(elapsed/completed*(total-completed)) : null});
    }
    async catalog(passphrase) {
        this.report('Checking cloud directory');
        let connection = await this.connect(passphrase);
        const current = await connection.rootDav.get('vault.json');
        if (!current?.equals(connection.vaultBytes)) { const held=connection.rootDav.lockContext,verified=connection.rootDav.collectionLockVerified;this.lock(); const latest=current&&JSON.parse(current.toString());if(latest?.schema===3){connection=await this.connect(passphrase);if(held?.active){connection.rootDav.lockContext=held;connection.rootDav.collectionLockVerified=verified;}}else throw new Error('Cloud encryption settings changed. Reconnect in Settings.'); }
        const { dav, key } = connection, c = this.cache();
        if(connection.protocol===3){const bytes=await dav.get('trash-state.bin');assert(bytes,'Cloud deletion markers are missing.');applyTrashState(this.store,unseal(bytes,key));}
        const names = await dav.list('heads/', /^[a-f0-9-]+\.bin$/);
        for (const name of names) {
            const response = await dav.request('GET', 'heads/' + name, undefined, c.heads[name]?.etag ? { 'If-None-Match': c.heads[name].etag } : {});
            if (response.status === 304) continue;
            assert(response.ok, `Cloud directory read failed (${response.status}).`);
            const bytes = await dav.readResponse(response, 16 * 1024 * 1024); assert(bytes.length < 16 * 1024 * 1024, 'Cloud directory too large.');
            const value = unseal(bytes, key);
            assert([4, 5, 6].includes(value.schema) && Array.isArray(value.projects), 'Unsupported cloud directory.');
            for (const p of value.projects) assert(typeof p.id === 'string' && typeof p.name === 'string' && /^[a-f0-9]{64}$/.test(p.index), 'Invalid cloud project.');
            c.heads[name] = { ...value, etag: response.headers.get('etag') };
        }
        // An old vault is indexed from its manifests, without fetching transcripts.
        if (!names.length) await this.legacyCatalog(dav, key, c);
        c.checkedAt = now(); this.save(c);
        return { projects: this.summaries().length };
    }
    async legacyCatalog(dav, key, c) {
        const r = await dav.request('PROPFIND', 'commits/', undefined, { Depth: '1' });
        if (r.status === 404) return;
        assert(r.ok, 'Could not check legacy cloud history.');
        const xml = (await dav.readResponse(r, 16 * 1024 * 1024)).toString();assertDavListing(xml);const names = [...xml.matchAll(/<(?:[\w-]+:)?href[^>]*>([^<]+)<\/(?:[\w-]+:)?href>/g)].map(m => decodeURIComponent(m[1].split('/').at(-1))).filter(n => /^[0-9T-]+-[a-f0-9-]+\.bin$/.test(n)).sort();
        for (const name of names) {
            if (c.heads['legacy-' + name]) continue;
            const bytes = await dav.get('commits/' + name); assert(bytes, 'Missing legacy manifest.');
            const graph = unseal(bytes, key).graph; assert([1, 2, 3].includes(graph?.schema), 'Invalid legacy manifest.');
            const projects = [];
            for (const p of graph.projects) {
                const buckets = new Map(), byId = new Map(graph.branches.map(b => [b.id, b]));
                for (const b of graph.branches.filter(b => b.projectId === p.id)) {
                    let root = b; const seen = new Set();
                    while (root.parentId) { assert(!seen.has(root.id), 'Invalid legacy tree.'); seen.add(root.id); root = byId.get(root.parentId); assert(root, 'Missing legacy parent.'); }
                    if (!buckets.has(root.id)) buckets.set(root.id, []); buckets.get(root.id).push(b);
                }
                const items = [...buckets.entries()].map(([id, members]) => {
                    const g = sliceGraph(graph, members.map(b => b.id)), ref = digest(g); c.legacyGraphs[ref] = g;
                    const real = members.filter(b => !b.synthetic), root = members.find(b => b.id === id), representative = root.synthetic ? real[0] : root;
                    return { id, ref, ancestors: [], projectId: p.id, name: representative.name, agent: root.agent, kind: real.length > 1 ? 'tree' : 'session', sessionIds: real.map(b => b.id), sessions: real.map(b => ({ id: b.id, name: b.name, agent: b.agent, archived: b.archived, active: false, chats: null, updatedAt: b.updatedAt })), archived: real.every(b => b.archived), updatedAt: members.map(b => b.updatedAt).sort().at(-1) };
                });
                const index = digest({ project: p, items }); c.indexes[index] = { project: p, items };
                projects.push({ ...p, index, count: items.filter(i => !i.archived).length, treeIds: items.filter(i => !i.archived).map(i => i.id) });
            }
            c.heads['legacy-' + name] = { schema: 4, projects };
        }
    }
    async project(projectId, passphrase) {
        const { dav, key } = await this.connect(passphrase), c = this.cache();
        for (const p of this.projectRefs().filter(p => p.id === projectId)) {
            if (c.indexes[p.index]) continue;
            const bytes = await dav.get('projects/' + p.index + '.bin'); assert(bytes, 'Cloud project index is missing.');
            const value = unseal(bytes, key); assert(digest(value) === p.index && value.project?.id === projectId && Array.isArray(value.items), 'Invalid project index.');
            for (const i of value.items) assert(typeof i.id === 'string' && /^[a-f0-9]{64}$/.test(i.ref) && i.projectId === projectId && Array.isArray(i.sessions), 'Invalid cloud tree entry.');
            c.indexes[p.index] = value;
        }
        this.save(c);
        return this.items().filter(i => i.projectId === projectId);
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
        return this.store.syncCollections().items.filter(i => this.store.memo('fingerprint:' + i.id, () => digest(treeSnapshot(this.store, i.id))) !== ack[i.id]).map(i => i.id);
    }
    async transferPlan(passphrase) {
        await this.catalog(passphrase);
        for (const p of this.summaries()) await this.project(p.id, passphrase);
        this.saveDirectory();
        const localIds = new Set(this.store.all('branch').map(b => b.id));
        const c = this.cache(), downloads = this.items().filter(i => localIds.has(i.id) && i.versions.some(v => !(c.loaded[i.id] || []).includes(v.ref))), missing = new Set();
        const exists = this.store.db.prepare('SELECT 1 FROM objects WHERE hash=?');
        for (const item of downloads) for (const version of item.versions) {
            if ((c.loaded[item.id] || []).includes(version.ref)) continue;
            const bytes = c.legacyGraphs[version.ref] ? null : await this.connection.dav.get('trees/' + version.ref + '.bin');
            const graph = c.legacyGraphs[version.ref] || (bytes && unseal(bytes, this.connection.key));
            assert(graph && digest(graph) === version.ref, 'Cloud manifest integrity check failed.');
            for (const h of bodyRefs(decodeRevisionRefs(graph))) if (!exists.get(h)) missing.add(h);
        }
        const uploads = this.dirtyIds(), refs = new Set(uploads.flatMap(id => {const graph=treeSnapshot(this.store,id);return graph?bodyRefs(graph):[];}));
        const known = new Set([...(c.uploadedObjects || []), ...(c.packs || []).flatMap(p => p.refs)]);
        const pending = [...refs].filter(h => !known.has(h));
        const bytes = this.store.db.prepare('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM objects WHERE hash IN (SELECT value FROM json_each(?))').get(JSON.stringify(pending)).bytes;
        return { pull: { trees: downloads.length, records: missing.size }, push: { trees: uploads.length, records: pending.length, bytes }, large: missing.size > 2000 || pending.length > 2000 || bytes > 32 * 1024 * 1024, downloadIds: downloads.map(i => i.id) };
    }
    async hydrate(treeId, passphrase) {
        const { dav, key } = await this.connect(passphrase), item = this.items().find(i => i.id === treeId);
        if (!item) return;
        let c = this.cache();
        if (item.versions.every(v => (c.loaded[treeId] || []).includes(v.ref))) return;
        const loaded = c.loaded[treeId] || [], wasDirty = this.dirtyIds().includes(treeId);
        for (const version of item.versions) {
            if (loaded.includes(version.ref)) continue;
            const bytes = c.legacyGraphs[version.ref] ? null : await dav.get('trees/' + version.ref + '.bin');
            const encoded = c.legacyGraphs[version.ref] || (bytes && unseal(bytes, key));
            assert(encoded && digest(encoded) === version.ref && encoded.branches.some(b => b.id === treeId), 'Invalid cloud tree manifest.');
            let graph = decodeRevisionRefs(encoded);
            assert(!graph.retention||this.connection.protocol===3||this.connection.retentionStaging,'Sparse history requires a Trash-aware vault.');
            if(this.store.local('trashState')||this.store.local('trashPending')?.length)graph=retainedGraph(graph,deletedIds(this.store,graph));
            this.report('Downloading records', 0, null);
            await downloadRecords(this.store, dav, key, graph, (done, total, started) => this.report('Downloading records', done, total, started), pack => { c.packs ||= []; if (!c.packs.some(p => p.ref === pack.ref)) c.packs.push(pack); });
            this.report('Applying downloaded changes');
            this.store.merge(graph, {}); loaded.push(version.ref);
            c.loaded[treeId] = loaded; this.save(c);
        }
        if (!wasDirty && !(this.store.local('conflicts') || []).length) c.ack[treeId] = digest(treeSnapshot(this.store, treeId));
        this.save(c);
    }
    async publish(treeIds, passphrase, { catalogFresh = false, locked = false } = {}) {
        const connection=await this.connect(passphrase);
        if(connection.protocol===3&&!locked)return withVaultLock(connection.rootDav,()=>this.publish(treeIds,passphrase,{catalogFresh:false,locked:true}));
        if (!catalogFresh) await this.catalog(passphrase);
        else await this.connect(passphrase);
        const { dav, key, rootDav, vaultBytes } = this.connection;
        assert(this.connection.retentionStaging || !await rootDav.get('migration.json'), 'Cloud migration in progress; retry after it completes.');
        const projectIds = new Set(treeIds.map(id => cloudProjectId(this.store.get('branch', id).projectId)));
        const remoteItems = new Map(this.items().map(i=>[i.id,i]));
        for (const id of treeIds) for (const previous of remoteItems.get(id)?.versions || []) projectIds.add(previous.projectId);
        const before = this.cache();
        if (Object.keys(before.legacyGraphs || {}).length) for (const p of this.summaries()) projectIds.add(p.id);
        for (const id of treeIds) if (before.locations?.[id]) projectIds.add(before.locations[id]);
        for (const p of projectIds) await this.project(p, passphrase);
        for (const id of treeIds) await this.hydrate(id, passphrase);
        assert(!(this.store.local('conflicts') || []).length, 'Resolve sync conflicts before uploading.');
        const c = this.cache(), replacements = new Map(), fingerprints = {};
        const graphs=new Map(treeIds.map(id=>[id,treeSnapshot(this.store,id)])), snapshotItems=new Map(this.store.syncCollections().items.map(i=>[i.id,i]));
        let uploaded = 0, doneBefore = 0;
        const recordTotal = [...graphs.values()].filter(Boolean).reduce((n,g)=>n+bodyRefs(g).length,0), pushStarted = Date.now();
        for (const id of treeIds) {
            const graph = graphs.get(id); if (!graph) continue;
            assert(!graph.retention||this.connection.protocol===3||this.connection.retentionStaging,'Sync pending Trash before publishing retained history.');
            const fingerprint = digest(graph), previous = this.items().find(i => i.id === id);
            if (c.ack[id] === fingerprint && previous?.versions.length === 1) continue;
            const refs = bodyRefs(graph);
            this.report('Uploading records', doneBefore, recordTotal, pushStarted);
            const packed = await uploadPacks(this.store, dav, key, refs, c, () => this.save(c, true), (done, total) => this.report('Uploading records', doneBefore + refs.length - total + done, recordTotal, pushStarted));
            doneBefore += refs.length;
            this.report('Uploading records', doneBefore, recordTotal, pushStarted);
            uploaded += packed.uploaded;
            const transport = encodeRevisionRefs(packed.packs.length ? { ...graph, packs: packed.packs } : graph), ref = digest(transport);
            await dav.put('trees/' + ref + '.bin', await sealAsync(transport, key), true);
            const ancestors = [...new Set((previous?.versions || []).flatMap(v => [v.ref, ...(v.ancestors || [])]))].filter(h => h !== ref);
            const item = snapshotItems.get(id);
            replacements.set(id, { ...item, projectId: cloudProjectId(item.projectId), sessions: item.sessions.map(s => ({ ...s, active: false })), ref, ancestors });
            fingerprints[id] = fingerprint;
        }
        if (!replacements.size) return { uploaded: 0, published: 0 };
        this.report('Publishing project indexes');
        const ownProjects = new Map((c.heads[this.store.device.id + '.bin']?.projects || c.ownProjects || []).map(p => [p.id, p]));
        for (const projectId of projectIds) {
            const project = (projectId === INBOX_ID ? inboxProject() : this.store.all('project').find(p => p.id === projectId)) || this.summaries().find(p => p.id === projectId); if (!project) continue;
            const retired = new Set([...replacements.values()].flatMap(i => i.sessionIds.filter(id => id !== i.id)));
            const oldItems = this.items().filter(i => i.projectId === projectId).flatMap(i => i.versions).filter(i => !replacements.has(i.id) && !retired.has(i.id));
            const items = [...oldItems, ...[...replacements.values()].filter(i => i.projectId === projectId)];
            // Old manifests are converted to immutable tree manifests without downloading their objects.
            for (const item of items) if (c.legacyGraphs[item.ref]) await dav.put('trees/' + item.ref + '.bin', seal(c.legacyGraphs[item.ref], key), true);
            const { index: oldIndex, count, treeIds: oldTreeIds, indexAncestors: oldAncestors, ...projectMetadata } = project;
            const value = { project: projectMetadata, items }, index = digest(value);
            await dav.put('projects/' + index + '.bin', seal(value, key), true);
            c.indexes[index] = value;
            const treeIds = [...new Set(items.filter(i => !i.archived).map(i => i.id))];
            const indexAncestors = [...new Set(this.projectRefs().filter(p => p.id === projectId).flatMap(p => [p.index, ...(p.indexAncestors || [])]))].filter(h => h !== index);
            ownProjects.set(projectId, { ...value.project, index, count: treeIds.length, treeIds, indexAncestors });
        }
        const head = { schema: this.connection.protocol===3||this.connection.retentionStaging?6:5, deviceId: this.store.device.id, at: now(), projects: [...ownProjects.values()] };
        // Publication point: every referenced immutable dependency is already durable.
        assert(this.connection.retentionStaging || (await rootDav.get('vault.json'))?.equals(vaultBytes) && !await rootDav.get('migration.json'), 'Cloud settings changed before publication.');
        this.report('Publishing cloud directory');
        await dav.put('heads/' + this.store.device.id + '.bin', seal(head, key));
        c.heads[this.store.device.id + '.bin'] = head; c.ownProjects = head.projects;
        c.locations ||= {};
        for (const [id, ref] of Object.entries(fingerprints)) { c.ack[id] = ref; c.loaded[id] = [...new Set([...(c.loaded[id] || []), replacements.get(id).ref])]; c.locations[id] = replacements.get(id).projectId; }
        c.lastUpload = now(); this.save(c);
        return { uploaded, published: replacements.size };
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
        return { ...data, projects: [...projects.values()].filter(p=>show||!p.background&&p.id!==BACKGROUND_PROJECT), items: [...items.values()].filter(i=>show||i.projectId!==BACKGROUND_PROJECT), cloudProjects: summaries };
    }
    listing(scope, query) {
        const dirty = new Set(this.dirtyIds());
        if (scope.startsWith('active:')) {
            const local = this.store.listing(scope, query);
            return { ...local, items: local.items.map(i => ({ ...i, cloudState: dirty.has(i.id) ? 'local' : 'cached' })) };
        }
        const data = this.decorate({ ...this.store.collections(), projects: this.store.all('project') }), q = String(query || '').toLocaleLowerCase();
        const branches = new Map(this.store.all('branch').map(b => [b.id, b]));
        const items = data.items.flatMap(i => {
            const project = data.projects.find(p => p.id === i.projectId);
            const sessions = i.sessions.filter(s => scope === 'archived' ? s.archived || project?.archived : (scope === 'projects' || cloudProjectId(i.projectId) === scope) && !s.archived && !project?.archived);
            if (!sessions.length) return [];
            const matching = sessions.filter(s => !q || s.name.toLocaleLowerCase().includes(q) || branches.has(s.id) && this.store.parsed(branches.get(s.id).head, s.agent).messages.some(m => m.text.toLocaleLowerCase().includes(q)));
            if (!matching.length && !i.name.toLocaleLowerCase().includes(q)) return [];
            return [{ ...i, agents:[...new Set(sessions.map(s=>s.agent))], origin:[...sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.origin || i.origin, sessions, sessionIds: sessions.map(s => s.id), name: sessions.find(s => s.id === i.id)?.name || sessions[0].name, kind: sessions.length > 1 ? 'tree' : 'session', visibleSessionIds: sessions.map(s => s.id), matchedSessionIds: matching.map(s => s.id), visibleCount: sessions.length, updatedAt: sessions.map(s=>s.updatedAt).sort().at(-1) || i.updatedAt, groupId: i.projectId, groupName: project?.name }];
        });
        const latest = new Map(); for (const i of items) latest.set(i.groupId, [latest.get(i.groupId) || '', i.updatedAt].sort().at(-1));
        items.sort((a, b) => latest.get(b.groupId).localeCompare(latest.get(a.groupId)) || String(a.groupId).localeCompare(String(b.groupId)) || b.updatedAt.localeCompare(a.updatedAt));
        return { items, itemCount: items.length, sessionCount: items.reduce((n, i) => n + i.visibleCount, 0) };
    }
}
