import {bodyRefs} from './retention.js';
import fs from 'node:fs';import path from 'node:path';
import {collectTrash,resumeTrashCleanup} from './cloud-trash.js';
import {cleanupLocal} from './trash.js';
import { cloudProjectId } from './inbox.js';
import { preferences } from './preferences.js';
import { Cloud } from './cloud.js';
import { GitCloud } from './git-cloud.js';
import { assert, now, id } from './util.js';
export class AutoSync {
    constructor(store, readConfig, run = null, { provider = 'webdav' } = {}) {
        this.store = store; this.readConfig = readConfig; this.run = run;
        this.cloud = provider === 'git' ? new GitCloud(store, readConfig) : new Cloud(store, readConfig); this.cloud.onProgress=value=>this.progress(value);
        this.cloud.mergeByModified = true;
        this.passphrase = this.cloud.provider === 'git' ? '' : null; this.running = false; this.error = null; this.closed = false; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0;
        this.lastManualOperation = store.local('lastManualSync');
        this.lastFailure = store.local('lastSyncFailure');
        if (this.lastFailure?.requiresReview && /^(Sync stopped by request|Transfer stopped to load)/.test(this.lastFailure.error || '')) this.lastFailure = { ...this.lastFailure, state: 'interrupted' };
        if (this.lastFailure?.requiresReview) this.needsReview = { retry: true, cleanup: true };
        if (this.lastManualOperation?.state === 'running') this.lastManualOperation = { ...this.lastManualOperation, state: 'error', error: 'Previous sync was interrupted. Verified progress is retained.', finishedAt: Date.now() };
        if (this.lastManualOperation?.state === 'error') this.needsReview ||= { retry: true };
        this.queue = new Set(store.local('uploadQueue') || []);
        this.configureTimer();
    }
    trashPending() { if (this.cloud.provider === 'git') return !!(this.store.local('trashPending') || []).length; return !!(this.store.local('trashPending')||[]).length || fs.existsSync(path.join(this.store.root,'trash-cleanup.json')); }
    async syncTrash(options = {}) {
        if (this.cloud.provider === 'git') return null;
        try {
            if(fs.existsSync(path.join(this.store.root,'trash-cleanup.json')))await resumeTrashCleanup(this.cloud,this.passphrase);
            const result = (this.store.local('trashPending')||[]).length ? await collectTrash(this.cloud,this.passphrase, options) : null;
            if (this.lastFailure?.requiresReview) { this.lastFailure = { ...this.lastFailure, requiresReview: false }; this.store.local('lastSyncFailure', this.lastFailure); if (this.needsReview?.cleanup) this.needsReview = null; }
            return result;
        } catch (e) { e.requiresReview = true; throw e; }
    }
    configureTimer() {
        clearTimeout(this.interval); this.interval = null; this.nextFallbackAt = null;
        this.reconcileTimer();
    }
    reconcileTimer(dirty = this.cloud.dirtyIds().length > 0) {
        const p = preferences(this.store);
        const enabled = (dirty||this.trashPending()) && !this.running && !this.closed && !this.needsReview && p.autoUploadEnabled && this.store.local('syncStarted') !== false && this.passphrase !== null && !!this.readConfig()?.url;
        if (!enabled) { clearTimeout(this.interval); this.interval=null; this.nextFallbackAt=null; return; }
        if (this.interval) return;
        this.nextFallbackAt = Date.now() + p.autoUploadMinutes * 60000;
        this.interval=setTimeout(()=>{this.interval=null;this.nextFallbackAt=null;this.fallback().catch(()=>{}).finally(()=>this.reconcileTimer());},p.autoUploadMinutes*60000);
        this.interval.unref();
    }
    progress(value) {
        if (!this.running) return;
        this.operation = {...this.operation, progress:value};
        if (this.pullGroup) {
            const group = this.pullGroup;
            if (value.phase === 'Pulling sessions') { group.completed = value.completed; group.fraction = 0; }
            else if (value.total > 0) group.fraction = Math.max(group.fraction, Math.min(1, value.completed / value.total));
            this.operation.stageProgress = { completed: Math.min(group.total, group.completed + group.fraction), total: group.total };
        } else if (this.cloud.provider === 'git') {
            this.operation.stageProgress = value.total > 0 ? { completed: value.completed, total: value.total } : null;
        } else if (this.operation.step === 'push' && value.phase === 'Uploading records' && value.total > 0) {
            this.operation.stageProgress = { completed: value.completed, total: value.total };
        }
        const at=Date.now();
        if(this.progressPhase!==value.phase || value.completed===value.total || at-(this.progressAt||0)>=200) { this.progressAt=at;this.progressPhase=value.phase;this.onOperation?.(this.operation); }
    }
    async fallback() {
        if (this.migrating || this.store.local('syncStarted') === false || !preferences(this.store).autoUploadEnabled || this.running || this.closed || !this.readConfig()?.url || this.passphrase === null || this.retryAt > Date.now()) return;
        if (this.needsReview) return;
        await this.beforeUpload?.();
        if (!this.cloud.dirtyIds().length && !this.trashPending()) return;
        this.startTransfer('push', false, true);
        return this.syncJob;
    }
    pendingItems() {
        if (this.cloud.provider === 'git') return this.cloud.pendingItems();
        const dirty = new Set(this.cloud.dirtyIds()), removals = new Set((this.store.local('trashPending') || []).map(e => e.id));
        return [...this.store.syncCollections().items.filter(i => dirty.has(i.id)).map(i => ({ id: i.id, name: i.name, updatedAt: i.updatedAt, action: 'upload' })),
            ...(this.store.local('trashEntries') || []).filter(e => removals.has(e.id)).map(e => ({ id: e.id, name: e.names.join(', '), updatedAt: e.at, action: 'remove' }))];
    }
    async pullCached({ deferProgress = false } = {}) {
        this.operation = { ...this.operation, step: 'pull' }; this.progress({ phase: 'Checking cloud directory', completed: 0, total: null });
        if (this.run) return this.run(this.store, this.readConfig(), this.passphrase, 'pull');
        if (!await this.cloud.connect(this.passphrase, { readOnly: true })) { this.cloud.report('Cloud vault is empty', 0, 0); return { downloaded: 0 }; }
        const catalog = await this.cloud.catalog(this.passphrase);
        const projects = this.cloud.summaries(), started = Date.now(); let completed = 0;
        this.cloud.report('Updating project lists', 0, projects.length, started);
        for (const p of projects) { await this.cloud.project(p.id, this.passphrase); this.cloud.report('Updating project lists', ++completed, projects.length, started, p.name); }
        const local = new Set(this.store.all('branch').map(b => b.id));
        const items = this.cloud.items().filter(i => this.cloud.provider === 'git' || local.has(i.id));
        const importsPending = items.some(i => i.versions?.some(v => !(this.cloud.cache().loaded[i.id] || []).includes(v.ref)));
        if (!deferProgress || this.cloud.provider === 'git') this.pullGroup = { completed: 0, fraction: 0, total: items.length };
        try {
            this.cloud.report('Pulling sessions', 0, items.length, started);
            for (const [index, item] of items.entries()) { this.cloud.report('Updating downloaded sessions', 0, null, started, item.name); await this.cloud.hydrate(item.id, this.passphrase, { latest: true }); this.cloud.report('Pulling sessions', index + 1, items.length, started, item.name); }
        } finally { this.pullGroup = null; }
        this.cloud.saveDirectory(); this.store.local('lastPull', now());
        if (!deferProgress) this.cloud.report('Pull complete', items.length, items.length, started);
        return { downloaded: items.length, unchanged: catalog?.remoteChanged === false && !importsPending };
    }
    startTransfer(direction, manual = true, captured = false) {
        assert(['pull', 'push'].includes(direction), 'Choose Pull or Push.');
        assert(!this.running && !this.pending && !this.migrating, 'A cloud transfer is already running.', 409);
        assert(this.passphrase !== null && this.readConfig()?.url, 'Configure sync in Settings first.');
        assert(this.rateLimitUntil <= Date.now(), 'Provider requested a pause before retrying.', 429);
        this.store.local('syncStarted', true);
        this.syncJob = this.exclusive(async () => {
            this.operation = { ...this.operation, step: 'pull' };
            this.progress({ phase: 'Reading local changes', completed: 0, total: null });
            if (!captured) await this.beforeUpload?.();
            const pulled = await this.pullCached({ deferProgress: direction === 'push' });
            this.operation = { ...this.operation, summary: { checked: pulled?.downloaded || 0, unchanged: !!pulled?.unchanged } };
            if (direction === 'pull') { if (!this.lastFailure?.requiresReview) this.needsReview = null; return pulled; }
            assert(!(this.store.local('conflicts') || []).length, 'Resolve sync conflicts before uploading.');
            const beginPush = () => {
                if (this.operation.step === 'push') return;
                this.operation = { ...this.operation, step: 'push', pullComplete: true, stageProgress: null };
                this.progress({ phase: 'Preparing changes to push', completed: 0, total: null });
            };
            const cleanup = await this.syncTrash({ onPrepared: beginPush, onProgress: progress => { this.operation.stageProgress = progress; } });
            beginPush();
            const ids = this.cloud.dirtyIds();
            // Cleanup has already published a frozen snapshot of all surviving data.
            // New local changes stay queued instead of triggering a second upload pass.
            const result = cleanup?.rebuilt ? cleanup : this.run ? await this.run(this.store, this.readConfig(), this.passphrase, 'push', ids) : (ids.length || this.trashPending() || this.cloud.archiveCleanupNeeded?.()) ? await this.cloud.publish(ids, this.passphrase, { catalogFresh: true }) : { uploaded: 0, published: 0 };
            if (cleanup?.rebuilt) { const cache = this.cloud.cache(); cache.lastUpload = now(); this.cloud.save(cache); }
            this.queue = new Set(this.cloud.dirtyIds()); this.store.local('uploadQueue', [...this.queue]);
            this.store.local('lastSync', { at: now(), ...result }); this.needsReview = null;
            this.operation = { ...this.operation, summary: { checked: pulled?.downloaded || 0, published: result.published || 0, uploaded: result.uploaded || 0 } };
            return { ...pulled, ...result };
        }, false, direction, manual);
        this.syncJob.catch(() => {});
        return { operationId: this.operation.id };
    }
    async prepareSync() {
        assert(this.passphrase !== null && this.readConfig()?.url, 'Configure sync in Settings first.');
        return this.exclusive(async () => {
            await this.beforeUpload?.();
            await this.syncTrash();
            const plan = await this.cloud.transferPlan(this.passphrase);
            this.syncPlan = { ...plan, id: id(), createdAt: Date.now() };
            return this.syncPlan;
        }, false, 'pull', true);
    }
    startSync(planId, confirmed = false) {
        const plan = this.syncPlan;
        assert(plan && plan.id === planId && Date.now() - plan.createdAt < 5 * 60 * 1000, 'Sync plan expired. Preview again.', 409);
        assert(!plan.large || confirmed, 'Confirm this large transfer before continuing.', 409);
        assert(!this.running, 'Sync is already running.', 409);
        this.syncPlan = null; this.needsReview = null; this.store.local('syncStarted', true);
        this.syncJob = this.exclusive(async () => {
            for (const id of plan.downloadIds) await this.cloud.hydrate(id, this.passphrase);
            assert(!(this.store.local('conflicts') || []).length, 'Resolve sync conflicts before uploading.');
            await this.beforeUpload?.();
            const dirty = this.cloud.dirtyIds();
            const result = (dirty.length || this.trashPending()) ? await this.cloud.publish(dirty, this.passphrase, { catalogFresh: true }) : { uploaded: 0, published: 0 };
            cleanupLocal(this.store);
            this.queue = new Set(this.cloud.dirtyIds()); this.store.local('uploadQueue', [...this.queue]); this.store.local('lastSync', { at: now(), ...result });
            return result;
        }, false, 'both', true);
        this.syncJob.catch(() => {});
        return { operationId: this.operation.id };
    }
    status() {
        const configured = !!this.readConfig()?.url, dirty = this.cloud.dirtyIds();
        this.reconcileTimer(dirty.length>0);
        this.cloud.useSavedCache(); const cache = this.cloud.cache();
        let operation = this.running ? this.operation : this.lastManualOperation?.state === 'error' ? this.lastManualOperation : this.operation || this.lastManualOperation;
        if (!this.running && this.needsReview && this.lastFailure && (!operation || this.lastFailure.finishedAt >= (operation.finishedAt || 0))) operation = this.lastFailure;
        const metrics = this.cloud.connection?.dav.metrics || this.cloud.metrics;
        if (this.cloud.provider !== 'git' && operation && metrics && operation.id === this.metricsOperation) operation = { ...operation, network: { sampledAt: Date.now(), ...Object.fromEntries(['requests','bytesSent','bytesReceived','requestMs','responseBodyMs'].map(key => [key, Math.max(0, (metrics[key] || 0) - (this.metricsStart?.[key] || 0))])) } };
        const error = this.needsReview && this.lastFailure?.requiresReview ? this.lastFailure.error : this.lastManualOperation?.state === 'error' ? this.lastManualOperation.error : this.error;
        return { provider: this.cloud.provider || 'webdav', lastFailure: this.lastFailure || null, manualOperation: this.running && this.operation?.manual ? this.operation : this.lastManualOperation || null, needsReview: this.needsReview || null, started: this.store.local('syncStarted') !== false, operation: operation || null, configured, unlocked: this.passphrase !== null, queued: this.queue.size > 0, dirty: dirty.length > 0 || this.trashPending(), dirtyCount: dirty.length + Number(this.trashPending()),
            phase: this.migrating ? 'migrating' : this.running ? 'syncing' : !configured ? 'unconfigured' : this.passphrase === null ? 'locked' : this.error ? this.store.local('syncStarted') === false ? 'failed' : 'retrying' : this.queue.size ? 'queued' : dirty.length || this.trashPending() ? 'local' : 'synced',
            nextRunAt: !preferences(this.store).autoUploadEnabled || this.running || this.needsReview || !dirty.length && !this.trashPending() || this.store.local('syncStarted') === false || this.passphrase === null || !configured ? null : this.retryAt > Date.now() ? this.retryAt : this.queue.size && this.queuedAt ? this.queuedAt : this.nextFallbackAt, error, retryAt: this.retryAt || null, fallbackMinutes: preferences(this.store).autoUploadEnabled ? preferences(this.store).autoUploadMinutes : null, lastUpload: cache.lastUpload || null, lastCheck: cache.checkedAt || null, lastSuccess: cache.lastUpload || null };
    }
    unlock(passphrase) { assert(typeof passphrase === 'string' && (passphrase.length === 0 || passphrase.length >= 12), 'Encryption passphrase needs at least 12 characters.'); this.passphrase = passphrase; this.error = null; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0; if (this.queue.size) this.schedule([...this.queue]); this.reconcileTimer(); }
    lock() { this.queuedAt = null; this.passphrase = null; this.cloud.lock(); clearTimeout(this.timer); clearTimeout(this.retryTimer); clearTimeout(this.interval);this.interval=null;this.nextFallbackAt=null; }
    schedule(ids = this.cloud.dirtyIds()) {
        if (this.closed) return;
        const dirty = new Set(this.cloud.dirtyIds());
        this.queue = new Set([...this.queue, ...ids].filter(id => dirty.has(id)));
        this.store.local('uploadQueue', [...this.queue]);
        // One countdown starts at the first detected local change. Repeated
        // scans neither reset it nor create a second two-second upload timer.
        this.reconcileTimer(dirty.size > 0);
    }
    async exclusive(fn, allowMigration = false, direction = 'pull', manual = false) {
        if (this.closed) throw new Error('Server is stopping.');
        if (this.pending) await this.pending.catch(() => {});
        // Multiple GETs may wait together; recheck after yielding.
        if (this.pending) return this.exclusive(fn, allowMigration, direction, manual);
        if (this.migrating && !allowMigration) throw new Error('Settings migration in progress.');
        this.running = true; this.operation = { id: id(), direction, manual, state: 'running', startedAt: Date.now() }; if(manual){this.lastManualOperation=this.operation;this.store.local('lastManualSync',this.operation);} this.onOperation?.(this.operation); const started = Date.now(); this.diagnostics?.record('cloud-operation', { phase: 'started' });
        this.metricsOperation = this.operation.id; this.metricsStart = { ...(this.cloud.connection?.dav.metrics || this.cloud.metrics) };
        this.store.transferReaders = (this.store.transferReaders || 0) + 1;
        this.pending = Promise.resolve().then(fn);
        try { const result = await this.pending; this.operation = { ...this.operation, state: 'success', finishedAt: Date.now() }; this.error = null; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0; this.diagnostics?.record('cloud-operation', { phase: 'complete', durationMs: Date.now() - started }); return result; }
        catch (e) { this.operation = { ...this.operation, state: 'error', error: e.message, finishedAt: Date.now() }; this.error = e.message; this.failures++; if (e.code === 'WEBDAV_BACKOFF') this.rateLimitUntil = Date.now() + e.retryAfterMs; this.retryAt = Date.now() + Math.max(e.retryAfterMs || 0, Math.min(30 * 60 * 1000, 60000 * 2 ** Math.min(5, this.failures - 1)));
            this.lastFailure = { ...this.operation, network: this.status().operation?.network, requiresReview: !!e.requiresReview }; this.store.local('lastSyncFailure', this.lastFailure);
            clearTimeout(this.retryTimer); if(manual || e.requiresReview)this.needsReview={retry:true,cleanup:!!e.requiresReview};else if (preferences(this.store).autoUploadEnabled && direction !== 'pull') {this.retryTimer = setTimeout(() => this.fallback().catch(() => {}), Math.min(2147483647, Math.max(1, this.retryAt - Date.now()))); this.retryTimer.unref();} this.diagnostics?.record('cloud-operation', { phase: 'failed', code: 'cloud_failed', durationMs: Date.now() - started }); throw e; }
        finally { if(manual){this.lastManualOperation=this.operation;this.store.local('lastManualSync',this.operation);} this.pending = null; this.running = false; this.store.transferReaders--; if (!this.store.transferReaders && this.store.cleanupDeferred) { this.store.cleanupDeferred = false; cleanupLocal(this.store); } this.reconcileTimer(); this.onOperation?.(this.operation); }
    }
    async flush(direction = 'queued', explicit = false, captured = false) {
        if (this.cloud.provider === 'git') {
            if (!explicit && (!preferences(this.store).autoUploadEnabled || this.needsReview || !this.cloud.dirtyIds().length && !this.trashPending())) return null;
            this.startTransfer(direction === 'pull' ? 'pull' : 'push', explicit, captured);
            return this.syncJob;
        }
        if (!explicit && this.store.local('syncStarted') === false) return null;
        if (direction === 'queued' && !this.queue.size && !this.trashPending()) return { published: 0, uploaded: 0 };
        if (explicit && this.rateLimitUntil > Date.now()) throw new Error('Provider requested a pause. Try again after ' + new Date(this.rateLimitUntil).toLocaleTimeString());
        if (this.closed || !explicit && (this.migrating || this.needsReview || !preferences(this.store).autoUploadEnabled || this.retryAt > Date.now())) return null;
        if (!explicit && direction !== 'pull' && !this.cloud.dirtyIds().length && !this.trashPending()) return { published: 0, uploaded: 0 };
        if (!this.readConfig()?.url || this.passphrase === null) {
            if (explicit) throw new Error('Configure sync in Settings first.');
            return null;
        }
        if (!explicit && !this.run && direction !== 'pull' && !this.trashPending()) {
            const known = new Set([...(this.cloud.cache().uploadedObjects || []), ...(this.cloud.cache().packs || []).flatMap(p=>p.refs)]);
            const refs = new Set(bodyRefs(this.store.exportGraph()));
            const pending = [...refs].filter(h=>!known.has(h));
            const bytes = this.store.db.prepare('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM objects WHERE hash IN (SELECT value FROM json_each(?))').get(JSON.stringify(pending)).bytes;
            if (pending.length > 2000 || bytes > 32 * 1024 * 1024) { this.needsReview = { records: pending.length, bytes }; this.reconcileTimer(); return { reviewRequired: true }; }
        }
        const result = await this.exclusive(async () => {
            if(direction!=='pull')await this.syncTrash();
            if (direction !== 'pull' && !captured) await this.beforeUpload?.();
            if (direction === 'pull') {
                const before=JSON.stringify(this.cloud.summaries());
                const result=this.run ? await this.run(this.store,this.readConfig(),this.passphrase,'pull') : await this.cloud.catalog(this.passphrase);
                return {...result,remoteChanged:before!==JSON.stringify(this.cloud.summaries())};
            }
            assert(['push', 'both', 'queued'].includes(direction), 'Unknown sync direction.');
            if (direction !== 'both' && !this.cloud.dirtyIds().length) return { published: 0, uploaded: 0 };
            if (!this.run) { await this.cloud.connect(this.passphrase); if (!explicit) this.cloud.saveDirectory({ onlyIfMissing: true }); }
            const catalogVersion = () => JSON.stringify(Object.entries(this.cloud.cache().heads).sort(([a],[b])=>a.localeCompare(b)).map(([name,{etag,...head}])=>[name,head]));
            const beforeCatalog = catalogVersion();
            if (direction === 'both' && !this.run) await this.cloud.catalog(this.passphrase);
            const remoteChanged = beforeCatalog !== catalogVersion();
            const dirty = this.cloud.dirtyIds();
            this.queue = new Set([...this.queue].filter(id => dirty.includes(id)));
            this.store.local('uploadQueue', [...this.queue]);
            const ids = direction === 'queued' ? dirty.filter(id => this.queue.has(id)) : dirty;
            if (!ids.length) return { published: 0, uploaded: 0, remoteChanged };
            const result = this.run ? await this.run(this.store, this.readConfig(), this.passphrase, direction, ids) : await this.cloud.publish(ids, this.passphrase, { catalogFresh: direction === 'both' });
            const remaining = new Set(this.cloud.dirtyIds());
            for (const id of ids) if (!remaining.has(id)) this.queue.delete(id);
            this.store.local('uploadQueue', [...this.queue]);
            this.store.local('lastSync', { at: now(), ...result });
            return result;
        }, explicit, direction);
        if (explicit) { this.store.local('syncStarted', true); this.reconcileTimer(); }
        return result;
    }
    async checkCatalog(maxAge = 2 * 60 * 1000) {
        // Background catalog checks must not queue behind a long transfer and
        // block opening already-local projects or trees.
        if (this.closed || this.running || this.cloud.provider === 'git') return;
        if (this.store.local('syncStarted') === false || this.migrating || this.passphrase === null || !this.readConfig()?.url || this.retryAt > Date.now()) return;
        const checked = this.cloud.cache().checkedAt;
        if (checked && Date.now() - new Date(checked).getTime() < maxAge) return;
        return this.exclusive(async () => {
            const last = this.cloud.cache().checkedAt;
            if (!last || Date.now() - new Date(last).getTime() >= maxAge) await this.cloud.catalog(this.passphrase);
        }).catch(() => {});
    }
    async openProject(projectId, query = '') {
        if (this.store.local('syncStarted') === false || this.passphrase === null || !this.readConfig()?.url) {
            const refs = this.cloud.projectRefs().filter(p => p.id === projectId);
            assert(!refs.length || refs.some(p => this.cloud.cache().indexes[p.index]), 'Unlock sync to download this project.');
            return;
        }
        const refs = this.cloud.projectRefs().filter(p => p.id === projectId);
        const missing = refs.some(p => !this.cloud.cache().indexes[p.index]);
        if (!missing && !query.trim()) return;
        if (this.retryAt > Date.now()) { assert(!missing, 'Cloud index unavailable offline.'); return; }
        return this.exclusive(async () => {
            const items = await this.cloud.project(projectId, this.passphrase);
            // A full-text search is an explicit request for these transcripts.
            if (query.trim()) for (const item of items) await this.cloud.hydrate(item.id, this.passphrase);
        }).catch(e => {
            if (query || !this.cloud.items().some(i => i.projectId === projectId) && !this.store.all('project').some(p => p.id === projectId)) throw e;
            // A cached project remains available offline; status retains the network error.
        });
    }
    async openTree(treeId) {
        const local = this.store.all('branch').find(b => b.id === treeId);
        // Local materialization is durable. Remote updates are applied by Sync.
        if (local) return;
        if (this.store.local('syncStarted') === false || this.passphrase === null || !this.readConfig()?.url) {
            assert(this.store.all('branch').some(b => b.id === treeId), this.passphrase !== null && this.readConfig()?.url && this.store.local('syncStarted') === false ? 'Click Sync once to enable cloud reads.' : 'Unlock sync to download this session.'); return;
        }
        const projectId = this.cloud.items().find(i => i.id === treeId)?.projectId;
        if (projectId) await this.openProject(projectId);
        const item = this.cloud.items().find(i => i.id === treeId);
        if (!item || item.versions.every(v => (this.cloud.cache().loaded[treeId] || []).includes(v.ref))) return;
        if (this.retryAt > Date.now() && local) return;
        return this.exclusive(async () => {
            const b = this.store.all('branch').find(b => b.id === treeId);
            const projectId = b ? cloudProjectId(b.projectId) : this.cloud.items().find(i => i.id === treeId)?.projectId;
            if (projectId) await this.cloud.project(projectId, this.passphrase);
            return this.cloud.hydrate(treeId, this.passphrase);
        }).catch(e => { if (!this.store.all('branch').some(b => b.id === treeId)) throw e; });
    }
    decorate(data) { return this.cloud.decorate(data); }
    listing(scope, query = '') { return this.cloud.listing(scope, query); }
    close() { this.closed = true; this.lock(); clearInterval(this.interval); }
}
