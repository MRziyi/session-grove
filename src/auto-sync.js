import { cloudProjectId } from './inbox.js';
import { preferences } from './preferences.js';
import { Cloud } from './cloud.js';
import { assert, now, id } from './util.js';
export class AutoSync {
    constructor(store, readConfig, run = null) {
        this.store = store; this.readConfig = readConfig; this.run = run;
        this.cloud = new Cloud(store, readConfig);
        this.passphrase = null; this.running = false; this.error = null; this.closed = false; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0;
        this.queue = new Set(store.local('uploadQueue') || []);
        this.configureTimer();
    }
    configureTimer() {
        clearInterval(this.interval); this.nextFallbackAt = null;
        const p = preferences(this.store);
        if (p.autoUploadEnabled && this.store.local('syncStarted') !== false) { this.nextFallbackAt = Date.now() + p.autoUploadMinutes * 60000; this.interval = setInterval(() => { this.nextFallbackAt = Date.now() + p.autoUploadMinutes * 60000; this.fallback().catch(() => {}); }, p.autoUploadMinutes * 60000); this.interval.unref(); }
    }
    async fallback() {
        if (this.store.local('syncStarted') === false || !preferences(this.store).autoUploadEnabled || this.running || this.closed || !this.readConfig()?.url || this.passphrase === null || this.retryAt > Date.now()) return;
        return this.flush('push');
    }
    status() {
        const configured = !!this.readConfig()?.url, dirty = this.cloud.dirtyIds();
        this.cloud.useSavedCache(); const cache = this.cloud.cache();
        return { started: this.store.local('syncStarted') !== false, operation: this.operation || null, configured, unlocked: this.passphrase !== null, queued: this.queue.size > 0, dirty: dirty.length > 0, dirtyCount: dirty.length,
            phase: this.migrating ? 'migrating' : this.running ? 'syncing' : !configured ? 'unconfigured' : this.passphrase === null ? 'locked' : this.error ? this.store.local('syncStarted') === false ? 'failed' : 'retrying' : this.queue.size ? 'queued' : dirty.length ? 'local' : 'synced',
            nextRunAt: this.store.local('syncStarted') === false || this.passphrase === null || !configured ? null : this.retryAt > Date.now() ? this.retryAt : this.queue.size && this.queuedAt ? this.queuedAt : this.nextFallbackAt, error: this.error, retryAt: this.retryAt || null, fallbackMinutes: preferences(this.store).autoUploadEnabled ? preferences(this.store).autoUploadMinutes : null, lastUpload: cache.lastUpload || null, lastCheck: cache.checkedAt || null, lastSuccess: cache.lastUpload || null };
    }
    unlock(passphrase) { assert(typeof passphrase === 'string' && (passphrase.length === 0 || passphrase.length >= 12), 'Encryption passphrase needs at least 12 characters.'); this.passphrase = passphrase; this.error = null; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0; if (this.queue.size) this.schedule([...this.queue]); }
    lock() { this.queuedAt = null; this.passphrase = null; this.cloud.lock(); clearTimeout(this.timer); clearTimeout(this.retryTimer); }
    schedule(ids = this.cloud.dirtyIds()) {
        if (this.closed) return;
        for (const id of ids) this.queue.add(id);
        this.store.local('uploadQueue', [...this.queue]);
        if (this.store.local('syncStarted') === false) return;
        clearTimeout(this.timer);
        this.queuedAt = Date.now() + Math.max(2000, this.retryAt - Date.now());
        this.timer = setTimeout(() => { this.queuedAt = null; this.flush('queued').catch(() => {}); }, Math.min(2147483647, Math.max(2000, this.retryAt - Date.now())));
        this.timer.unref();
    }
    async exclusive(fn, allowMigration = false) {
        if (this.pending) await this.pending.catch(() => {});
        // Multiple GETs may wait together; recheck after yielding.
        if (this.pending) return this.exclusive(fn, allowMigration);
        if (this.migrating && !allowMigration) throw new Error('Settings migration in progress.');
        this.running = true; this.operation = { id: id(), state: 'running', startedAt: Date.now() }; this.onOperation?.(this.operation); const started = Date.now(); this.diagnostics?.record('cloud-operation', { phase: 'started' });
        this.pending = Promise.resolve().then(fn);
        try { const result = await this.pending; this.operation = { ...this.operation, state: 'success', finishedAt: Date.now() }; this.error = null; this.retryAt = 0; this.failures = 0; this.rateLimitUntil = 0; this.diagnostics?.record('cloud-operation', { phase: 'complete', durationMs: Date.now() - started }); return result; }
        catch (e) { this.operation = { ...this.operation, state: 'error', finishedAt: Date.now() }; this.error = e.message; this.failures++; if (e.code === 'WEBDAV_BACKOFF') this.rateLimitUntil = Date.now() + e.retryAfterMs; this.retryAt = Date.now() + Math.max(e.retryAfterMs || 0, Math.min(30 * 60 * 1000, 60000 * 2 ** Math.min(5, this.failures - 1)));
            clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.flush(this.queue.size ? 'queued' : 'pull').catch(() => {}), Math.min(2147483647, Math.max(1, this.retryAt - Date.now()))); this.retryTimer.unref(); this.diagnostics?.record('cloud-operation', { phase: 'failed', code: 'cloud_failed', durationMs: Date.now() - started }); throw e; }
        finally { this.pending = null; this.running = false; this.onOperation?.(this.operation); }
    }
    async flush(direction = 'queued', explicit = false, captured = false) {
        if (!explicit && this.store.local('syncStarted') === false) return null;
        if (direction === 'queued' && !this.queue.size) return { published: 0, uploaded: 0 };
        if (explicit && this.rateLimitUntil > Date.now()) throw new Error('Provider requested a pause. Try again after ' + new Date(this.rateLimitUntil).toLocaleTimeString());
        if (this.closed || !explicit && (this.migrating || this.retryAt > Date.now())) return null;
        if (!this.readConfig()?.url || this.passphrase === null) {
            if (explicit) throw new Error('Configure WebDAV and unlock project sync first.');
            return null;
        }
        const result = await this.exclusive(async () => {
            if (direction !== 'pull' && !captured) await this.beforeUpload?.();
            if (direction === 'pull') return this.run ? this.run(this.store, this.readConfig(), this.passphrase, 'pull') : this.cloud.catalog(this.passphrase);
            assert(['push', 'both', 'queued'].includes(direction), 'Unknown sync direction.');
            if (direction !== 'both' && !this.cloud.dirtyIds().length) return { published: 0, uploaded: 0 };
            if (!this.run) await this.cloud.connect(this.passphrase);
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
            for (const id of ids) this.queue.delete(id);
            this.store.local('uploadQueue', [...this.queue]);
            this.store.local('lastSync', { at: now(), ...result });
            return result;
        }, explicit);
        if (explicit) { this.store.local('syncStarted', true); this.configureTimer(); }
        return result;
    }
    async checkCatalog(maxAge = 2 * 60 * 1000) {
        if (this.store.local('syncStarted') === false || this.migrating || this.passphrase === null || !this.readConfig()?.url || this.retryAt > Date.now()) return;
        const checked = this.cloud.cache().checkedAt;
        if (checked && Date.now() - new Date(checked).getTime() < maxAge) return;
        return this.exclusive(async () => {
            const last = this.cloud.cache().checkedAt;
            if (!last || Date.now() - new Date(last).getTime() >= maxAge) await this.cloud.catalog(this.passphrase);
        }).catch(() => {});
    }
    async openProject(projectId, query = '', { check = false } = {}) {
        if (this.store.local('syncStarted') === false || this.passphrase === null || !this.readConfig()?.url) {
            const refs = this.cloud.projectRefs().filter(p => p.id === projectId);
            assert(!refs.length || refs.some(p => this.cloud.cache().indexes[p.index]), 'Unlock sync to download this project.');
            return;
        }
        if (check) await this.checkCatalog();
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
    async openTree(treeId, { check = false } = {}) {
        const local = this.store.all('branch').find(b => b.id === treeId);
        if (this.store.local('syncStarted') === false || this.passphrase === null || !this.readConfig()?.url) {
            assert(this.store.all('branch').some(b => b.id === treeId), 'Unlock sync to download this session.'); return;
        }
        if (check) await this.checkCatalog();
        const projectId = local ? cloudProjectId(local.projectId) : this.cloud.items().find(i => i.id === treeId)?.projectId;
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
