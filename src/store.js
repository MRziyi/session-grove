import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { id, now, hash, assert, text, atomic, json } from './util.js';
import { parse, recordRefs, blank } from './transcript.js';
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
    }
    close() { this.db.close(); }
    transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
    } }
    all(kind) { return this.db.prepare('SELECT body FROM entities WHERE kind=?').all(kind).map(x => JSON.parse(x.body)); }
    get(kind, key) { const row = this.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, key); assert(row, `${kind} 不存在`, 404); return JSON.parse(row.body); }
    put(kind, value) { this.db.prepare('INSERT INTO entities VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE entities.kind=excluded.kind').run(kind, value.id, JSON.stringify(value)); return value; }
    local(key, value) {
        if (arguments.length === 2) {
            this.db.prepare('INSERT OR REPLACE INTO local VALUES (?,?)').run(key, JSON.stringify(value));
            return value;
        }
        const r = this.db.prepare('SELECT body FROM local WHERE key=?').get(key);
        return r ? JSON.parse(r.body) : null;
    }
    instances() { return this.local('instances') || []; }
    project(name, description = '') { return this.put('project', { id: id(), name: text(name), description: String(description).slice(0, 2000), createdAt: now(), updatedAt: now() }); }
    revision(raw, parent = null, source = {}) {
        const refs = recordRefs(raw);
        for (const r of refs)
            this.db.prepare('INSERT OR IGNORE INTO objects VALUES (?,?)').run(r.hash, r.body);
        return this.put('revision', { id: id(), parent, refs: refs.map(r => r.hash), createdAt: now(), source: { deviceId: this.device.id, deviceName: this.device.name, ...source } });
    }
    raw(revisionId, end) {
        const rev = this.get('revision', revisionId);
        return rev.refs.slice(0, end ?? rev.refs.length).map(h => { const row = this.db.prepare('SELECT body FROM objects WHERE hash=?').get(h); assert(row, `缺少历史对象 ${h}`, 409); return row.body; }).join('');
    }
    branch(projectId, name, agent, raw = null, source = {}) {
        this.get('project', projectId);
        assert(['codex', 'claude'].includes(agent), '未知 Agent');
        const rev = this.revision(raw ?? blank(agent, source.cwd || ''), null, { agent, ...source });
        return this.put('branch', { id: id(), projectId, name: text(name), agent, head: rev.id, parentId: null, forkRevision: null, forkEnd: 0, archived: false, group: '', createdAt: now(), updatedAt: now() });
    }
    fork(branchId, { name, end, revisionId }) {
        const parent = this.get('branch', branchId), rev = this.get('revision', revisionId || parent.head);
        assert(this.ancestor(rev.id, parent.head), '检查点不属于该分支历史');
        const parsed = parse(this.raw(rev.id), parent.agent);
        end = Number(end);
        assert(parsed.checkpoints.some(c => c.end === end), '只能从已完成的轮次创建分支');
        const revision = this.revision(this.raw(rev.id, end), rev.id, { agent: parent.agent, operation: 'fork' });
        return this.put('branch', { ...parent, id: id(), name: text(name), head: revision.id, parentId: parent.id, forkRevision: rev.id, forkEnd: end, archived: false, createdAt: now(), updatedAt: now() });
    }
    edit(branchId, patch) {
        const b = this.get('branch', branchId);
        if ('name' in patch)
            b.name = text(patch.name);
        if ('group' in patch)
            b.group = String(patch.group).slice(0, 100);
        if ('archived' in patch)
            b.archived = !!patch.archived;
        b.updatedAt = now();
        return this.put('branch', b);
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
        return this.put('branch', b);
    }
    detail(branchId) {
        const b = this.get('branch', branchId), raw = this.raw(b.head), p = parse(raw, b.agent);
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
        return { ...b, messages: p.messages, checkpoints: p.checkpoints, warnings: p.warnings, cwd: p.cwd, records: p.records.length, lineage, instances: this.instances().filter(i => i.branchId === b.id) };
    }
    snapshot() {
        return { device: this.device, projects: this.all('project'), branches: this.all('branch'), instances: this.instances(), stats: this.db.prepare('SELECT COUNT(*) AS objects, COALESCE(SUM(length(body)),0) AS bytes FROM objects').get(), conflicts: this.local('conflicts') || [] };
    }
    exportGraph() { return { schema: 1, projects: this.all('project'), branches: this.all('branch'), revisions: this.all('revision') }; }
    merge(graph, objects) {
        assert(graph?.schema === 1 && Array.isArray(graph.projects) && Array.isArray(graph.branches) && Array.isArray(graph.revisions), '不兼容的同步格式');
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
                else if (old.name !== p.name || old.description !== p.description)
                    conflicts.push({ kind: 'project', local: old, remote: p });
            }
            let forks = 0;
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
                assert(old.agent === b.agent && old.projectId === b.projectId, '分支身份冲突');
                if (old.head !== b.head) {
                    if (this.ancestor(old.head, b.head))
                        this.put('branch', { ...old, head: b.head, updatedAt: b.updatedAt });
                    else if (!this.ancestor(b.head, old.head)) {
                        const forkId = `conflict-${hash(b.id + ':' + b.head).slice(0, 32)}`;
                        if (!this.all('branch').some(x => x.id === forkId)) {
                            this.put('branch', { ...b, id: forkId, parentId: old.id, name: `${b.name} · 远端分歧`, conflict: true });
                            forks++;
                        }
                    }
                }
                if (old.name !== b.name || old.archived !== b.archived || old.group !== b.group)
                    conflicts.push({ kind: 'branch', local: old, remote: b });
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
