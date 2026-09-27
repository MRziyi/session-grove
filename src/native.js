import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { assert, atomic, hash, id, inside, json, now, safePath, walk } from './util.js';
import { parse, renderNative } from './transcript.js';
export function coldGuard() {
    let output;
    try {
        output = execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' });
    }
    catch {
        throw new Error('无法检查 Agent 是否仍在运行，暂不写入原生数据');
    }
    const busy = output.split('\n').map(line => line.replace(/^\s*\d+\s+/, '')).filter(command => /(?:^|\/)(codex|claude)(?:\s|$)/i.test(command));
    assert(!busy.length, '请先关闭 Codex / Claude 的运行会话及对应 IDE 扩展，再应用 Active 清单。资料库浏览与分支不受影响。', 409);
}
export class Native {
    constructor(store, options = {}) {
        this.store = store;
        this.roots = options.roots || { codex: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), claude: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') };
        this.guard = options.guard || coldGuard;
        this.catalog = new Map();
        this.jobs = path.join(store.root, 'operations');
        fs.mkdirSync(this.jobs, { recursive: true, mode: 0o700 });
    }
    read(file) {
        assert(fs.statSync(file).size <= 100 * 1024 * 1024, '单条会话超过 100MB，暂不能收纳');
        return fs.readFileSync(file, 'utf8');
    }
    discover() {
        const found = [], errors = [];
        const instances = this.store.instances();
        this.catalog.clear();
        for (const agent of ['codex', 'claude']) {
            const root = this.roots[agent];
            const titles = new Map();
            if (agent === 'codex' && fs.existsSync(path.join(root, 'session_index.jsonl'))) {
                for (const line of this.read(path.join(root, 'session_index.jsonl')).split('\n')) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.id && entry.thread_name)
                            titles.set(entry.id, entry.thread_name);
                    }
                    catch { }
                }
            }
            const dirs = agent === 'codex' ? ['sessions', 'archived_sessions'] : ['projects'];
            for (const dir of dirs)
                for (const file of walk(path.join(root, dir))) {
                    if (agent === 'claude' && (file.includes('/subagents/') || path.basename(file).startsWith('agent-')))
                        continue;
                    try {
                        const raw = this.read(file), p = parse(raw, agent);
                        if (!p.nativeId)
                            continue;
                        const nativeTitle = titles.get(p.nativeId) || p.records.filter(r => r.value?.type === 'custom-title').at(-1)?.value?.customTitle;
                        const item = { key: hash(file), agent, nativeId: p.nativeId, cwd: p.cwd || '', title: nativeTitle || p.messages.find(m => m.role === 'user')?.text.slice(0, 100) || 'Untitled session', messages: p.messages.length, updatedAt: fs.statSync(file).mtime.toISOString(), managed: instances.some(i => i.file === file), warnings: p.warnings, archived: dir === 'archived_sessions' };
                        this.catalog.set(item.key, { ...item, file });
                        found.push(item);
                    }
                    catch (e) {
                        errors.push({ file: path.basename(file), message: e.message });
                    }
                }
        }
        return { sessions: found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), errors };
    }
    import(key, projectId, name, { observe = false } = {}) {
        const item = this.catalog.get(key);
        assert(item, '请先重新扫描，再选择记录');
        const duplicate = this.store.instances().find(i => i.file === item.file);
        if (duplicate)
            return this.store.get('branch', duplicate.branchId);
        const raw = this.read(item.file);
        return this.store.transaction(() => {
            const sidecarDir = item.agent === 'claude' ? path.join(path.dirname(item.file), item.nativeId) : null;
            const requiresAuxiliary = !!(sidecarDir && fs.existsSync(sidecarDir) && fs.readdirSync(sidecarDir).length);
            const b = this.store.branch(projectId, name || item.title, item.agent, raw, { cwd: item.cwd, agent: item.agent, nativeId: item.nativeId, client: 'unknown', operation: 'import', requiresAuxiliary });
            const instances = this.store.instances();
            instances.push({ id: id(), branchId: b.id, agent: b.agent, root: this.roots[b.agent], nativeId: item.nativeId, file: item.file, cwd: item.cwd, desired: observe && !item.archived, applied: !item.archived, baseRevision: b.head, baseline: raw, observedHash: hash(raw), adopted: true, title: item.title, requiresAuxiliary });
            this.store.local('instances', instances);
            return b;
        });
    }
    refreshLocal() {
        const collected = this.collect(), found = this.discover();
        let discovered = 0;
        for (const candidate of found.sessions) {
            if (candidate.managed || candidate.archived)
                continue;
            try {
                this.import(candidate.key, null, candidate.title, { observe: true });
                discovered++;
            }
            catch (e) {
                collected.errors.push({ message: e.message });
            }
        }
        const families = this.store.detectFamilies();
        return { ...collected, discovered, grouped: families.grouped, errors: [...collected.errors, ...found.errors] };
    }
    setActive(branchId, cwd, desired) {
        const b = this.store.get('branch', branchId);
        assert(!desired || !b.archived, '请先恢复归档分支');
        if (desired) {
            assert(typeof cwd === 'string' && path.isAbsolute(cwd) && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory(), '目标必须是本机存在的绝对工程目录');
            cwd = fs.realpathSync(cwd);
        }
        const instances = this.store.instances();
        if (!desired) {
            for (const i of instances.filter(i => i.branchId === branchId))
                i.desired = false;
        }
        else {
            let instance = instances.find(i => i.branchId === branchId && i.cwd === cwd && i.root === this.roots[b.agent]);
            if (!instance) {
                instance = { id: id(), branchId, agent: b.agent, root: this.roots[b.agent], nativeId: id(), cwd, desired: true, applied: false, file: null, baseRevision: b.head, baseline: '', adopted: false };
                instances.push(instance);
            }
            instance.desired = true;
        }
        this.store.local('instances', instances);
        return this.plan();
    }
    collect() {
        const instances = this.store.instances();
        const results = [], errors = [];
        for (const i of instances) {
            if (!i.file || !fs.existsSync(i.file)) {
                if (i.applied)
                    i.missing = true;
                continue;
            }
            try {
                const raw = this.read(i.file);
                i.missing = false;
                if (hash(raw) === i.observedHash)
                    continue;
                const p = parse(raw, i.agent);
                if (p.errors.length || !p.complete) {
                    i.pending = '等待完整轮次';
                    continue;
                }
                const base = this.store.raw(i.baseRevision);
                // Strip the exact materialized prefix, retaining only new native events.
                const logical = raw.startsWith(i.baseline) ? base + raw.slice(i.baseline.length) : raw;
                const b = this.store.ingest(i.branchId, logical, i.baseRevision, { agent: i.agent, nativeId: i.nativeId, cwd: i.cwd, client: 'unknown', operation: 'capture' });
                i.branchId = b.id;
                i.baseRevision = b.head;
                i.baseline = raw;
                i.observedHash = hash(raw);
                i.pending = null;
                results.push({ branchId: b.id, conflict: !!b.conflict });
            }
            catch (e) {
                i.pending = e.message;
                errors.push({ instanceId: i.id, message: e.message });
            }
        }
        this.store.local('instances', instances);
        return { updates: results, errors };
    }
    destination(i) {
        if (i.applied && i.file && inside(i.root, i.file))
            return i.file;
        if (i.agent === 'claude') {
            const encoded = i.cwd.replace(/[^a-zA-Z0-9]/g, '-');
            assert(encoded.length <= 200, '超长 Claude 项目路径暂不支持写回，请选择较短路径');
            return path.join(i.root, 'projects', encoded, `${i.nativeId}.jsonl`);
        }
        const day = new Date().toISOString().slice(0, 10).split('-');
        return path.join(i.root, 'sessions', ...day, `rollout-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}-${i.nativeId}.jsonl`);
    }
    plan() {
        const operations = this.store.instances().flatMap(i => {
            const b = this.store.get('branch', i.branchId);
            if (i.desired && (!i.applied || i.baseRevision !== b.head || i.missing || i.title !== b.name))
                return [{ instanceId: i.id, branchId: b.id, name: b.name, agent: i.agent, action: 'activate', cwd: i.cwd, file: this.destination(i) }];
            if (!i.desired && i.applied)
                return [{ instanceId: i.id, branchId: b.id, name: b.name, agent: i.agent, action: 'deactivate', cwd: i.cwd, file: i.file }];
            return [];
        });
        const pendingRecovery = fs.readdirSync(this.jobs).filter(f => f.endsWith('.json')).map(f => json(path.join(this.jobs, f))).filter(j => ['prepared', 'applying', 'failed'].includes(j.status)).map(j => j.id);
        return { operations, pendingRecovery, note: '仅应用已收纳记录。未收纳的原生会话会继续显示；在收纳箱中可将它们纳入管理。' };
    }
    stateDb(root) {
        const files = fs.existsSync(root) ? fs.readdirSync(root).filter(f => /^state_\d+\.sqlite$/.test(f)) : [];
        assert(files.length <= 1, '发现多个 Codex 状态库，无法安全确定写入目标');
        if (!files.length)
            return null;
        assert(files[0] === 'state_5.sqlite', '暂不支持此 Codex 状态库版本');
        return safePath(root, path.join(root, files[0]));
    }
    apply() {
        this.guard();
        assert(!this.plan().pendingRecovery.length, '存在未完成操作，请先恢复备份', 409);
        this.collect();
        const instances = this.store.instances(), plan = this.plan();
        if (!plan.operations.length)
            return { applied: 0 };
        const job = { id: id(), createdAt: now(), status: 'prepared', files: [], instancesBefore: instances, operations: plan.operations };
        const jobFile = path.join(this.jobs, `${job.id}.json`), dbs = new Map(), writes = new Map();
        const after = structuredClone(instances);
        const backup = file => {
            if (job.files.some(f => f.path === file))
                return;
            job.files.push({ path: file, content: fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null });
        };
        try {
            for (const op of plan.operations) {
                const i = after.find(i => i.id === op.instanceId), b = this.store.get('branch', i.branchId);
                assert(i.root === this.roots[i.agent], '原生存储配置已改变，请重新绑定');
                assert(!i.pending, i.pending || '等待完整记录');
                assert(!i.requiresAuxiliary, '此会话含伴随目录，当前版本尚未完整收纳；拒绝移除或改写原生记录');
                if (i.file && fs.existsSync(i.file))
                    assert(hash(this.read(i.file)) === i.observedHash, '原生记录正在变化，请稍后重试', 409);
                const root = i.root;
                if (i.agent === 'codex' && !dbs.has(root)) {
                    const dbFile = this.stateDb(root);
                    if (dbFile) {
                        const db = new DatabaseSync(dbFile);
                        db.exec('PRAGMA busy_timeout=1000; PRAGMA wal_checkpoint(TRUNCATE)');
                        backup(dbFile);
                        db.exec('BEGIN IMMEDIATE');
                        dbs.set(root, db);
                    }
                    else
                        dbs.set(root, null);
                }
                if (op.action === 'activate') {
                    const raw = this.store.raw(b.head), parsed = parse(raw, b.agent);
                    assert(!this.store.detail(b.id).lineage.some(r => r.source.requiresAuxiliary), '此分支继承了含伴随目录的会话，当前版本尚不支持完整物化');
                    assert(!parsed.warnings.some(w => w.includes('外部附件')), '此会话包含外部附件引用。当前版本可浏览和分支，完整附件迁移尚未支持。');
                    const output = renderNative(raw, b.agent, i.nativeId, i.cwd, b.name);
                    const dest = safePath(root, op.file);
                    assert(!fs.existsSync(dest) || dest === i.file, '目标记录已存在，拒绝覆盖');
                    backup(dest);
                    writes.set(dest, output);
                    if (i.file && i.file !== dest) {
                        backup(i.file);
                        writes.set(i.file, null);
                    }
                    i.file = dest;
                    i.applied = true;
                    i.baseRevision = b.head;
                    i.baseline = output;
                    i.observedHash = hash(output);
                    i.missing = false;
                    i.title = b.name;
                    if (i.agent === 'codex')
                        this.updateCodexDb(dbs.get(root), i, b, parsed);
                }
                else {
                    if (i.file && fs.existsSync(i.file)) {
                        safePath(root, i.file);
                        backup(i.file);
                        const parked = path.join(this.store.root, 'parked', i.id, path.basename(i.file));
                        backup(parked);
                        writes.set(parked, this.read(i.file));
                        writes.set(i.file, null);
                        i.file = parked;
                    }
                    i.applied = false;
                    if (i.agent === 'codex')
                        dbs.get(root)?.prepare('UPDATE threads SET archived=1, archived_at=?, rollout_path=? WHERE id=?').run(Math.floor(Date.now() / 1000), i.file, i.nativeId);
                }
            }
            // Rebuild only our entries; unrelated history stays untouched.
            for (const agent of ['codex', 'claude']) {
                const changed = plan.operations.some(o => o.agent === agent);
                if (!changed)
                    continue;
                const root = this.roots[agent], file = safePath(root, path.join(root, agent === 'codex' ? 'session_index.jsonl' : 'history.jsonl'));
                const managed = new Set(after.filter(i => i.agent === agent).map(i => i.nativeId));
                const existing = fs.existsSync(file) ? this.read(file).split('\n').filter(Boolean) : [];
                const kept = existing.filter(line => {
                    try {
                        const v = JSON.parse(line);
                        return !managed.has(agent === 'codex' ? v.id : v.sessionId);
                    }
                    catch {
                        return true;
                    }
                });
                for (const i of after.filter(i => i.agent === agent && i.applied)) {
                    const b = this.store.get('branch', i.branchId);
                    kept.push(JSON.stringify(agent === 'codex' ? { id: i.nativeId, thread_name: b.name, updated_at: now() } : { display: b.name, pastedContents: {}, timestamp: Date.now(), project: i.cwd, sessionId: i.nativeId }));
                }
                backup(file);
                writes.set(file, kept.length ? kept.join('\n') + '\n' : '');
                if (agent === 'claude') {
                    const dirs = new Set([...instances, ...after].filter(i => i.agent === 'claude' && i.file && inside(path.join(root, 'projects'), i.file)).map(i => path.dirname(i.file)));
                    for (const dir of dirs) {
                        const indexFile = safePath(root, path.join(dir, 'sessions-index.json'));
                        if (!fs.existsSync(indexFile))
                            continue;
                        const index = json(indexFile);
                        assert(index.version === 1 && Array.isArray(index.entries), '不支持的 Claude sessions-index 格式');
                        const entries = index.entries.filter(e => !managed.has(e.sessionId));
                        for (const i of after.filter(i => i.agent === 'claude' && i.applied && path.dirname(i.file) === dir)) {
                            const b = this.store.get('branch', i.branchId), p = parse(i.baseline, 'claude');
                            const previous = index.entries.find(e => e.sessionId === i.nativeId) || {};
                            entries.push({ ...previous, sessionId: i.nativeId, fullPath: i.file, fileMtime: Date.now(), firstPrompt: p.messages.find(m => m.role === 'user')?.text || b.name, summary: b.name, messageCount: p.messages.length, created: previous.created || b.createdAt, modified: now(), projectPath: i.cwd, isSidechain: false });
                        }
                        backup(indexFile);
                        writes.set(indexFile, JSON.stringify({ ...index, entries }));
                    }
                }
            }
            job.files = job.files.map(f => ({ ...f, afterHash: writes.has(f.path) && writes.get(f.path) !== null ? hash(writes.get(f.path)) : null }));
            atomic(jobFile, JSON.stringify(job));
            job.status = 'applying';
            atomic(jobFile, JSON.stringify(job));
            for (const [file, content] of writes) {
                if (content === null)
                    fs.rmSync(file, { force: true });
                else
                    atomic(file, content);
            }
            for (const db of dbs.values()) {
                db?.exec('COMMIT');
                db?.close();
            }
            dbs.clear();
            this.store.local('instances', after);
            job.status = 'complete';
            atomic(jobFile, JSON.stringify(job));
            return { applied: plan.operations.length, backupId: job.id };
        }
        catch (e) {
            for (const db of dbs.values()) {
                try {
                    db?.exec('ROLLBACK');
                    db?.close();
                }
                catch { }
            }
            // Roll back only after an operation journal was durably created.
            if (fs.existsSync(jobFile)) {
                try {
                    this.restoreFiles(job);
                    this.store.local('instances', instances);
                    job.status = 'rolled_back';
                }
                catch (rollback) {
                    job.status = 'failed';
                    job.rollbackError = rollback.message;
                }
                job.error = e.message;
                atomic(jobFile, JSON.stringify(job));
            }
            throw e;
        }
    }
    updateCodexDb(db, i, b, p) {
        if (!db)
            return;
        const columns = db.prepare('PRAGMA table_info(threads)').all();
        assert(['id', 'rollout_path', 'cwd', 'archived'].every(k => columns.some(c => c.name === k)), '不兼容的 Codex threads 表');
        const seconds = Math.floor(Date.now() / 1000), ms = Date.now();
        const values = { id: i.nativeId, rollout_path: i.file, created_at: seconds, updated_at: seconds, source: 'cli', model_provider: p.meta?.model_provider || 'openai', cwd: i.cwd, title: b.name, sandbox_policy: JSON.stringify({ type: 'read-only' }), approval_mode: 'on-request', has_user_event: p.hasUser ? 1 : 0, archived: 0, archived_at: null, cli_version: p.meta?.cli_version || '', first_user_message: p.messages.find(m => m.role === 'user')?.text || '', name: b.name, preview: p.messages.find(m => m.role === 'user')?.text.slice(0, 200) || '', created_at_ms: ms, updated_at_ms: ms, recency_at: seconds, recency_at_ms: ms, history_mode: 'legacy', originator: 'session_grove' };
        for (const c of columns)
            assert(!c.notnull || c.dflt_value !== null || c.name in values, `Codex 新增必需字段 ${c.name}，请更新适配器`);
        const keys = Object.keys(values).filter(k => columns.some(c => c.name === k));
        const updates = keys.filter(k => !['id', 'created_at', 'created_at_ms'].includes(k));
        db.prepare(`INSERT INTO threads (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${updates.map(k => `${k}=excluded.${k}`).join(',')}`).run(...keys.map(k => values[k]));
    }
    restoreFiles(job) {
        for (const f of [...job.files].reverse()) {
            assert(Object.values(this.roots).some(r => inside(r, f.path)) || inside(this.store.root, f.path), '备份路径不在允许范围');
            if (f.content === null)
                fs.rmSync(f.path, { force: true });
            else
                atomic(f.path, Buffer.from(f.content, 'base64'));
            if (f.path.endsWith('.sqlite'))
                for (const suffix of ['-wal', '-shm'])
                    fs.rmSync(f.path + suffix, { force: true });
        }
    }
    recover(jobId) {
        assert(/^[a-f0-9-]{36}$/.test(jobId), '无效备份 ID');
        this.guard();
        const file = path.join(this.jobs, jobId + '.json'), job = json(file, null);
        assert(job && ['prepared', 'applying', 'failed'].includes(job.status), '只能恢复未完成的操作');
        // Preserve any work written since the crash before restoring the old projection.
        const rescue = job.files.map(f => {
            assert(Object.values(this.roots).some(r => inside(r, f.path)) || inside(this.store.root, f.path), '备份路径不在允许范围');
            return { path: f.path, content: fs.existsSync(f.path) ? fs.readFileSync(f.path).toString('base64') : null };
        });
        atomic(path.join(this.store.root, 'recovery-snapshots', `${jobId}-${id()}.json`), JSON.stringify({ createdAt: now(), files: rescue, instances: this.store.instances() }));
        this.restoreFiles(job);
        this.store.local('instances', job.instancesBefore);
        job.status = 'recovered';
        atomic(file, JSON.stringify(job));
        return { recovered: jobId };
    }
}
