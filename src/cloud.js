import { createVault, vaultKey } from './vault.js';
import { WebDAV, seal, unseal } from './sync.js';
import { assert, hash, now, mapConcurrent } from './util.js';
import { parse } from './transcript.js';
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
    return { schema: 3, projects: sorted(graph.projects.filter(p => projectIds.has(p.id))), branches: sorted(branches), nodes: sorted(nodes), layouts: sorted((graph.layouts || []).filter(l => selected.has(l.rootId))), revisions: sorted([...revisions.values()]) };
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
    save(c) { this.store.local(this.cacheKey, c); }
    async connect(passphrase) {
        const config = this.readConfig(), signature = digest([config, passphrase]);
        if (this.connection?.signature === signature) return this.connection;
        const dav = new WebDAV(config);
        await dav.mkdir();
        let bytes = await dav.get('vault.json');
        if (!bytes) {
            const { vault } = createVault(passphrase);
            await dav.put('vault.json', Buffer.from(JSON.stringify(vault)), true);
            bytes = await dav.get('vault.json');
        }
        const vault = JSON.parse(bytes.toString()), key = vaultKey(vault, passphrase);
        const rootDav = dav, dataDav = vault.generation ? dav.scoped('generations/' + vault.generation + '/') : dav;
        for (const dir of ['objects/', 'trees/', 'projects/', 'heads/']) await dataDav.mkdir(dir);
        this.cacheKey = 'cloud:' + hash(dav.base + vault.salt);
        this.store.local('cloudCacheKey', this.cacheKey);
        return this.connection = { dav: dataDav, rootDav, vaultBytes: bytes, key, signature };
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
    async catalog(passphrase) {
        const connection = await this.connect(passphrase);
        const current = await connection.rootDav.get('vault.json');
        if (!current?.equals(connection.vaultBytes)) { this.lock(); throw new Error('Cloud encryption settings changed. Reconnect in Settings.'); }
        const { dav, key } = connection, c = this.cache();
        const names = await dav.list('heads/', /^[a-f0-9-]+\.bin$/);
        for (const name of names) {
            const response = await dav.request('GET', 'heads/' + name, undefined, c.heads[name]?.etag ? { 'If-None-Match': c.heads[name].etag } : {});
            if (response.status === 304) continue;
            assert(response.ok, `Cloud directory read failed (${response.status}).`);
            const bytes = await dav.readResponse(response, 16 * 1024 * 1024); assert(bytes.length < 16 * 1024 * 1024, 'Cloud directory too large.');
            const value = unseal(bytes, key);
            assert(value.schema === 4 && Array.isArray(value.projects), 'Unsupported cloud directory.');
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
        const xml = (await dav.readResponse(r, 16 * 1024 * 1024)).toString(), names = [...xml.matchAll(/<(?:[\w-]+:)?href[^>]*>([^<]+)<\/(?:[\w-]+:)?href>/g)].map(m => decodeURIComponent(m[1].split('/').at(-1))).filter(n => /^[0-9T-]+-[a-f0-9-]+\.bin$/.test(n)).sort();
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
    items() {
        this.useSavedCache(); const c = this.cache(), grouped = new Map();
        for (const p of this.projectRefs()) for (const item of c.indexes[p.index]?.items || []) {
            if (!grouped.has(item.id)) grouped.set(item.id, []); grouped.get(item.id).push(item);
        }
        return [...grouped.values()].map(rows => {
            const versions = tips(rows), chosen = [...versions].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
            return { ...chosen, versions, cloudState: versions.every(v => (c.loaded[chosen.id] || []).includes(v.ref)) ? 'cached' : this.store.all('branch').some(b => b.id === chosen.id) ? 'update' : 'cloud' };
        });
    }
    dirtyIds() {
        this.useSavedCache(); const ack = this.cache().ack;
        return this.store.collections().items.filter(i => i.projectId && digest(treeSnapshot(this.store, i.id)) !== ack[i.id]).map(i => i.id);
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
            const graph = c.legacyGraphs[version.ref] || (bytes && unseal(bytes, key));
            assert(graph && digest(graph) === version.ref && graph.branches.some(b => b.id === treeId), 'Invalid cloud tree manifest.');
            const objects = {};
            await mapConcurrent([...new Set(graph.revisions.flatMap(r => r.refs))], async h => {
                assert(/^[a-f0-9]{64}$/.test(h), 'Invalid transcript reference.');
                if (this.store.db.prepare('SELECT 1 FROM objects WHERE hash=?').get(h)) return;
                const blob = await dav.get('objects/' + h + '.bin'); assert(blob, 'Cloud transcript is incomplete.');
                objects[h] = unseal(blob, key); assert(typeof objects[h] === 'string' && hash(objects[h]) === h, 'Transcript integrity check failed.');
            });
            this.store.merge(graph, objects); loaded.push(version.ref);
            c.loaded[treeId] = loaded; this.save(c);
        }
        if (!wasDirty && !(this.store.local('conflicts') || []).length) c.ack[treeId] = digest(treeSnapshot(this.store, treeId));
        this.save(c);
    }
    async publish(treeIds, passphrase, { catalogFresh = false } = {}) {
        if (!catalogFresh) await this.catalog(passphrase);
        else await this.connect(passphrase);
        const { dav, key, rootDav, vaultBytes } = this.connection;
        assert(!await rootDav.get('migration.json'), 'Cloud migration in progress; retry after it completes.');
        const projectIds = new Set(treeIds.map(id => this.store.get('branch', id).projectId).filter(Boolean));
        const before = this.cache();
        if (Object.keys(before.legacyGraphs || {}).length) for (const p of this.summaries()) projectIds.add(p.id);
        for (const id of treeIds) if (before.locations?.[id]) projectIds.add(before.locations[id]);
        for (const p of projectIds) await this.project(p, passphrase);
        for (const id of treeIds) await this.hydrate(id, passphrase);
        assert(!(this.store.local('conflicts') || []).length, 'Resolve sync conflicts before uploading.');
        const c = this.cache(), replacements = new Map(), fingerprints = {};
        let uploaded = 0;
        for (const id of treeIds) {
            const graph = treeSnapshot(this.store, id); if (!graph) continue;
            const ref = digest(graph), previous = this.items().find(i => i.id === id);
            if (c.ack[id] === ref && previous?.versions.length === 1) continue;
            const sent = new Set(c.uploadedObjects || []);
            await mapConcurrent([...new Set(graph.revisions.flatMap(r => r.refs))], async h => {
                if (sent.has(h)) return;
                const body = this.store.db.prepare('SELECT body FROM objects WHERE hash=?').get(h)?.body; assert(typeof body === 'string', 'Missing local transcript.');
                if (await dav.put('objects/' + h + '.bin', seal(body, key), true)) uploaded++;
                sent.add(h);
            });
            c.uploadedObjects = [...sent];
            await dav.put('trees/' + ref + '.bin', seal(graph, key), true);
            const ancestors = [...new Set((previous?.versions || []).flatMap(v => [v.ref, ...(v.ancestors || [])]))].filter(h => h !== ref);
            const item = this.store.collections().items.find(i => i.id === id);
            replacements.set(id, { ...item, sessions: item.sessions.map(s => ({ ...s, active: false })), ref, ancestors });
            fingerprints[id] = ref;
        }
        if (!replacements.size) return { uploaded: 0, published: 0 };
        const ownProjects = new Map((c.heads[this.store.device.id + '.bin']?.projects || c.ownProjects || []).map(p => [p.id, p]));
        for (const projectId of projectIds) {
            const project = this.store.all('project').find(p => p.id === projectId) || this.summaries().find(p => p.id === projectId); if (!project) continue;
            const oldItems = this.items().filter(i => i.projectId === projectId).flatMap(i => i.versions).filter(i => !replacements.has(i.id));
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
        const head = { schema: 4, deviceId: this.store.device.id, at: now(), projects: [...ownProjects.values()] };
        // Publication point: every referenced immutable dependency is already durable.
        assert((await rootDav.get('vault.json'))?.equals(vaultBytes) && !await rootDav.get('migration.json'), 'Cloud settings changed before publication.');
        await dav.put('heads/' + this.store.device.id + '.bin', seal(head, key));
        c.heads[this.store.device.id + '.bin'] = head; c.ownProjects = head.projects;
        c.locations ||= {};
        for (const [id, ref] of Object.entries(fingerprints)) { c.ack[id] = ref; c.loaded[id] = [...new Set([...(c.loaded[id] || []), ref])]; c.locations[id] = replacements.get(id).projectId; }
        c.lastUpload = now(); this.save(c);
        return { uploaded, published: replacements.size };
    }
    decorate(data) {
        this.useSavedCache(); const remote = this.items(), dirty = new Set(this.dirtyIds()), projects = new Map(this.summaries().map(p => [p.id, p]));
        for (const p of data.projects) {
            const remote = projects.get(p.id);
            projects.set(p.id, remote?.metaAncestors?.includes(p.metaVersion) ? remote : { ...remote, ...p });
        }
        const items = new Map(remote.map(i => [i.id, i]));
        for (const i of data.items) {
            const r = remote.find(r => r.id === i.id), newer = r?.cloudState === 'update' && !dirty.has(i.id);
            items.set(i.id, { ...(newer ? r : i), cloudState: i.projectId ? dirty.has(i.id) ? 'local' : r?.cloudState || 'cached' : null });
        }
        return { ...data, projects: [...projects.values()], items: [...items.values()], cloudProjects: this.summaries() };
    }
    listing(scope, query) {
        const dirty = new Set(this.dirtyIds());
        if (scope.startsWith('active:')) {
            const local = this.store.listing(scope, query);
            return { ...local, items: local.items.map(i => ({ ...i, cloudState: i.projectId ? dirty.has(i.id) ? 'local' : 'cached' : null })) };
        }
        const data = this.decorate({ ...this.store.collections(), projects: this.store.all('project') }), q = String(query || '').toLocaleLowerCase();
        const branches = new Map(this.store.all('branch').map(b => [b.id, b]));
        const items = data.items.flatMap(i => {
            const project = data.projects.find(p => p.id === i.projectId);
            const sessions = i.sessions.filter(s => scope === 'archived' ? s.archived || project?.archived : i.projectId === scope && !s.archived && !project?.archived);
            if (!sessions.length) return [];
            const matching = sessions.filter(s => !q || s.name.toLocaleLowerCase().includes(q) || branches.has(s.id) && parse(this.store.raw(branches.get(s.id).head), s.agent).messages.some(m => m.text.toLocaleLowerCase().includes(q)));
            if (!matching.length && !i.name.toLocaleLowerCase().includes(q)) return [];
            return [{ ...i, sessions, sessionIds: sessions.map(s => s.id), name: sessions.find(s => s.id === i.id)?.name || sessions[0].name, kind: sessions.length > 1 ? 'tree' : 'session', visibleSessionIds: sessions.map(s => s.id), matchedSessionIds: matching.map(s => s.id), visibleCount: sessions.length, groupId: i.projectId, groupName: project?.name }];
        });
        const latest = new Map(); for (const i of items) latest.set(i.groupId, [latest.get(i.groupId) || '', i.updatedAt].sort().at(-1));
        items.sort((a, b) => latest.get(b.groupId).localeCompare(latest.get(a.groupId)) || String(a.groupId).localeCompare(String(b.groupId)) || b.updatedAt.localeCompare(a.updatedAt));
        return { items, itemCount: items.length, sessionCount: items.reduce((n, i) => n + i.visibleCount, 0) };
    }
}
