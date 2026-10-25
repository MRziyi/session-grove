import {cleanupLocal} from './trash.js';
import { cloudProjectId } from './inbox.js';
import { preferences } from './preferences.js';
import { GitCloud } from './git-cloud.js';
import { assert, now, id } from './util.js';
export class AutoSync {
    constructor(store, readConfig, run = null) {
        this.store = store; this.readConfig = readConfig; this.run = run;
        this.cloud = new GitCloud(store, readConfig); this.cloud.onProgress=value=>this.progress(value);
        this.cloud.mergeByModified = true;
        this.unlocked = true; this.running = false; this.error = null; this.closed = false; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0;
        this.lastManualOperation = store.local('lastManualSync');
        this.lastFailure = store.local('lastSyncFailure');
        if (this.lastFailure?.requiresReview && /^(Sync stopped by request|Transfer stopped to load)/.test(this.lastFailure.error || '')) this.lastFailure = { ...this.lastFailure, state: 'interrupted' };
        if (this.lastFailure?.requiresReview) this.needsReview = { retry: true, cleanup: true };
        if (this.lastManualOperation?.state === 'running') this.lastManualOperation = { ...this.lastManualOperation, state: 'error', error: 'Previous sync was interrupted. Verified progress is retained.', finishedAt: Date.now() };
        if (this.lastManualOperation?.state === 'error') this.needsReview ||= { retry: true };
        this.queue = new Set(store.local('uploadQueue') || []);
        this.configureTimer();
    }
    trashPending() { return !!(this.store.local('trashPending') || []).length; }
    configureTimer() {
        clearTimeout(this.interval); this.interval = null; this.nextFallbackAt = null;
        this.reconcileTimer();
    }
    reconcileTimer(dirty = this.cloud.dirtyIds().length > 0) {
        const p = preferences(this.store);
        const enabled = (dirty||this.trashPending()) && !this.running && !this.closed && !this.needsReview && p.autoUploadEnabled && this.store.local('syncStarted') !== false && this.unlocked && !!this.readConfig()?.url;
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
        } else {
            this.operation.stageProgress = value.total > 0 ? { completed: value.completed, total: value.total } : null;
        }
        const at=Date.now();
        if(this.progressPhase!==value.phase || value.completed===value.total || at-(this.progressAt||0)>=200) { this.progressAt=at;this.progressPhase=value.phase;this.onOperation?.(this.operation); }
    }
    async fallback() {
        if (this.migrating || this.store.local('syncStarted') === false || !preferences(this.store).autoUploadEnabled || this.running || this.closed || !this.readConfig()?.url || !this.unlocked || this.retryAt > Date.now()) return;
        if (this.needsReview) return;
        await this.beforeUpload?.();
        if (!this.cloud.dirtyIds().length && !this.trashPending()) return;
        this.startTransfer('push', false, true);
        return this.syncJob;
    }
    pendingItems() { return this.cloud.pendingItems(); }
    async pullCached({ deferProgress = false } = {}) {
        this.operation = { ...this.operation, step: 'pull' }; this.progress({ phase: 'Checking cloud directory', completed: 0, total: null });
        if (this.run) return this.run(this.store, this.readConfig(), 'pull');
        await this.cloud.connect();
        const catalog = await this.cloud.catalog();
        const projects = this.cloud.summaries(), started = Date.now(); let completed = 0;
        this.cloud.report('Updating project lists', 0, projects.length, started);
        for (const p of projects) { await this.cloud.project(p.id); this.cloud.report('Updating project lists', ++completed, projects.length, started, p.name); }
        const items = this.cloud.items();
        const importsPending = items.some(i => i.versions?.some(v => !(this.cloud.cache().loaded[i.id] || []).includes(v.ref)));
        this.pullGroup = { completed: 0, fraction: 0, total: items.length };
        try {
            this.cloud.report('Pulling sessions', 0, items.length, started);
            for (const [index, item] of items.entries()) { this.cloud.report('Updating downloaded sessions', 0, null, started, item.name); await this.cloud.hydrate(item.id, { latest: true }); this.cloud.report('Pulling sessions', index + 1, items.length, started, item.name); }
        } finally { this.pullGroup = null; }
        this.cloud.saveDirectory(); this.store.local('lastPull', now());
        if (!deferProgress) this.cloud.report('Pull complete', items.length, items.length, started);
        return { downloaded: items.length, unchanged: catalog?.remoteChanged === false && !importsPending };
    }
    startTransfer(direction, manual = true, captured = false) {
        assert(['pull', 'push'].includes(direction), 'Choose Pull or Push.');
        assert(!this.running && !this.pending && !this.migrating, 'A cloud transfer is already running.', 409);
        assert(this.unlocked && this.readConfig()?.url, 'Configure sync in Settings first.');
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
            beginPush();
            const ids = this.cloud.dirtyIds();
            const result = this.run ? await this.run(this.store, this.readConfig(), 'push', ids) : (ids.length || this.trashPending() || this.cloud.archiveCleanupNeeded?.()) ? await this.cloud.publish(ids, { catalogFresh: true }) : { uploaded: 0, published: 0 };
            this.queue = new Set(this.cloud.dirtyIds()); this.store.local('uploadQueue', [...this.queue]);
            this.store.local('lastSync', { at: now(), ...result }); this.needsReview = null;
            this.operation = { ...this.operation, summary: { checked: pulled?.downloaded || 0, published: result.published || 0, uploaded: result.uploaded || 0 } };
            return { ...pulled, ...result };
        }, false, direction, manual);
        this.syncJob.catch(() => {});
        return { operationId: this.operation.id };
    }
    status() {
        const configured = !!this.readConfig()?.url, dirty = this.cloud.dirtyIds();
        this.reconcileTimer(dirty.length>0);
        this.cloud.useSavedCache(); const cache = this.cloud.cache();
        let operation = this.running ? this.operation : this.lastManualOperation?.state === 'error' ? this.lastManualOperation : this.operation || this.lastManualOperation;
        if (!this.running && this.needsReview && this.lastFailure && (!operation || this.lastFailure.finishedAt >= (operation.finishedAt || 0))) operation = this.lastFailure;
        const error = this.needsReview && this.lastFailure?.requiresReview ? this.lastFailure.error : this.lastManualOperation?.state === 'error' ? this.lastManualOperation.error : this.error;
        return { provider: 'git', lastFailure: this.lastFailure || null, manualOperation: this.running && this.operation?.manual ? this.operation : this.lastManualOperation || null, needsReview: this.needsReview || null, started: this.store.local('syncStarted') !== false, operation: operation || null, configured, unlocked: this.unlocked, queued: this.queue.size > 0, dirty: dirty.length > 0 || this.trashPending(), dirtyCount: dirty.length + Number(this.trashPending()),
            phase: this.migrating ? 'migrating' : this.running ? 'syncing' : !configured ? 'unconfigured' : !this.unlocked ? 'locked' : this.error ? this.store.local('syncStarted') === false ? 'failed' : 'retrying' : this.queue.size ? 'queued' : dirty.length || this.trashPending() ? 'local' : 'synced',
            nextRunAt: !preferences(this.store).autoUploadEnabled || this.running || this.needsReview || !dirty.length && !this.trashPending() || this.store.local('syncStarted') === false || !this.unlocked || !configured ? null : this.retryAt > Date.now() ? this.retryAt : this.queue.size && this.queuedAt ? this.queuedAt : this.nextFallbackAt, error, retryAt: this.retryAt || null, fallbackMinutes: preferences(this.store).autoUploadEnabled ? preferences(this.store).autoUploadMinutes : null, lastUpload: cache.lastUpload || null, lastCheck: cache.checkedAt || null, lastSuccess: cache.lastUpload || null };
    }
    unlock() { this.unlocked = true; this.error = null; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0; if (this.queue.size) this.schedule([...this.queue]); this.reconcileTimer(); }
    lock() { this.queuedAt = null; this.unlocked = false; this.cloud.lock(); clearTimeout(this.timer); clearTimeout(this.retryTimer); clearTimeout(this.interval);this.interval=null;this.nextFallbackAt=null; }
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
        this.store.transferReaders = (this.store.transferReaders || 0) + 1;
        this.pending = Promise.resolve().then(fn);
        try { const result = await this.pending; this.operation = { ...this.operation, state: 'success', finishedAt: Date.now() }; this.error = null; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0; this.diagnostics?.record('cloud-operation', { phase: 'complete', durationMs: Date.now() - started }); return result; }
        catch (e) { this.operation = { ...this.operation, state: 'error', error: e.message, finishedAt: Date.now() }; this.error = e.message; this.failures++; this.retryAt = Date.now() + Math.max(e.retryAfterMs || 0, Math.min(30 * 60 * 1000, 60000 * 2 ** Math.min(5, this.failures - 1)));
            this.lastFailure = { ...this.operation, network: this.status().operation?.network, requiresReview: !!e.requiresReview }; this.store.local('lastSyncFailure', this.lastFailure);
            clearTimeout(this.retryTimer); if(manual || e.requiresReview)this.needsReview={retry:true,cleanup:!!e.requiresReview};else if (preferences(this.store).autoUploadEnabled && direction !== 'pull') {this.retryTimer = setTimeout(() => this.fallback().catch(() => {}), Math.min(2147483647, Math.max(1, this.retryAt - Date.now()))); this.retryTimer.unref();} this.diagnostics?.record('cloud-operation', { phase: 'failed', code: 'cloud_failed', durationMs: Date.now() - started }); throw e; }
        finally { if(manual){this.lastManualOperation=this.operation;this.store.local('lastManualSync',this.operation);} this.pending = null; this.running = false; this.store.transferReaders--; if (!this.store.transferReaders && this.store.cleanupDeferred) { this.store.cleanupDeferred = false; cleanupLocal(this.store); } this.reconcileTimer(); this.onOperation?.(this.operation); }
    }
    async flush(direction = 'queued', explicit = false, captured = false) {
        if (!explicit && (this.closed || !this.unlocked || !this.readConfig()?.url || this.migrating || this.retryAt > Date.now() || this.store.local('syncStarted') === false)) return null;
        if (!explicit && (!preferences(this.store).autoUploadEnabled || this.needsReview || !this.cloud.dirtyIds().length && !this.trashPending())) return null;
        this.startTransfer(direction === 'pull' ? 'pull' : 'push', explicit, captured);
        return this.syncJob;
    }
    async openProject(projectId, query = '') {
        if (this.store.local('syncStarted') === false || !this.unlocked || !this.readConfig()?.url) {
            const refs = this.cloud.projectRefs().filter(p => p.id === projectId);
            assert(!refs.length || refs.some(p => this.cloud.cache().indexes[p.index]), 'Connect sync to download this project.');
            return;
        }
        const refs = this.cloud.projectRefs().filter(p => p.id === projectId);
        const missing = refs.some(p => !this.cloud.cache().indexes[p.index]);
        if (!missing && !query.trim()) return;
        if (this.retryAt > Date.now()) { assert(!missing, 'Cloud index unavailable offline.'); return; }
        return this.exclusive(async () => {
            const items = await this.cloud.project(projectId);
            // A full-text search is an explicit request for these transcripts.
            if (query.trim()) for (const item of items) await this.cloud.hydrate(item.id);
        }).catch(e => {
            if (query || !this.cloud.items().some(i => i.projectId === projectId) && !this.store.all('project').some(p => p.id === projectId)) throw e;
            // A cached project remains available offline; status retains the network error.
        });
    }
    async openTree(treeId) {
        const local = this.store.all('branch').find(b => b.id === treeId);
        // Local materialization is durable. Remote updates are applied by Sync.
        if (local) return;
        if (this.store.local('syncStarted') === false || !this.unlocked || !this.readConfig()?.url) {
            assert(this.store.all('branch').some(b => b.id === treeId), this.unlocked && this.readConfig()?.url && this.store.local('syncStarted') === false ? 'Click Sync once to enable cloud reads.' : 'Connect sync to download this session.'); return;
        }
        const projectId = this.cloud.items().find(i => i.id === treeId)?.projectId;
        if (projectId) await this.openProject(projectId);
        const item = this.cloud.items().find(i => i.id === treeId);
        if (!item || item.versions.every(v => (this.cloud.cache().loaded[treeId] || []).includes(v.ref))) return;
        if (this.retryAt > Date.now() && local) return;
        return this.exclusive(async () => {
            const b = this.store.all('branch').find(b => b.id === treeId);
            const projectId = b ? cloudProjectId(b.projectId) : this.cloud.items().find(i => i.id === treeId)?.projectId;
            if (projectId) await this.cloud.project(projectId);
            return this.cloud.hydrate(treeId);
        }).catch(e => { if (!this.store.all('branch').some(b => b.id === treeId)) throw e; });
    }
    decorate(data) { return this.cloud.decorate(data); }
    listing(scope, query = '') { return this.cloud.listing(scope, query); }
    close() { this.closed = true; this.lock(); clearInterval(this.interval); }
}
