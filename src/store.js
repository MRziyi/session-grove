import {claudeFork} from './claude.js';
import {retainedGraph,bodyRefs,withForkMetadata} from './retention.js';
import {deletedIds,isTrashed} from './trash.js';
import { modifiedAt, nextModifiedAt } from './session-time.js';
import { claudeTitle } from './claude-title.js';
import { sessionExclusion, backgroundKind } from './session-kind.js';
import { supportedHistory } from './codex-history.js';
import { INBOX_ID, inboxProject, cloudProjectId } from './inbox.js';
import { deviceDetails } from './device.js';
import { ledger } from './context-ledger.js';
import fs from 'node:fs';
import { validPolicy } from './context-policy.js';
import { collections, listing, treeGraph, organize, moveItems } from './workspace.js';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { id, now, hash, assert, text, atomic, json } from './util.js';
import { parse, recordRefs, blank } from './transcript.js';
import { initializeOrganization, metadata, pendingDetail, commitPending, moveTree, forest, detectFamilies } from './organization.js';
export class Store {
    constructor(root) {
        this.root = root;
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        const deviceFile = path.join(root, 'device.json');
        const savedDevice = json(deviceFile, null);
        this.device = savedDevice?.platform ? savedDevice : { ...deviceDetails(), ...savedDevice, id: savedDevice?.id || id() };
        atomic(deviceFile, JSON.stringify(this.device));
        this.db = new DatabaseSync(path.join(root, 'grove.sqlite'));
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS entities_kind ON entities(kind);
      CREATE TABLE IF NOT EXISTS objects (hash TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS summaries (id TEXT, agent TEXT, version INTEGER, body TEXT, PRIMARY KEY(id,agent));
      CREATE TABLE IF NOT EXISTS local (key TEXT PRIMARY KEY, body TEXT NOT NULL);`);
        fs.chmodSync(path.join(root, 'grove.sqlite'), 0o600);
        this.version = 0; this.cloudVersion = 0; this.cloudCache = new Map(); this.memoCache = new Map(); this.parseCache = new Map(); this.parseBytes = 0; this.summaryCache = new Map(); this.recordCache = new Map(); this.recordBytes = 0;
        this.getStatement = this.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?');
        this.entityById = this.db.prepare('SELECT body FROM entities WHERE id=?');
        this.objectStatement = this.db.prepare('SELECT body FROM objects WHERE hash=?');
        this.insertObject = this.db.prepare('INSERT OR IGNORE INTO objects VALUES (?,?)');
        this.allStatement = this.db.prepare('SELECT body FROM entities WHERE kind=?');
        this.entityWrite = this.db.prepare('INSERT INTO entities VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE entities.kind=excluded.kind');
        this.localRead = this.db.prepare('SELECT body FROM local WHERE key=?');
        this.localWrite = this.db.prepare('INSERT OR REPLACE INTO local VALUES (?,?)');
        this.summaryRead = this.db.prepare('SELECT body FROM summaries WHERE id=? AND agent=? AND version=5');
        this.summaryWrite = this.db.prepare('INSERT OR REPLACE INTO summaries VALUES (?,?,5,?)');
        initializeOrganization(this);
    }
    invalidate() { this.version++; this.memoCache.clear(); this.graphCache=null; }
    memo(key, fn) { if (!this.memoCache.has(key)) this.memoCache.set(key, fn()); return this.memoCache.get(key); }
    parsed(revisionId, agent, end) {
        const key = agent + ':' + revisionId + (end===undefined?'':':'+end);
        if (this.parseCache.has(key)) { const entry = this.parseCache.get(key); this.parseCache.delete(key); this.parseCache.set(key, entry); return entry.value; }
        let size = 0;
        const records = this.get('revision', revisionId).refs.slice(0,end).map(h => {
            let entry = this.recordCache.get(h);
            if (entry) { this.recordCache.delete(h); this.recordCache.set(h, entry); }
            else {
                const raw = this.objectStatement.get(h)?.body; assert(typeof raw === 'string', `缺少历史对象 ${h}`, 409);
                let value = null; try { value = JSON.parse(raw); } catch {}
                entry = { record: { raw, value }, bytes: Buffer.byteLength(raw) };
                while (this.recordCache.size && (this.recordBytes + entry.bytes > 24 * 1024 * 1024 || this.recordCache.size >= 20000)) {
                    const oldest = this.recordCache.keys().next().value; this.recordBytes -= this.recordCache.get(oldest).bytes; this.recordCache.delete(oldest);
                }
                if (entry.bytes <= 24 * 1024 * 1024) { this.recordCache.set(h, entry); this.recordBytes += entry.bytes; }
            }
            size += entry.bytes; return entry.record;
        });
        const value = parse(null, agent, records);
        while (this.parseCache.size && (this.parseBytes + size > 24 * 1024 * 1024 || this.parseCache.size >= 24)) { const key = this.parseCache.keys().next().value; this.parseBytes -= this.parseCache.get(key).size; this.parseCache.delete(key); }
        // Keep one oversized session rather than reparsing it for every projection.
        if (size <= 100 * 1024 * 1024) { this.parseCache.set(key, { value, size }); this.parseBytes += size; }
        return value;
    }
    summary(revisionId, agent) {
        const key = agent + ':' + revisionId; if (this.summaryCache.has(key)) return this.summaryCache.get(key);
        const saved = this.summaryRead.get(revisionId, agent); if (saved) { const value = JSON.parse(saved.body); this.summaryCache.set(key, value); return value; }
        return this.rememberSummary(revisionId,agent,this.parsed(revisionId,agent));
    }
    rememberSummary(revisionId,agent,p) {
        const key=agent+':'+revisionId, chats = p.messages.filter(m => m.role !== 'tool').length;
        const firstHuman = p.records.find(r => r.value?.type === 'user' && !r.value.isMeta)?.value;
        const title = agent === 'claude' ? claudeTitle(p.records) : null;
        const provenance = {initialization: title?.initialization,agent,source:p.meta?.source,threadSource:p.meta?.thread_source,sidechain:agent==='claude'&&p.records.find(r=>['user','assistant'].includes(r.value?.type))?.value?.isSidechain===true,originKind:firstHuman?.origin?.kind,sessionKind:p.records.find(r=>r.value?.sessionKind)?.value.sessionKind};
        const value = { chats, nativeTitle: title?.title, firstUser:title?.prompt || (()=>{const v=p.messages.find(m=>m.role==='user')?.text;return v===undefined?undefined:JSON.parse(JSON.stringify(v.slice(0,100)));})(), complete: p.complete && !p.errors.length, external: p.warnings.some(w=>w.includes('外部附件')), nativeId:p.nativeId, cwd:p.cwd, mode:p.meta?.history_mode, forkedFrom:p.meta?.forked_from_id || p.meta?.forkedFromId, forkOrdinal:p.meta?.forked_from_ordinal_exclusive, forkEnd:p.meta?.forked_from_ordinal_exclusive == null ? -1 : p.records.findIndex(r=>r.value?.ordinal >= p.meta.forked_from_ordinal_exclusive), supported:supportedHistory(p),
            lastActivity: p.messages.reduce((latest,m)=>typeof m.timestamp==='string'&&Number.isFinite(Date.parse(m.timestamp))&&(!latest||Date.parse(m.timestamp)>Date.parse(latest))?m.timestamp:latest,null) || p.meta?.timestamp || null,
            background: backgroundKind(provenance), titleSource: title?.titleSource || 'first-prompt',
            excluded:sessionExclusion({...provenance,chats}) };
        if(this.summaryCache.size >= 4096) this.summaryCache.delete(this.summaryCache.keys().next().value);
        this.summaryCache.set(key,value); if (!revisionId.startsWith('scan:')) this.summaryWrite.run(revisionId, agent, JSON.stringify(value)); return value;
    }
    activity(revisionId, agent, end) { const p = this.parsed(revisionId, agent, end), entry = this.parseCache.get(agent + ':' + revisionId + (end===undefined?'':':'+end)); if (entry) return entry.ledger ||= ledger(p, agent); return ledger(p, agent); }
    close() { this.db.close(); }
    transaction(fn) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        }
        catch (e) {
            this.db.exec('ROLLBACK'); this.invalidate(); this.parseCache.clear(); this.parseBytes = 0; this.recordCache.clear(); this.recordBytes = 0; this.instanceCache = undefined; this.summaryCache.clear(); this.cloudCache.clear(); this.cloudVersion++;
            throw e;
        }
    }
    all(kind) { return this.allStatement.all(kind).map(x => JSON.parse(x.body)); }
    get(kind, key) { const row = this.getStatement.get(kind, key); assert(row, `${kind} 不存在`, 404); return JSON.parse(row.body); }
    find(kind, key) { const row = this.getStatement.get(kind, key); return row ? JSON.parse(row.body) : undefined; }
    put(kind, value) { this.invalidate(); this.entityWrite.run(kind, value.id, JSON.stringify(value)); return value; }
    local(key, value, options = {}) {
        if (key.startsWith('cloud:')) {
            if (!this.cloudCache.has(key)) { const body = this.localRead.get(key)?.body; this.cloudCache.set(key, { body, value: body ? JSON.parse(body) : null }); }
            const cached = this.cloudCache.get(key);
            if (arguments.length === 1) return cached.value;
            const body = JSON.stringify(value);
            if (body !== cached.body) { this.localWrite.run(key, body); if (!options.quiet) this.cloudVersion++; this.cloudCache.set(key, { body, value: JSON.parse(body) }); }
            return value;
        }

        if (key === 'instances') {
            if (this.instanceCache === undefined) { const row = this.localRead.get(key); this.instanceCache = row ? JSON.parse(row.body) : []; }
            if (arguments.length === 2) {
                const same = this.instanceCache.length === value.length && value.every((v, i) => Object.keys(v).length === Object.keys(this.instanceCache[i]).length && Object.keys(v).every(k => v[k] === this.instanceCache[i][k]));
                if (!same) { this.invalidate(); this.localWrite.run(key, JSON.stringify(value)); this.instanceCache = value.map(i => ({ ...i })); }
                return value;
            }
            // Instance fields are scalar. Reuse immutable baseline strings rather than
            // parsing/copying the complete native library on every state or plan read.
            return this.instanceCache.map(i => ({ ...i }));
        }
        if (arguments.length === 2) {
            if (JSON.stringify(this.local(key)) === JSON.stringify(value)) return value;
            if (key === 'instances' || key === 'conflicts') this.invalidate();
            this.localWrite.run(key, JSON.stringify(value));
            return value;
        }
        const r = this.localRead.get(key);
        return r ? JSON.parse(r.body) : null;
    }
    instances() { return this.local('instances') || []; }
    project(name, description = '') { return this.put('project', { id: id(), name: text(name), description: String(description).slice(0, 2000), createdAt: now(), updatedAt: now(), metaVersion: id(), metaAncestors: [] }); }
    revision(raw, parent = null, source = {}, prefixRaw = null) {
        const inherited = parent && prefixRaw !== null && prefixRaw.endsWith('\n') && raw.startsWith(prefixRaw) ? this.get('revision',parent).refs : [];
        const refs = recordRefs(inherited.length ? raw.slice(prefixRaw.length) : raw);
        for (const r of refs)
            this.insertObject.run(r.hash, r.body);
        return this.put('revision', { id: id(), parent, refs: [...inherited, ...refs.map(r => r.hash)], createdAt: now(), source: { deviceId: this.device.id, deviceName: this.device.name, deviceModel: this.device.model, devicePlatform: this.device.platform, deviceKind: this.device.kind, ...source } });
    }
    availableRaw(revisionId) { return this.get('revision',revisionId).refs.map(h=>this.objectStatement.get(h)?.body||'\n').join(''); }
    raw(revisionId, end) {
        const rev = this.get('revision', revisionId);
        return rev.refs.slice(0, end ?? rev.refs.length).map(h => { const row = this.objectStatement.get(h); assert(row, `缺少历史对象 ${h}`, 409); return row.body; }).join('');
    }
    branch(projectId, name, agent, raw = null, source = {}) {
        if (projectId)
            this.get('project', projectId);
        assert(['codex', 'claude'].includes(agent), '未知 Agent');
        const branchName = text(name, 'Session name', source.operation === 'import' ? 10000 : 200);
        const rev = this.revision(raw ?? blank(agent, source.cwd || ''), null, { agent, ...source });
        return this.put('branch', { id: id(), projectId: projectId || null, name: branchName, agent, head: rev.id, nodeHead: null, parentId: null, forkRevision: null, forkEnd: 0, archived: false, group: '', createdAt: now(), updatedAt: now(), contentUpdatedAt: now(), logicalVersion: 1, metaVersion: id(), metaAncestors: [] });
    }
    fork(branchId, { name, end, revisionId, nodeId, graphVersion }) {
        const parent = this.get('branch', branchId), rev = this.get('revision', revisionId || parent.head);
        assert(!isTrashed(this,parent.id) && !parent.excluded && !parent.archived && !(parent.projectId && this.get('project', parent.projectId).archived), 'Restore this session before organizing.');
        assert(this.ancestor(rev.id, parent.head), '检查点不属于该分支历史');
        const parsed = parse(this.raw(rev.id), parent.agent);
        end = Number(end);
        if(nodeId){const graph=this.treeGraph(branchId,'in-use'),route=graph.paths.find(p=>p.branchId===branchId),node=graph.nodes.find(n=>n.id===nodeId);assert(graph.version===graphVersion,'Conversation changed. Refresh before organizing.',409);assert(route&&node&&route.nodeIds.indexOf(nodeId)>0,'Cannot fork before the root node.');const first=route.messages.find(m=>node.chatIds.includes(m.id));const previous=first?route.messages[route.messages.indexOf(first)-1]:route.messages.at(-1);const checkpoint=route.checkpoints.findLast(c=>c.end>=previous?.line&&(!first||c.end<first.line));assert(checkpoint&&checkpoint.end===end,'Fork requires a complete turn before the selected node.');}

        assert(parsed.checkpoints.some(c => c.end === end), '只能从已完成的轮次创建分支');
        const contextPolicy = parent.contextPolicy ? { disabled: parent.contextPolicy.disabled.filter(id => parsed.context.compactions.some(e => e.id === id && e.line <= end)) } : undefined;
        const revision = this.revision(this.raw(rev.id, end), rev.id, { agent: parent.agent, operation: 'fork', ...(parent.agent === 'claude' ? { claudeCheckpoint: parsed.checkpoints.find(c => c.end === end).turnId } : {}) });
        return this.put('branch', { ...parent, contextPolicy, id: id(), name: text(name), head: revision.id, nodeHead: null, layoutHead: null, endpointName: null, chatIdentity: null, parentId: parent.id, forkRevision: rev.id, forkEnd: end, forkParentEnd: end, archived: false, synthetic: false, inferred: false, nativeLinked: false, prefixUnavailable: false, createdViaGroveFork: true, contentUpdatedAt: now(), createdAt: now(), updatedAt: now(), metaVersion: id(), metaAncestors: [] });
    }
    edit(branchId, patch) {
        const b = this.get('branch', branchId), previous = structuredClone(b);
        if ('name' in patch) {
            const name = text(patch.name);
            if (name !== b.name) { b.name = name; b.groveNamed = true; }
        }
        if ('endpointName' in patch) b.endpointName = text(patch.endpointName, 'Node title');
        if ('group' in patch)
            b.group = String(patch.group).slice(0, 100);
        if ('contextPolicy' in patch) { assert(validPolicy(patch.contextPolicy), 'Invalid context policy.'); b.contextPolicy = patch.contextPolicy; }
        if ('archived' in patch)
            b.archived = !!patch.archived;
        if ('archived' in patch && b.background) b.backgroundManaged = true;
        if (JSON.stringify(b) === JSON.stringify(previous)) return b;
        b.updatedAt = now();
        return this.put('branch', metadata(previous, b));
    }
    ancestor(older, newer) {
        const seen = new Set();
        while (newer && !seen.has(newer)) {
            if (older === newer)
                return true;
            seen.add(newer);
            newer = this.get('revision', newer).parent;
        }
        return false;
    }
    ingest(branchId, raw, baseRevision, source) {
        const b = this.get('branch', branchId), current = this.raw(b.head);
        if (raw === current || raw === this.raw(baseRevision))
            return b;
        const base = this.raw(baseRevision);
        if (b.head !== baseRevision && !raw.startsWith(current)) {
            const child = this.branch(b.projectId, `${b.name} · ${source.deviceName || this.device.name} 更新`, b.agent, raw, source);
            child.parentId = b.id;
            child.forkRevision = baseRevision;
            child.forkEnd = recordRefs(base).length;
            child.conflict = true;
            return this.put('branch', child);
        }
        // A rewritten log is retained in full; no destructive line union or timestamp ordering.
        const rev = this.revision(raw, b.head, { ...source, rewritten: !raw.startsWith(current) }, current);
        const previousContentTime = b.contentUpdatedAt || b.updatedAt;
        b.head = rev.id;
        b.updatedAt = nextModifiedAt(b);
        b.contentUpdatedAt = source.operation === 'native-settings' ? previousContentTime : b.updatedAt;
        return this.put('branch', b);
    }
    detail(branchId) {
        assert(!isTrashed(this,branchId),'This session is in Trash.',410);
        const b = this.get('branch', branchId), cached = this.parsed(b.head, b.agent), p = { ...cached, warnings: [...cached.warnings] };
        const lineage = [];
        let r = this.get('revision', b.head);
        const seen = new Set();
        while (r && !seen.has(r.id)) {
            seen.add(r.id);
            lineage.push({ ...r, refs: undefined, records: r.refs.length });
            r = r.parent ? this.get('revision', r.parent) : null;
        }
        if (lineage.some(r => r.source.requiresAuxiliary))
            if (!lineage.some(r => r.source.auxiliary) && !(b.agent === 'claude' && lineage[0]?.source.operation === 'fork')) p.warnings.push('来源含尚未收纳的伴随目录；当前版本禁止激活或移除原生实例');
        if (b.prefixUnavailable) p.warnings.push('Native parent is known, but its shared prefix was changed or compacted. Ancestry is retained without merging unverifiable chats.');
        return { ...b, nativeTitleSource: this.summary(b.head,b.agent).titleSource, ...pendingDetail(this, b, p), messages: p.messages, checkpoints: p.checkpoints, warnings: p.warnings, cwd: p.cwd, records: p.records.length, lineage, instances: this.instances().filter(i => i.branchId === b.id).map(({ baseline, observedHash, ...i }) => i) };
    }
    setCompaction(branchId, { eventId, enabled, head }) {
        const b = this.get('branch', branchId); assert(!isTrashed(this,b.id)&&!b.archived && !b.excluded && !(b.projectId && this.get('project', b.projectId).archived), 'Restore this session before organizing.');
        assert(b.head === head, 'Conversation changed. Refresh before organizing.', 409);
        assert(typeof enabled === 'boolean', 'Choose whether compaction is enabled.');
        const event = this.parsed(b.head, b.agent).context.compactions.find(e => e.id === eventId);
        assert(event && (enabled || event.canDisable), 'Original pre-compaction history is unavailable.');
        const disabled = new Set(b.contextPolicy?.disabled || []); enabled ? disabled.delete(eventId) : disabled.add(eventId);
        const contextPolicy = { disabled: [...disabled].sort() };
        if (JSON.stringify(b.contextPolicy || { disabled: [] }) !== JSON.stringify(contextPolicy)) this.edit(b.id, { contextPolicy });
        return contextPolicy;
    }
    commitPending(branchId, options) { return commitPending(this, branchId, options); }
    moveTree(branchId, projectId, group) { return moveTree(this, branchId, projectId, group); }
    forest(scope) { return forest(this, scope); }
    detectFamilies() { return detectFamilies(this); }
    collections() { return this.memo('collections', () => collections(this)); }
    syncCollections() { return this.memo('sync-collections', () => collections(this, true)); }
    listing(scope, query) { return listing(this, scope, query); }
    treeGraph(id, view = 'all') {
        const key = `${this.version}:${id}:${view}`;
        if(this.graphCache?.key===key)return this.graphCache.value;
        const value=treeGraph(this,id,view);this.graphCache={key,value};return value;
    }
    organize(id, options) { return organize(this, id, options); }
    moveItems(options) { return moveItems(this, options); }
    snapshot() { return this.memo('snapshot', () => this.buildSnapshot()); }
    buildSnapshot() {
        return { ...this.collections(), device:this.device, projects:this.all('project'), branches:this.all('branch').filter(b=>!b.excluded&&!isTrashed(this,b.id)),
            instances:this.instances().filter(i=>!i.excluded).map(({baseline,observedHash,summaryJson,summaryRevision,summaryVersion,observedStamp,...i})=>i), conflicts:this.local('conflicts') || [] };
    }

    isTrashed(id) { return isTrashed(this,id); }
    exportGraph() { return this.memo('exportGraph', () => this.buildExportGraph()); }
    buildExportGraph() {
        const all = this.all('branch'), wanted = new Set(this.syncCollections().items.flatMap(i => [i.id, ...i.sessionIds]));
        // Preserve frozen ancestry dependencies, while excluding unrelated helpers.
        for (const id of [...wanted]) { let b = this.get('branch', id); while (b.parentId) { wanted.add(b.parentId); b = this.get('branch', b.parentId); } }
        const branches = all.filter(b => wanted.has(b.id)).map(b => ({ ...b, projectId: cloudProjectId(b.projectId) })), branchIds = new Set(branches.map(b => b.id));
        const nodes = this.all('node').filter(n => branchIds.has(n.branchId)), revisions = new Map();
        const visit = revisionId => { if (!revisionId || revisions.has(revisionId))
            return; const r = this.get('revision', revisionId); revisions.set(r.id, r); visit(r.parent); };
        for (const b of branches) {
            visit(b.head);
            visit(b.forkRevision);
        }
        for (const n of nodes)
            visit(n.revisionId);
        const graph = { schema: 3, layouts: this.all('layout').filter(l => branchIds.has(l.rootId)), projects: [...this.all('project'), ...(branches.some(b => b.projectId === INBOX_ID) ? [inboxProject()] : [])], branches, nodes, revisions: [...revisions.values()] };
        return this.local('trashState')||this.local('trashPending')?.length ? retainedGraph(withForkMetadata(graph,h=>this.objectStatement.get(h)?.body,claudeFork,deletedIds(this,graph)),deletedIds(this,graph)) : graph;
    }
    merge(graph, objects, { latest = false, protectedIds = new Set() } = {}) {
        assert([1, 2, 3].includes(graph?.schema) && Array.isArray(graph.projects) && Array.isArray(graph.branches) && Array.isArray(graph.revisions), '不兼容的同步格式');
        assert(graph.revisions.length < 100000 && graph.branches.length < 100000, '远端资料库过大');
        graph = { ...graph, projects: graph.projects.filter(p => p.id !== INBOX_ID), branches: graph.branches.map(b => b.projectId === INBOX_ID ? { ...b, projectId: null } : b) };
        return this.transaction(() => {
            for (const [h, body] of Object.entries(objects)) {
                assert(hash(body) === h, '远端对象校验失败');
                this.insertObject.run(h, body);
            }
            for (const r of graph.revisions) {
                assert(typeof r.id === 'string' && Array.isArray(r.refs) && r.refs.every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)), '无效版本');
                const old = this.entityById.get(r.id);
                if (old)
                    assert(old.body === JSON.stringify(r), '不可变版本发生冲突');
                else
                    this.put('revision', r);
            }
            const checkedObjects = new Set(), checkedRevisions = new Set(), revisions = new Map(graph.revisions.map(r=>[r.id,r]));
            const objectExists = this.db.prepare('SELECT 1 FROM objects WHERE hash=?');
            const retained=new Set(bodyRefs(graph));
            if(graph.retention?.extras)this.local('retentionExtras',{...this.local('retentionExtras'),...graph.retention.extras});
            for (const r of graph.revisions) {
                for (const h of r.refs) if (retained.has(h) && !checkedObjects.has(h)) { assert(objectExists.get(h), `缺少历史对象 ${h}`, 409); checkedObjects.add(h); }
                const visited = new Set(); let cursor = r;
                while (cursor && !checkedRevisions.has(cursor.id)) {
                    assert(!visited.has(cursor.id), '版本图存在环'); visited.add(cursor.id);
                    cursor = cursor.parent ? revisions.get(cursor.parent) || this.get('revision',cursor.parent) : null;
                }
                for (const id of visited) checkedRevisions.add(id);
            }
            const conflicts = this.local('conflicts') || [], winners = new Map();
            let keptLocal = 0, appliedRemote = 0;
            for (const p of graph.projects) {
                text(p.name);
                const old = this.find('project', p.id);
                if (latest && old && JSON.stringify(old) !== JSON.stringify(p)) {
                    if ((p.updatedAt || '') > (old.updatedAt || '')) { this.put('project', p); continue; }
                    if ((p.updatedAt || '') < (old.updatedAt || '')) { keptLocal++; continue; }
                }
                if (!old)
                    this.put('project', p);
                else if (old.name !== p.name || old.description !== p.description || !!old.archived !== !!p.archived) {
                    if (p.metaAncestors?.includes(old.metaVersion))
                        this.put('project', p);
                    else if (!old.metaAncestors?.includes(p.metaVersion))
                        conflicts.push({ kind: 'project', local: old, remote: p });
                }
            }
            let forks = 0;
            const remapped = new Map();
            for (const b of graph.branches) {
                text(b.name, 'Session name', 10000); assert(validPolicy(b.contextPolicy), 'Invalid context policy.');
                assert(['codex', 'claude'].includes(b.agent), '无效 Agent');
                if (b.projectId) this.get('project', b.projectId);
                this.get('revision', b.head);
                const old = this.find('branch', b.id);
                if(isTrashed(this,b.id)&&!b.trashDependency)continue;
                if(b.trashDependency){this.put('branch',{...b,layoutHead:old?.layoutHead||b.layoutHead});continue;}
                if (!old) {
                    this.put('branch', b);
                    continue;
                }
                assert(old.agent === b.agent, '分支身份冲突');
                if (latest) {
                    const incomingTime = modifiedAt(b), localTime = modifiedAt(old);
                    if (protectedIds.has(b.id) || incomingTime < localTime) { winners.set(b.id, 'local'); keptLocal++; continue; }
                    if (incomingTime > localTime) { this.put('branch', { ...old, ...b }); winners.set(b.id, 'remote'); appliedRemote++; continue; }
                    if (b.head !== old.head && !this.ancestor(old.head, b.head) && !this.ancestor(b.head, old.head)) {
                        conflicts.push({ kind: 'session', local: old, remote: b }); winners.set(b.id, 'local'); keptLocal++; continue;
                    }
                }
                if ((b.metadataUpdatedAt || '') > (old.metadataUpdatedAt || ''))
                    this.put('branch', { ...old, metadataUpdatedAt: b.metadataUpdatedAt });
                if (old.head !== b.head) {
                    if (this.ancestor(old.head, b.head))
                        this.put('branch', { ...this.get('branch', b.id), head: b.head, updatedAt: b.updatedAt, contentUpdatedAt: b.contentUpdatedAt || b.updatedAt });
                    else if (!this.ancestor(b.head, old.head)) {
                        const forkId = `conflict-${hash(b.id + ':' + b.head).slice(0, 32)}`;
                        if (!this.getStatement.get('branch', forkId)) {
                            this.put('branch', { ...b, id: forkId, chatIdentity: b.chatIdentity || b.id, parentId: old.id, name: `${b.name} · 远端分歧`, conflict: true });
                            forks++;
                        }
                        remapped.set(b.id, forkId);
                    }
                }
                if (old.name !== b.name || old.endpointName !== b.endpointName || old.archived !== b.archived || old.group !== b.group || old.projectId !== b.projectId || old.parentId !== b.parentId || old.forkRevision !== b.forkRevision || JSON.stringify(old.contextPolicy || {}) !== JSON.stringify(b.contextPolicy || {})) {
                    if (b.metaAncestors?.includes(old.metaVersion))
                        this.put('branch', { ...this.get('branch', b.id), name: b.name, endpointName: b.endpointName, archived: b.archived, group: b.group, projectId: b.projectId, contextPolicy: b.contextPolicy, parentId: b.parentId, forkRevision: b.forkRevision, forkEnd: b.forkEnd, forkParentEnd: b.forkParentEnd, metaVersion: b.metaVersion, metaAncestors: b.metaAncestors });
                    else if (!old.metaAncestors?.includes(b.metaVersion))
                        conflicts.push({ kind: 'branch', local: old, remote: b });
                }
            }
            for (const incoming of graph.nodes || []) {
                text(incoming.name, 'Node name');
                this.get('branch', incoming.branchId);
                const revision = this.get('revision', incoming.revisionId);
                assert(Number.isInteger(incoming.start) && Number.isInteger(incoming.end) && incoming.start >= 0 && incoming.end > incoming.start && incoming.end <= revision.refs.length, 'Invalid logical node range');
                const forkId = remapped.get(incoming.branchId);
                const n = forkId ? { ...incoming, id: `${incoming.id}-${forkId}`, previousId: incoming.previousId ? `${incoming.previousId}-${forkId}` : null, branchId: forkId } : incoming;
                const existing = this.find('node', n.id);
                if (existing)
                    assert(JSON.stringify(existing) === JSON.stringify(n), 'Immutable node conflict');
                else
                    this.put('node', n);
            }
            for (const l of graph.layouts || []) {
                assert(typeof l.id === 'string' && l.assignments && typeof l.assignments === 'object' && !Array.isArray(l.assignments), 'Invalid organization layout.');
                this.get('branch', l.rootId);
                for (const [key, value] of Object.entries(l.assignments)) {
                    assert(typeof key === 'string' && key.length < 200, 'Invalid chat reference.');
                    if (value !== null) { assert(typeof value.id === 'string', 'Invalid node identity.'); text(value.name, 'Node name'); }
                }
                const existing = this.find('layout', l.id);
                if (existing) assert(JSON.stringify(existing) === JSON.stringify(l), 'Immutable layout conflict.');
                else this.put('layout', l);
            }
            const layoutAncestor = (older, newer) => {
                if (!older) return true;
                const seen = new Set(), pending = [newer];
                while (pending.length) {
                    const id = pending.pop();
                    if (!id || seen.has(id)) continue;
                    if (id === older) return true;
                    seen.add(id);
                    const layout = this.get('layout', id);
                    pending.push(layout.parent, ...(layout.mergeParents || []));
                }
                return false;
            };
            const checkedLayouts = new Set();
            const checkLayout = (l, visiting = new Set()) => {
                if (checkedLayouts.has(l.id)) return;
                assert(!visiting.has(l.id), 'Organization history contains a cycle.');
                visiting.add(l.id);
                for (const id of [l.parent, ...(l.mergeParents || [])].filter(Boolean)) {
                    const parent = this.get('layout', id);
                    assert(parent.rootId === l.rootId, 'Invalid organization history.');
                    checkLayout(parent, visiting);
                }
                visiting.delete(l.id); checkedLayouts.add(l.id);
            };
            for (const l of graph.layouts || []) checkLayout(l);
            for (const b of graph.branches) {
                if (winners.get(b.id) === 'local') continue;
                if (!b.layoutHead) continue;
                assert(this.get('layout', b.layoutHead).rootId === b.id, 'Layout belongs to another tree.');
                const current = this.get('branch', b.id);
                if (current.layoutHead === b.layoutHead) continue;
                if (layoutAncestor(current.layoutHead, b.layoutHead)) this.put('branch', { ...current, layoutHead: b.layoutHead });
                else if (!layoutAncestor(b.layoutHead, current.layoutHead)) conflicts.push({ kind: 'layout', local: { id: b.id, name: b.name, layoutHead: current.layoutHead }, remote: { id: b.id, name: b.name, layoutHead: b.layoutHead } });
            }
            const nodeAncestor = (older, newer) => {
                if (!older)
                    return true;
                const seen = new Set();
                while (newer) {
                    assert(!seen.has(newer), 'Logical node chain contains a cycle');
                    if (newer === older)
                        return true;
                    seen.add(newer);
                    newer = this.get('node', newer).previousId;
                }
                return false;
            };
            for (const b of graph.branches) {
                if (winners.get(b.id) === 'local') continue;
                const forkId = remapped.get(b.id), current = this.get('branch', forkId || b.id);
                const remoteHead = b.nodeHead ? (forkId ? `${b.nodeHead}-${forkId}` : b.nodeHead) : null;
                if (current.nodeHead === remoteHead) continue;
                if (forkId || nodeAncestor(current.nodeHead, remoteHead))
                    this.put('branch', { ...current, nodeHead: remoteHead });
                else if (remoteHead && !nodeAncestor(remoteHead, current.nodeHead))
                    conflicts.push({ kind: 'organization', local: { id: current.id, name: this.get('node', current.nodeHead).name, nodeHead: current.nodeHead }, remote: { id: current.id, name: this.get('node', remoteHead).name, nodeHead: remoteHead } });
            }
            const branches = this.all('branch');
            if (latest) {
                const roots = new Map(branches.map(b => [b.id, b]));
                for (const b of branches) {
                    let root = b; const seen = new Set();
                    while (root.parentId && !seen.has(root.id)) { seen.add(root.id); root = roots.get(root.parentId); assert(root, 'Parent session is missing.'); }
                    if (b.projectId !== root.projectId) { b.projectId = root.projectId; this.put('branch', b); }
                }
            }
            for (const b of branches) {
                let cursor = b.nodeHead, end = Infinity;
                const seen = new Set();
                while (cursor) {
                    assert(!seen.has(cursor), 'Logical node chain contains a cycle');
                    seen.add(cursor);
                    const n = this.get('node', cursor);
                    assert(n.branchId === b.id && n.end <= end, 'Logical node ranges overlap or cross sessions');
                    end = n.start;
                    cursor = n.previousId;
                }
            }
            // Validate imported project graphs before committing any remote state.
            const byId = new Map(branches.map(b => [b.id, b])), checkedBranches = new Set();
            for (const b of branches) {
                const visited = new Set();
                let cursor = b;
                while (cursor?.parentId && !checkedBranches.has(cursor.id)) {
                    assert(!visited.has(cursor.id), '分支图存在环');
                    visited.add(cursor.id);
                    const parent = byId.get(cursor.parentId);
                    assert(parent, 'Parent session is missing.');
                    assert(cursor.projectId === parent.projectId, '分支父节点不在同一项目');
                    cursor = parent;
                }
                for (const id of visited) checkedBranches.add(id);
            }
            this.local('conflicts', [...new Map(conflicts.map(c => [hash(JSON.stringify(c)), c])).values()]);
            return { forks, conflicts: this.local('conflicts').length, keptLocal, appliedRemote };
        });
    }
}
