import fs from 'node:fs';
import { collections, listing, treeGraph, organize, moveItems } from './workspace.js';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { id, now, hash, assert, text, atomic, json } from './util.js';
import { parse, recordRefs, blank } from './transcript.js';
import { initializeOrganization, metadata, pendingDetail, commitPending, moveTree, forest, detectFamilies } from './organization.js';
export class Store {
    constructor(root) {
        this.root = root;
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        const deviceFile = path.join(root, 'device.json');
        this.device = json(deviceFile, null) || { id: id(), name: os.hostname() };
        atomic(deviceFile, JSON.stringify(this.device));
        this.db = new DatabaseSync(path.join(root, 'grove.sqlite'));
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS entities_kind ON entities(kind);
      CREATE TABLE IF NOT EXISTS objects (hash TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local (key TEXT PRIMARY KEY, body TEXT NOT NULL);`);
        fs.chmodSync(path.join(root, 'grove.sqlite'), 0o600);
        this.version = 0; this.memoCache = new Map(); this.parseCache = new Map(); this.parseBytes = 0;
        this.getStatement = this.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?');
        this.objectStatement = this.db.prepare('SELECT body FROM objects WHERE hash=?');
        this.insertObject = this.db.prepare('INSERT OR IGNORE INTO objects VALUES (?,?)');
        this.allStatement = this.db.prepare('SELECT body FROM entities WHERE kind=?');
        this.entityWrite = this.db.prepare('INSERT INTO entities VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE entities.kind=excluded.kind');
        this.localRead = this.db.prepare('SELECT body FROM local WHERE key=?');
        this.localWrite = this.db.prepare('INSERT OR REPLACE INTO local VALUES (?,?)');
        initializeOrganization(this);
    }
    invalidate() { this.version++; this.memoCache.clear(); }
    memo(key, fn) { if (!this.memoCache.has(key)) this.memoCache.set(key, fn()); return this.memoCache.get(key); }
    parsed(revisionId, agent) {
        const key = agent + ':' + revisionId;
        if (this.parseCache.has(key)) { const entry = this.parseCache.get(key); this.parseCache.delete(key); this.parseCache.set(key, entry); return entry.value; }
        const raw = this.raw(revisionId), value = parse(raw, agent), size = Buffer.byteLength(raw);
        while (this.parseCache.size && (this.parseBytes + size > 24 * 1024 * 1024 || this.parseCache.size >= 24)) { const key = this.parseCache.keys().next().value; this.parseBytes -= this.parseCache.get(key).size; this.parseCache.delete(key); }
        if (size < 24 * 1024 * 1024) { this.parseCache.set(key, { value, size }); this.parseBytes += size; }
        return value;
    }
    close() { this.db.close(); }
    transaction(fn) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        }
        catch (e) {
            this.db.exec('ROLLBACK'); this.invalidate(); this.parseCache.clear(); this.parseBytes = 0; this.instanceCache = undefined;
            throw e;
        }
    }
    all(kind) { return this.allStatement.all(kind).map(x => JSON.parse(x.body)); }
    get(kind, key) { const row = this.getStatement.get(kind, key); assert(row, `${kind} 不存在`, 404); return JSON.parse(row.body); }
    put(kind, value) { this.invalidate(); this.entityWrite.run(kind, value.id, JSON.stringify(value)); return value; }
    local(key, value) {
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
    revision(raw, parent = null, source = {}) {
        const refs = recordRefs(raw);
        for (const r of refs)
            this.insertObject.run(r.hash, r.body);
        return this.put('revision', { id: id(), parent, refs: refs.map(r => r.hash), createdAt: now(), source: { deviceId: this.device.id, deviceName: this.device.name, ...source } });
    }
    raw(revisionId, end) {
        const rev = this.get('revision', revisionId);
        return rev.refs.slice(0, end ?? rev.refs.length).map(h => { const row = this.objectStatement.get(h); assert(row, `缺少历史对象 ${h}`, 409); return row.body; }).join('');
    }
    branch(projectId, name, agent, raw = null, source = {}) {
        if (projectId)
            this.get('project', projectId);
        assert(['codex', 'claude'].includes(agent), '未知 Agent');
        const branchName = text(name);
        const rev = this.revision(raw ?? blank(agent, source.cwd || ''), null, { agent, ...source });
        return this.put('branch', { id: id(), projectId: projectId || null, name: branchName, agent, head: rev.id, nodeHead: null, parentId: null, forkRevision: null, forkEnd: 0, archived: false, group: '', createdAt: now(), updatedAt: now(), contentUpdatedAt: now(), logicalVersion: 1, metaVersion: id(), metaAncestors: [] });
    }
    fork(branchId, { name, end, revisionId }) {
        const parent = this.get('branch', branchId), rev = this.get('revision', revisionId || parent.head);
        assert(this.ancestor(rev.id, parent.head), '检查点不属于该分支历史');
        const parsed = parse(this.raw(rev.id), parent.agent);
        end = Number(end);
        assert(parsed.checkpoints.some(c => c.end === end), '只能从已完成的轮次创建分支');
        const revision = this.revision(this.raw(rev.id, end), rev.id, { agent: parent.agent, operation: 'fork' });
        return this.put('branch', { ...parent, id: id(), name: text(name), head: revision.id, nodeHead: null, layoutHead: null, chatIdentity: null, parentId: parent.id, forkRevision: rev.id, forkEnd: end, forkParentEnd: end, archived: false, synthetic: false, contentUpdatedAt: now(), createdAt: now(), updatedAt: now(), metaVersion: id(), metaAncestors: [] });
    }
    edit(branchId, patch) {
        const b = this.get('branch', branchId), previous = structuredClone(b);
        if ('name' in patch)
            b.name = text(patch.name);
        if ('group' in patch)
            b.group = String(patch.group).slice(0, 100);
        if ('archived' in patch)
            b.archived = !!patch.archived;
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
        const rev = this.revision(raw, b.head, { ...source, rewritten: !raw.startsWith(current) });
        b.head = rev.id;
        b.updatedAt = now();
        b.contentUpdatedAt = b.updatedAt;
        return this.put('branch', b);
    }
    detail(branchId) {
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
            p.warnings.push('来源含尚未收纳的伴随目录；当前版本禁止激活或移除原生实例');
        return { ...b, ...pendingDetail(this, b, p), messages: p.messages, checkpoints: p.checkpoints, warnings: p.warnings, cwd: p.cwd, records: p.records.length, lineage, instances: this.instances().filter(i => i.branchId === b.id).map(({ baseline, observedHash, ...i }) => i) };
    }
    commitPending(branchId, options) { return commitPending(this, branchId, options); }
    moveTree(branchId, projectId, group) { return moveTree(this, branchId, projectId, group); }
    forest(scope) { return forest(this, scope); }
    detectFamilies() { return detectFamilies(this); }
    collections() { return this.memo('collections', () => collections(this)); }
    listing(scope, query) { return listing(this, scope, query); }
    treeGraph(id, view = 'all') { return treeGraph(this, id, view); }
    organize(id, options) { return organize(this, id, options); }
    moveItems(options) { return moveItems(this, options); }
    snapshot() { return this.memo('snapshot', () => this.buildSnapshot()); }
    buildSnapshot() {
        const summaries = Object.fromEntries(this.all('branch').map(b => {
            const { pending, nodes } = pendingDetail(this, b, this.parsed(b.head, b.agent));
            return [b.id, { pendingCount: pending.count, pendingStart: pending.start, pendingEnd: pending.end, nodeIds: nodes.map(n => n.id) }];
        }));
        return { ...this.collections(), device: this.device, projects: this.all('project'), branches: this.all('branch'), nodes: this.all('node'), summaries, localItems: this.forest('local'), projectItems: Object.fromEntries(this.all('project').map(p => [p.id, this.forest(p.id)])), instances: this.instances().map(({ baseline, observedHash, ...i }) => i), stats: this.db.prepare('SELECT COUNT(*) AS objects, COALESCE(SUM(length(body)),0) AS bytes FROM objects').get(), conflicts: this.local('conflicts') || [] };
    }
    exportGraph() { return this.memo('exportGraph', () => this.buildExportGraph()); }
    buildExportGraph() {
        const branches = this.all('branch').filter(b => b.projectId), branchIds = new Set(branches.map(b => b.id));
        const nodes = this.all('node').filter(n => branchIds.has(n.branchId)), revisions = new Map();
        const visit = revisionId => { if (!revisionId || revisions.has(revisionId))
            return; const r = this.get('revision', revisionId); revisions.set(r.id, r); visit(r.parent); };
        for (const b of branches) {
            visit(b.head);
            visit(b.forkRevision);
        }
        for (const n of nodes)
            visit(n.revisionId);
        return { schema: 3, layouts: this.all('layout').filter(l => branchIds.has(l.rootId)), projects: this.all('project'), branches, nodes, revisions: [...revisions.values()] };
    }
    merge(graph, objects) {
        assert([1, 2, 3].includes(graph?.schema) && Array.isArray(graph.projects) && Array.isArray(graph.branches) && Array.isArray(graph.revisions), '不兼容的同步格式');
        assert(graph.revisions.length < 100000 && graph.branches.length < 100000, '远端资料库过大');
        return this.transaction(() => {
            for (const [h, body] of Object.entries(objects)) {
                assert(hash(body) === h, '远端对象校验失败');
                this.db.prepare('INSERT OR IGNORE INTO objects VALUES (?,?)').run(h, body);
            }
            for (const r of graph.revisions) {
                assert(typeof r.id === 'string' && Array.isArray(r.refs) && r.refs.every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)), '无效版本');
                const old = this.db.prepare('SELECT body FROM entities WHERE id=?').get(r.id);
                if (old)
                    assert(old.body === JSON.stringify(r), '不可变版本发生冲突');
                else
                    this.put('revision', r);
            }
            for (const r of graph.revisions) {
                this.raw(r.id);
                if (r.parent)
                    this.get('revision', r.parent);
                const visited = new Set();
                let cursor = r;
                while (cursor) {
                    assert(!visited.has(cursor.id), '版本图存在环');
                    visited.add(cursor.id);
                    cursor = cursor.parent ? this.get('revision', cursor.parent) : null;
                }
            }
            const conflicts = this.local('conflicts') || [];
            for (const p of graph.projects) {
                text(p.name);
                const old = this.all('project').find(x => x.id === p.id);
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
                text(b.name);
                assert(['codex', 'claude'].includes(b.agent), '无效 Agent');
                this.get('project', b.projectId);
                this.get('revision', b.head);
                const old = this.all('branch').find(x => x.id === b.id);
                if (!old) {
                    this.put('branch', b);
                    continue;
                }
                assert(old.agent === b.agent, '分支身份冲突');
                if (old.head !== b.head) {
                    if (this.ancestor(old.head, b.head))
                        this.put('branch', { ...old, head: b.head, updatedAt: b.updatedAt, contentUpdatedAt: b.contentUpdatedAt || b.updatedAt });
                    else if (!this.ancestor(b.head, old.head)) {
                        const forkId = `conflict-${hash(b.id + ':' + b.head).slice(0, 32)}`;
                        if (!this.all('branch').some(x => x.id === forkId)) {
                            this.put('branch', { ...b, id: forkId, chatIdentity: b.chatIdentity || b.id, parentId: old.id, name: `${b.name} · 远端分歧`, conflict: true });
                            forks++;
                        }
                        remapped.set(b.id, forkId);
                    }
                }
                if (old.name !== b.name || old.archived !== b.archived || old.group !== b.group || old.projectId !== b.projectId) {
                    if (b.metaAncestors?.includes(old.metaVersion))
                        this.put('branch', { ...this.get('branch', b.id), name: b.name, archived: b.archived, group: b.group, projectId: b.projectId, metaVersion: b.metaVersion, metaAncestors: b.metaAncestors });
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
                const existing = this.all('node').find(x => x.id === n.id);
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
                const existing = this.all('layout').find(x => x.id === l.id);
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
                if (!b.layoutHead) continue;
                assert(this.get('layout', b.layoutHead).rootId === b.id, 'Layout belongs to another tree.');
                const current = this.get('branch', b.id);
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
                const forkId = remapped.get(b.id), current = this.get('branch', forkId || b.id);
                const remoteHead = b.nodeHead ? (forkId ? `${b.nodeHead}-${forkId}` : b.nodeHead) : null;
                if (forkId || nodeAncestor(current.nodeHead, remoteHead))
                    this.put('branch', { ...current, nodeHead: remoteHead });
                else if (remoteHead && !nodeAncestor(remoteHead, current.nodeHead))
                    conflicts.push({ kind: 'organization', local: { id: current.id, name: this.get('node', current.nodeHead).name, nodeHead: current.nodeHead }, remote: { id: current.id, name: this.get('node', remoteHead).name, nodeHead: remoteHead } });
            }
            for (const b of this.all('branch')) {
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
            for (const b of this.all('branch')) {
                const visited = new Set();
                let cursor = b;
                while (cursor?.parentId) {
                    assert(!visited.has(cursor.id), '分支图存在环');
                    visited.add(cursor.id);
                    cursor = this.get('branch', cursor.parentId);
                    assert(cursor.projectId === b.projectId, '分支父节点不在同一项目');
                }
            }
            this.local('conflicts', [...new Map(conflicts.map(c => [hash(JSON.stringify(c)), c])).values()]);
            return { forks, conflicts: this.local('conflicts').length };
        });
    }
}
