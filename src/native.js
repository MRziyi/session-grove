import {isTrashed,nativeSuppressed} from './trash.js';
import { claudeTitle } from './claude-title.js';
import { groveTitle } from './node-activation.js';
import { preferences } from './preferences.js';
import { readCodexHistory, codexFiles } from './codex-history.js';
import fs from 'node:fs';
import { policyHash } from './context-policy.js';
import { metadata } from './organization.js';
import { sessionExclusion, backgroundKind, BACKGROUND_PROJECT } from './session-kind.js';
import { auxiliarySnapshot, auxiliaryWrites, auxiliaryStamp } from './auxiliary.js';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { assert, atomic, hash, id, inside, json, now, safePath, walk } from './util.js';
import { parse, renderNative } from './transcript.js';
export function coldGuard(agents = ['codex', 'claude']) {
    let output;
    try {
        output = execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' });
    }
    catch {
        throw new Error('无法检查 Agent 是否仍在运行，暂不写入原生数据');
    }
    const busy = output.split('\n').map(line => line.replace(/^\s*\d+\s+/, '')).filter(command => /(?:^|\/)(codex|claude)(?:\s|$)/i.test(command));
    assert(!busy.some(command => agents.some(agent => new RegExp('(?:^|/)' + agent + '(?:\\s|$)', 'i').test(command))), '请先关闭目标 Agent 的运行会话及对应 IDE 扩展，再应用 Active 清单。资料库浏览与分支不受影响。', 409);
}
export class Native {
    constructor(store, options = {}) {
        this.store = store;
        this.roots = options.roots || { codex: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), claude: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') };
        this.guard = options.guard || coldGuard;
        this.catalog = new Map(); this.scanCache = new Map(); this.observedStats = new Map();
        this.jobs = path.join(store.root, 'operations');
        fs.mkdirSync(this.jobs, { recursive: true, mode: 0o700 });
        // Adopted logs are already stored as immutable revisions. A null baseline
        // references that revision instead of duplicating the whole log in local state.
        const instances = store.instances(); let compacted = false;
        for (const i of instances) {
            if(isTrashed(store,i.branchId)){if(i.baseline){i.baseline=null;compacted=true;}continue;}
            if (i.summaryVersion === 5 && i.summaryRevision === i.baseRevision && i.summaryJson) { try { store.summaryCache.set(i.agent+':'+i.baseRevision,JSON.parse(i.summaryJson)); } catch {} }
            if (i.adopted && i.baseline) { i.baseline=null; compacted=true; }
            else if (i.baseline && i.baseRevision && i.baseline === store.raw(i.baseRevision)) { i.baseline = null; compacted = true; }
        }
        if (compacted) store.local('instances', instances);
    }
    read(file) {
        assert(fs.statSync(file).size <= 100 * 1024 * 1024, '单条会话超过 100MB，暂不能收纳');
        return fs.readFileSync(file, 'utf8');
    }
    history(file, agent) { return agent === 'codex' ? readCodexHistory(file, this.historyFiles || codexFiles(this.roots.codex)) : this.read(file); }
    discover() {
        const found = [], errors = [], showScheduled = preferences(this.store).showScheduledSessions;
        const instances = this.store.instances();
        const ignoredFiles=new Set(instances.filter(i=>isTrashed(this.store,i.branchId)).map(i=>i.file));
        this.catalog.clear(); this.observations = new Map(); this.historyFiles = [...new Set([...codexFiles(this.roots.codex), ...instances.filter(i => i.agent === 'codex' && i.file && inside(this.store.root, i.file) && fs.existsSync(i.file)).map(i => i.file)])];
        for (const agent of ['codex', 'claude']) {
            const root = this.roots[agent];
            const titles = new Map(), archivedIds = new Set(), canonicalPaths = new Map(), provenance = new Map(), indexedFiles = new Map();
            if (agent === 'codex' && fs.existsSync(path.join(root, 'state_5.sqlite'))) {
                let db;
                try {
                    db = new DatabaseSync(path.join(root, 'state_5.sqlite'), { readOnly: true });
                    const columns = db.prepare('PRAGMA table_info(threads)').all().map(c => c.name);
                    if (columns.includes('id') && columns.includes('title') && columns.includes('archived')) {
                        const optional = ['rollout_path', 'name', 'source', 'thread_source', 'cwd'].filter(c => columns.includes(c));
                        for (const row of db.prepare('SELECT id,title,archived' + optional.map(c => ',' + c).join('') + ' FROM threads').all()) {
                            if (row.name || row.title) titles.set(row.id, row.name || row.title);
                            provenance.set(row.id, { source: row.source, threadSource: row.thread_source });
                            if (row.archived) archivedIds.add(row.id);
                            if (row.rollout_path && path.isAbsolute(row.rollout_path)) { canonicalPaths.set(row.id, path.resolve(row.rollout_path)); indexedFiles.set(path.resolve(row.rollout_path), row); }
                        }
                    }
                } catch { errors.push({ message: 'Could not read the native Codex index.' }); }
                finally { db?.close(); }
            }
            if (agent === 'codex' && fs.existsSync(path.join(root, 'session_index.jsonl'))) {
                for (const line of this.read(path.join(root, 'session_index.jsonl')).split('\n')) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.id && entry.thread_name && !titles.has(entry.id))
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
                        const indexed = indexedFiles.get(path.resolve(file));
                        const fileId=path.basename(file).match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/)?.[0];
                        if(ignoredFiles.has(file)||nativeSuppressed(this.store,agent,indexed?.id||fileId))continue;
                        const internal = indexed && sessionExclusion({ showScheduled, agent, source: indexed.source, threadSource: indexed.thread_source });
                        if (internal) { this.observations.set(file, { nativeId: indexed.id, excluded: internal }); continue; }
                        const namedId = path.basename(file).match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/)?.[0];
                        if (namedId && canonicalPaths.has(namedId) && canonicalPaths.get(namedId) !== path.resolve(file)) continue;
                        const stat = fs.statSync(file), stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
                        const known = instances.find(i => i.agent === agent && (i.file === file || i.nativeId === indexed?.id));
                        const saved = known?.summaryVersion === 5 && known.observedStamp === stamp && this.store.summary(known.baseRevision,agent);
                        let p = saved ? { nativeId:known.nativeId,cwd:known.cwd,count:saved.chats,firstUser:saved.firstUser,title:agent==='claude'?saved.nativeTitle:known.title,background:saved.background,initialization:saved.background==='background',source:indexed?.source,warnings:[],errors:0 } : this.scanCache.get(file)?.stamp === stamp ? this.scanCache.get(file).summary : null;
                        if (!p) { const full = parse(this.history(file, agent), agent); p = { nativeId: full.nativeId, cwd: full.cwd, title: agent === 'claude' ? claudeTitle(full.records).title : null, initialization: agent === 'claude' && claudeTitle(full.records).initialization, storedSummary: this.store.rememberSummary('scan:' + hash(file) + ':' + stamp, agent, full), firstUser: full.messages.find(m => m.role === 'user')?.text.slice(0, 100), count: full.messages.filter(m => m.role !== 'tool').length, source: full.meta?.source, threadSource:full.meta?.thread_source, sidechain: full.records.find(r => ['user', 'assistant'].includes(r.value?.type))?.value?.isSidechain === true, originKind: full.records.find(r => r.value?.type === 'user' && !r.value.isMeta)?.value?.origin?.kind, sessionKind: full.records.find(r=>r.value?.sessionKind)?.value.sessionKind, warnings: full.warnings, errors: full.errors.length }; this.scanCache.set(file, { stamp, summary: p }); }
                        if (p.errors) { errors.push({ file:path.basename(file), message:'Native record is still being written.' }); continue; }
                        if (!p.nativeId || nativeSuppressed(this.store,agent,p.nativeId))
                            continue;
                        if (canonicalPaths.has(p.nativeId) && canonicalPaths.get(p.nativeId) !== path.resolve(file)) continue;
                        const info = provenance.get(p.nativeId) || {};
                        const excluded = sessionExclusion({ showScheduled, agent, source: info.source, threadSource: info.threadSource }) || sessionExclusion({ showScheduled, agent, source: p.source, threadSource:p.threadSource, sidechain: p.sidechain, originKind: p.originKind, sessionKind: p.sessionKind, initialization:p.initialization, chats: p.count });
                        const nativeTitle = titles.get(p.nativeId) || p.title;
                        const scheduled = [sessionExclusion({agent,source:info.source,threadSource:info.threadSource}),sessionExclusion({agent,source:p.source,threadSource:p.threadSource})].includes('scheduled');
                        const background = p.background || backgroundKind({agent,source: info.source ?? p.source, threadSource: info.threadSource ?? p.threadSource, sidechain:p.sidechain,originKind:p.originKind,sessionKind:p.sessionKind, initialization:p.initialization});
                        const item = { background, scheduled, key: hash(file), agent, nativeId: p.nativeId, cwd: indexed?.cwd || p.cwd || '', cwdAvailable: !(indexed?.cwd || p.cwd) || fs.existsSync(indexed?.cwd || p.cwd), title: nativeTitle || p.firstUser || 'Untitled session', messages: p.count, updatedAt: stat.mtime.toISOString(), managed: instances.some(i => i.file === file || i.agent === agent && i.nativeId === p.nativeId), warnings: p.warnings, excluded, source: info.source ?? p.source, archived: dir === 'archived_sessions' || archivedIds.has(p.nativeId) };
                        this.observations.set(file, item);
                        if (excluded) continue;
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
        const physical = this.read(item.file), raw = this.history(item.file, item.agent);
        return this.store.transaction(() => {
            const sidecarDir = item.agent === 'claude' ? path.join(path.dirname(item.file), item.nativeId) : null;
            const auxiliary = sidecarDir ? auxiliarySnapshot(sidecarDir) : [];
            const requiresAuxiliary = false;
            const displayTitle = String(name || item.title).trim() || 'Untitled session';
            const b = this.store.branch(projectId, displayTitle, item.agent, raw, { cwd: item.cwd, agent: item.agent, nativeId: item.nativeId, client: 'unknown', operation: 'import', requiresAuxiliary, ...(auxiliary.length ? { auxiliary } : {}) });
            b.contentUpdatedAt = item.updatedAt;
            b.archived = !!item.archived; b.scheduled = !!item.scheduled; b.background = item.background || null;
            this.store.put('branch', b);
            const instances = this.store.instances();
            const stat = fs.statSync(item.file), stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
            const cached = this.scanCache.get(item.file);
            if (cached?.stamp === stamp && cached.summary.storedSummary) this.store.summaryCache.set(item.agent + ':' + b.head, cached.summary.storedSummary);
            const summary = this.store.summary(b.head, item.agent);
            instances.push({ summaryVersion: 5, summaryRevision: b.head, summaryJson: JSON.stringify(summary), observedStamp: stamp, ...(sidecarDir ? { auxiliaryStamp: auxiliaryStamp(sidecarDir) } : {}), id: id(), branchId: b.id, agent: b.agent, root: this.roots[b.agent], nativeId: item.nativeId, file: item.file, cwd: item.cwd, cwdAvailable: item.cwdAvailable, desired: observe && !item.archived, applied: !item.archived, baseRevision: b.head, baseline: null, historyResolved: true, observedHash: hash(physical), adopted: true, title: b.name, excluded: false, requiresAuxiliary });
            this.store.local('instances', instances);
            return b;
        });
    }
    refreshLocal() {
        const timings = {}, started = performance.now();
        const found = this.discover();
        timings.discoverMs = Math.round(performance.now() - started);
        // Reconcile previously imported rows without deleting history, rebuilding
        // the user's library, or changing any native availability.
        const instances = this.store.instances();
        let metadataChanged = false;
        for (const instance of instances) {
            const current = [...this.catalog.values()].find(v => v.nativeId === instance.nativeId && v.agent === instance.agent);
            if (current && current.file !== instance.file && instance.applied) { instance.file = current.file; this.observedStats.delete(instance.id); }
            if (current?.cwd && instance.adopted && current.cwd !== instance.cwd) { instance.cwd = current.cwd; metadataChanged = true; }
            const observed = current || this.observations.get(instance.file); if (!observed) continue;
            const branch = this.store.get('branch', instance.branchId), patch = {};
            const background = observed.background || (['scheduled','agent-owned'].includes(observed.excluded) ? observed.excluded : null);
            if ((branch.background || null) !== background) { patch.background = background; metadataChanged = true; }
            if(observed.scheduled!==undefined && !!branch.scheduled!==observed.scheduled)patch.scheduled=observed.scheduled;
            if ((branch.excluded || null) !== observed.excluded) { patch.excluded = observed.excluded; metadataChanged = true; }
            if (observed.cwdAvailable !== undefined && instance.cwdAvailable !== observed.cwdAvailable) instance.cwdAvailable = observed.cwdAvailable;
            if (instance.excluded !== !!observed.excluded) { instance.excluded = !!observed.excluded; metadataChanged = true; }
            if (!observed.excluded && observed.title && !(instance.groveTitle && observed.title === instance.title) && branch.name !== observed.title && (branch.name === instance.title || branch.nativeObservedTitle === branch.name)) {
                patch.name = observed.title; patch.nativeObservedTitle = observed.title;
                instance.title = observed.title;
            }
            if (Object.keys(patch).length) this.store.put('branch', metadata(branch, patch));
        }
        this.store.local('instances', instances);
        const collectStart = performance.now(), collected = this.collect();
        timings.collectMs = Math.round(performance.now() - collectStart);
        const importStart = performance.now();
        let discovered = 0;
        for (const candidate of found.sessions) {
            if (candidate.managed)
                continue;
            try {
                this.import(candidate.key, null, candidate.title, { observe: true });
                discovered++;
            }
            catch (e) {
                collected.errors.push({ message: e.message });
            }
        }
        const backgroundBranches = this.store.all('branch').filter(b => b.background || b.scheduled || ['scheduled','agent-owned'].includes(b.excluded));
        if (backgroundBranches.length) {
            if (!this.store.all('project').some(p => p.id === BACKGROUND_PROJECT)) this.store.put('project', {id:BACKGROUND_PROJECT,name:'Scheduled & background',background:true,createdAt:now(),updatedAt:now(),metaVersion:id(),metaAncestors:[]});
            for (const b of backgroundBranches) if (b.projectId !== BACKGROUND_PROJECT) this.store.put('branch', metadata(b,{projectId:BACKGROUND_PROJECT,background:b.background || b.excluded || 'scheduled'}));
        }
        timings.importMs = Math.round(performance.now() - importStart);
        const familyStart = performance.now();
        const families = discovered || metadataChanged || this.store.local('familyDetectionVersion') !== 3 ? this.store.detectFamilies() : { grouped: 0 };
        this.store.local('familyDetectionVersion', 3);
        timings.familiesMs = Math.round(performance.now() - familyStart);
        return { ...collected, discovered, grouped: families.grouped, timings, errors: [...collected.errors, ...found.errors] };
    }
    setActive(branchId, cwd, desired, options = {}) {
        const b = this.store.get('branch', branchId);
        assert(!b.excluded || ['scheduled','agent-owned'].includes(b.excluded) && preferences(this.store).showScheduledSessions, 'Agent-owned or empty records are not managed as sessions.');
        assert(!desired || !isTrashed(this.store,b.id),'Restore from Trash before activating.');
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
            let instance = [...instances].reverse().find(i => i.branchId === branchId && i.cwd === cwd && i.root === this.roots[b.agent]);
            if (instance && ((instance.contextPolicyHash || policyHash(null)) !== policyHash(b.contextPolicy) || instance.baseRevision !== b.head)) { instance.desired = false; instance = null; }
            if (!instance) {
                instance = { id: id(), branchId, agent: b.agent, root: this.roots[b.agent], nativeId: id(), cwd, desired: true, applied: false, file: null, baseRevision: b.head, baseline: '', adopted: false };
                instances.push(instance);
            }
            instance.desired = true;
            if (options.nodeName) { instance.groveTitle = true; instance.activationNodeName = options.nodeName; }
        }
        this.store.local('instances', instances);
        return this.plan();
    }
    collect() {
        const instances = this.store.instances();
        const results = [], errors = [];
        for (const i of instances) {
            if (isTrashed(this.store,i.branchId) || i.excluded && this.store.get('branch', i.branchId).excluded !== 'empty') continue;
            if (!i.file || !fs.existsSync(i.file)) {
                if (i.applied)
                    i.missing = true;
                continue;
            }
            try {
                if (i.agent === 'claude' && i.applied && inside(this.roots.claude, i.file)) {
                    const directory = path.join(path.dirname(i.file), i.nativeId), stamp = auxiliaryStamp(directory);
                    if (i.auxiliaryStamp !== stamp) {
                        assert(!i.requiresAuxiliary || fs.existsSync(directory), 'Original Claude companion directory is missing.');
                        const auxiliary = auxiliarySnapshot(directory), b = this.store.get('branch', i.branchId);
                        const before = this.store.get('revision', b.head);
                        if (auxiliary.length || i.requiresAuxiliary || before.source.auxiliary?.length) {
                            const rev = this.store.put('revision', { ...before, id: id(), parent: before.id, createdAt: now(), source: { ...before.source, operation: 'native-settings', requiresAuxiliary: false, auxiliary } });
                            this.store.put('branch', { ...b, head: rev.id }); i.baseRevision = rev.id;
                        }
                        i.auxiliaryStamp = stamp; i.requiresAuxiliary = false;
                    }
                }
                const stat = fs.statSync(i.file), stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
                if (!i.missing && i.summaryVersion === 5 && i.summaryRevision === i.baseRevision && (this.observedStats.get(i.id) || i.observedStamp) === stamp) continue;
                const raw = this.read(i.file);
                i.missing = false;
                if (hash(raw) === i.observedHash && (!i.adopted || i.historyResolved)) { this.observedStats.set(i.id, stamp); i.observedStamp=stamp; i.summaryJson=JSON.stringify(this.store.summary(i.baseRevision,i.agent)); i.summaryRevision=i.baseRevision; i.summaryVersion=5; continue; }
                const p = parse(raw, i.agent);
                if (p.errors.length) {
                    i.pending = '等待完整轮次';
                    this.observedStats.set(i.id, stamp);
                    continue;
                }
                const base = this.store.raw(i.baseRevision);
                // Codex can append to the logical prefix. Claude forks remap UUIDs;
                // splicing their suffix onto old UUIDs disconnects the message chain.
                // Keep its complete physical history and retain the old revision.
                const baseline = i.baseline ?? base;
                const resolved = this.history(i.file, i.agent);
                const physicalClaude = i.agent === 'claude';
                const logical = i.adopted || physicalClaude ? resolved : resolved.startsWith(baseline) ? base + resolved.slice(baseline.length) : resolved;
                const beforeBranch = this.store.get('branch',i.branchId);
                let mappedForkEnd;
                const physicalPrefixLength = physicalClaude && baseline !== base && resolved.startsWith(baseline) ? (baseline.match(/[^\n]*\n|[^\n]+$/g)||[]).length : null;
                if (physicalPrefixLength !== null && beforeBranch.parentId && beforeBranch.forkEnd) {
                    const ref=this.store.get('revision',i.baseRevision).refs[beforeBranch.forkEnd-1];
                    const anchor=ref&&JSON.parse(this.store.objectStatement.get(ref).body)?.uuid;
                    const index=anchor?p.records.findLastIndex((r,index)=>index<physicalPrefixLength&&(r.value?.uuid===anchor||r.value?.forkedFrom?.messageUuid===anchor)):-1;
                    if(index>=0)mappedForkEnd=index+1;
                }
                const suffix = physicalClaude ? resolved.startsWith(baseline) ? resolved.slice(baseline.length) : null : base.endsWith('\n') && logical.startsWith(base) ? logical.slice(base.length) : null;
                const conversationChanged = suffix === null || suffix.split('\n').filter(Boolean).some(line => { const v = JSON.parse(line); return i.agent === 'codex' ? ['response_item','compacted'].includes(v.type) || v.type === 'event_msg' && ['task_started','user_message','agent_message'].includes(v.payload?.type) : ['user','assistant'].includes(v.type) || v.subtype === 'compact_boundary'; });
                let b = this.store.ingest(i.branchId, logical, i.baseRevision, { agent: i.agent, nativeId: i.nativeId, cwd: i.cwd, client: 'unknown', operation: conversationChanged ? 'capture' : 'native-settings' });
                if(physicalPrefixLength!==null&&b.id!==beforeBranch.id)b=this.store.put('branch',{...b,forkEnd:physicalPrefixLength,forkParentEnd:this.store.get('revision',i.baseRevision).refs.length});
                else if(mappedForkEnd!==undefined)b=this.store.put('branch',{...b,forkEnd:mappedForkEnd});
                i.branchId = b.id;
                i.baseRevision = b.head;
                if(logical===raw)this.store.rememberSummary(b.head,i.agent,p);
                const summary=this.store.summary(b.head,i.agent);
                if(b.excluded==='empty' && !summary.excluded){this.store.put('branch',metadata(b,{excluded:null}));i.excluded=false;}
                i.summaryJson=JSON.stringify(summary);i.summaryRevision=b.head;i.summaryVersion=5;i.observedStamp=stamp;
                i.baseline = i.adopted || raw === logical ? null : raw;
                i.observedHash = hash(raw);
                i.historyResolved = true; i.pending = p.complete ? null : '等待完整轮次'; this.observedStats.set(i.id, stamp);
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
    title(branch, instance) { return instance.groveTitle ? groveTitle(branch.name, instance.activationNodeName) : branch.name; }
    plan() {
        const operations = this.store.instances().flatMap(i => {
            if (i.excluded || isTrashed(this.store,i.branchId)) return [];
            const b = this.store.get('branch', i.branchId);
            if (i.desired && (!i.applied || i.baseRevision !== b.head || i.missing || i.title !== this.title(b, i) || (i.contextPolicyHash || policyHash(null)) !== policyHash(b.contextPolicy)))
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
    apply(branchIds = null) {
        const targeted = this.plan().operations.filter(op => !branchIds || branchIds.includes(op.branchId));
        if (!targeted.length) return { applied: 0 };
        this.guard([...new Set(targeted.map(op => op.agent))]);
        assert(!this.plan().pendingRecovery.length, '存在未完成操作，请先恢复备份', 409);
        this.collect();
        const instances = this.store.instances(), plan = this.plan();
        if (branchIds) plan.operations = plan.operations.filter(op => branchIds.includes(op.branchId));
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
                    const lineage = this.store.detail(b.id).lineage;
                    const nativeClaudeFork = b.agent === 'claude' && lineage[0]?.source.operation === 'fork';
                    assert(nativeClaudeFork || !lineage.some(r => r.source.requiresAuxiliary) || lineage.some(r => r.source.auxiliary), '此分支继承了含伴随目录的会话，当前版本尚不支持完整物化');
                    assert(!parsed.warnings.some(w => w.includes('外部附件')), '此会话包含外部附件引用。当前版本可浏览和分支，完整附件迁移尚未支持。');
                    const original = i.adopted && i.baseRevision === b.head && (i.contextPolicyHash || policyHash(null)) === policyHash(b.contextPolicy) && parsed.cwd === i.cwd;
                    const forkSource = nativeClaudeFork && lineage[0].parent && lineage[0].source.claudeCheckpoint ? { raw: this.store.availableRaw(lineage[0].parent), upToMessageId: lineage[0].source.claudeCheckpoint } : null;
                    let output = original && i.file && fs.existsSync(i.file) ? this.read(i.file) : renderNative(raw, b.agent, i.nativeId, i.cwd, this.title(b, i), b.contextPolicy, forkSource);
                    if (original && i.groveTitle && b.agent === 'claude' && claudeTitle(parsed.records).title !== this.title(b, i)) output = output.replace(/\n?$/, '\n') + JSON.stringify({type:'custom-title',customTitle:this.title(b, i),sessionId:i.nativeId}) + '\n';
                    const dest = safePath(root, op.file);
                    assert(!fs.existsSync(dest) || dest === i.file, '目标记录已存在，拒绝覆盖');
                    backup(dest);
                    writes.set(dest, output);
                    if (b.agent === 'claude' && !nativeClaudeFork) {
                        const auxiliary = lineage.find(r => r.source.auxiliary)?.source.auxiliary || [];
                        for (const [file, content] of auxiliaryWrites(root, path.join(path.dirname(dest), i.nativeId), auxiliary)) {
                            if (fs.existsSync(file)) { assert(hash(fs.readFileSync(file)) === hash(content), 'Existing companion file differs; refusing to overwrite it.'); continue; }
                            backup(file); writes.set(file, content);
                        }
                    }
                    if (i.file && i.file !== dest) {
                        backup(i.file);
                        writes.set(i.file, null);
                    }
                    i.file = dest;
                    i.applied = true;
                    i.baseRevision = b.head;
                    i.baseline = i.adopted ? null : output;
                    i.observedHash = hash(output);
                    i.missing = false;
                    i.title = this.title(b, i); i.contextPolicyHash = policyHash(b.contextPolicy);
                    if (i.agent === 'codex')
                        this.updateCodexDb(dbs.get(root), i, b, parsed);
                }
                else {
                    if (i.file && fs.existsSync(i.file)) {
                        safePath(root, i.file);
                        backup(i.file);
                        const paginated = i.agent === 'codex' && this.store.parsed(b.head, b.agent).meta?.history_mode === 'paginated';
                        // Other active native forks may still reference this byte prefix.
                        const parked = paginated ? safePath(root, path.join(root, 'archived_sessions', path.basename(i.file))) : path.join(this.store.root, 'parked', i.id, path.basename(i.file));
                        assert(!fs.existsSync(parked) || parked === i.file, 'Archive target already exists.');
                        backup(parked);
                        writes.set(parked, this.read(i.file));
                        if (i.file !== parked) writes.set(i.file, null);
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
                const changedIds = new Set(plan.operations.map(op => op.instanceId));
                const managed = new Set(after.filter(i => i.agent === agent && changedIds.has(i.id)).map(i => i.nativeId));
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
                for (const i of after.filter(i => i.agent === agent && i.applied && changedIds.has(i.id))) {
                    const b = this.store.get('branch', i.branchId);
                    kept.push(JSON.stringify(agent === 'codex' ? { id: i.nativeId, thread_name: this.title(b, i), updated_at: now() } : { display: this.title(b, i), pastedContents: {}, timestamp: Date.now(), project: i.cwd, sessionId: i.nativeId }));
                }
                backup(file);
                writes.set(file, kept.length ? kept.join('\n') + '\n' : '');
                if (agent === 'claude') {
                    const dirs = new Set([...instances, ...after].filter(i => i.agent === 'claude' && changedIds.has(i.id) && i.file && inside(path.join(root, 'projects'), i.file)).map(i => path.dirname(i.file)));
                    for (const dir of dirs) {
                        const indexFile = safePath(root, path.join(dir, 'sessions-index.json'));
                        if (!fs.existsSync(indexFile))
                            continue;
                        const index = json(indexFile);
                        assert(index.version === 1 && Array.isArray(index.entries), '不支持的 Claude sessions-index 格式');
                        const entries = index.entries.filter(e => !managed.has(e.sessionId));
                        for (const i of after.filter(i => i.agent === 'claude' && i.applied && changedIds.has(i.id) && path.dirname(i.file) === dir)) {
                            const b = this.store.get('branch', i.branchId), p = parse(writes.get(i.file) ?? i.baseline ?? this.read(i.file), 'claude');
                            const previous = index.entries.find(e => e.sessionId === i.nativeId) || {};
                            entries.push({ ...previous, sessionId: i.nativeId, fullPath: i.file, fileMtime: Date.now(), firstPrompt: p.messages.find(m => m.role === 'user')?.text || b.name, summary: this.title(b, i), messageCount: p.messages.length, created: previous.created || b.createdAt, modified: now(), projectPath: i.cwd, isSidechain: false });
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
            // Completed journals are not recoverable operations; do not retain
            // duplicate transcript/database snapshots indefinitely.
            try{const {instancesBefore,...metadata}=job;atomic(jobFile,JSON.stringify({...metadata,files:job.files.map(({path,afterHash})=>({path,afterHash})),backupsPruned:true}));}catch{}
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
        const values = { id: i.nativeId, rollout_path: i.file, created_at: seconds, updated_at: seconds, source: 'cli', model_provider: p.meta?.model_provider || 'openai', cwd: i.cwd, title: this.title(b, i), sandbox_policy: JSON.stringify({ type: 'read-only' }), approval_mode: 'on-request', has_user_event: p.hasUser ? 1 : 0, archived: 0, archived_at: null, cli_version: p.meta?.cli_version || '', first_user_message: p.messages.find(m => m.role === 'user')?.text || '', name: this.title(b, i), preview: p.messages.find(m => m.role === 'user')?.text.slice(0, 200) || '', created_at_ms: ms, updated_at_ms: ms, recency_at: seconds, recency_at_ms: ms, history_mode: p.meta?.history_mode || 'legacy', originator: 'session_grove' };
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
