import { Cloud } from './cloud.js';
import { assert, now } from './util.js';
export class AutoSync {
    constructor(store, readConfig, run = null) {
        this.store = store; this.readConfig = readConfig; this.run = run;
        this.cloud = new Cloud(store, readConfig);
        this.passphrase = null; this.running = false; this.error = null; this.closed = false;
        this.queue = new Set(store.local('uploadQueue') || []);
        this.interval = setInterval(() => { if (!this.running) this.flush('pull').then(() => this.flush('queued')).catch(() => {}); }, 15000);
        this.interval.unref();
    }
    status() {
        const configured = !!this.readConfig()?.url, dirty = this.cloud.dirtyIds();
        this.cloud.useSavedCache(); const cache = this.cloud.cache();
        return { configured, unlocked: !!this.passphrase, queued: this.queue.size > 0, dirty: dirty.length > 0, dirtyCount: dirty.length,
            phase: this.running ? 'syncing' : !configured ? 'unconfigured' : !this.passphrase ? 'locked' : this.error ? 'retrying' : this.queue.size ? 'queued' : dirty.length ? 'local' : 'synced',
            error: this.error, lastUpload: cache.lastUpload || null, lastCheck: cache.checkedAt || null, lastSuccess: cache.lastUpload || null };
    }
    unlock(passphrase) { assert(typeof passphrase === 'string' && passphrase.length >= 12, 'Encryption passphrase needs at least 12 characters.'); this.passphrase = passphrase; this.error = null; }
    lock() { this.passphrase = null; this.cloud.lock(); clearTimeout(this.timer); }
    schedule(ids = this.cloud.dirtyIds()) {
        if (this.closed) return;
        for (const id of ids) this.queue.add(id);
        this.store.local('uploadQueue', [...this.queue]);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush('queued').catch(() => {}), 2000);
        this.timer.unref();
    }
    async exclusive(fn) {
        if (this.pending) await this.pending.catch(() => {});
        // Multiple GETs may wait together; recheck after yielding.
        if (this.pending) return this.exclusive(fn);
        this.running = true;
        this.pending = Promise.resolve().then(fn);
        try { const result = await this.pending; this.error = null; return result; }
        catch (e) { this.error = e.message; throw e; }
        finally { this.pending = null; this.running = false; }
    }
    async flush(direction = 'queued', explicit = false) {
        if (this.closed) return null;
        if (!this.readConfig()?.url || !this.passphrase) {
            if (explicit) throw new Error('Configure WebDAV and unlock project sync first.');
            return null;
        }
        return this.exclusive(async () => {
            if (direction === 'pull') return this.run ? this.run(this.store, this.readConfig(), this.passphrase, 'pull') : this.cloud.catalog(this.passphrase);
            assert(['push', 'both', 'queued'].includes(direction), 'Unknown sync direction.');
            if (!this.run) await this.cloud.connect(this.passphrase);
            if (direction === 'both' && !this.run) await this.cloud.catalog(this.passphrase);
            const dirty = this.cloud.dirtyIds();
            this.queue = new Set([...this.queue].filter(id => dirty.includes(id)));
            this.store.local('uploadQueue', [...this.queue]);
            const ids = direction === 'queued' ? dirty.filter(id => this.queue.has(id)) : dirty;
            if (!ids.length) return { published: 0, uploaded: 0 };
            const result = this.run ? await this.run(this.store, this.readConfig(), this.passphrase, direction, ids) : await this.cloud.publish(ids, this.passphrase);
            for (const id of ids) this.queue.delete(id);
            this.store.local('uploadQueue', [...this.queue]);
            this.store.local('lastSync', { at: now(), ...result });
            return result;
        });
    }
    async openProject(projectId, query = '') {
        if (!this.passphrase || !this.readConfig()?.url) {
            const refs = this.cloud.projectRefs().filter(p => p.id === projectId);
            assert(!refs.length || refs.some(p => this.cloud.cache().indexes[p.index]), 'Unlock sync to download this project.');
            return;
        }
        return this.exclusive(async () => {
            await this.cloud.catalog(this.passphrase);
            const items = await this.cloud.project(projectId, this.passphrase);
            // A full-text search is an explicit request for these transcripts.
            if (query.trim()) for (const item of items) await this.cloud.hydrate(item.id, this.passphrase);
        }).catch(e => {
            if (query || !this.cloud.items().some(i => i.projectId === projectId) && !this.store.all('project').some(p => p.id === projectId)) throw e;
            // A cached project remains available offline; status retains the network error.
        });
    }
    async openTree(treeId) {
        if (!this.passphrase || !this.readConfig()?.url) {
            assert(this.store.all('branch').some(b => b.id === treeId), 'Unlock sync to download this session.'); return;
        }
        return this.exclusive(async () => {
            const last = this.cloud.cache().checkedAt;
            if (!last || Date.now() - new Date(last).getTime() > 5000) await this.cloud.catalog(this.passphrase);
            const b = this.store.all('branch').find(b => b.id === treeId);
            const projectId = b?.projectId || this.cloud.items().find(i => i.id === treeId)?.projectId;
            if (projectId) await this.cloud.project(projectId, this.passphrase);
            return this.cloud.hydrate(treeId, this.passphrase);
        }).catch(e => { if (!this.store.all('branch').some(b => b.id === treeId)) throw e; });
    }
    decorate(data) { return this.cloud.decorate(data); }
    listing(scope, query = '') { return this.cloud.listing(scope, query); }
    close() { this.closed = true; this.lock(); clearInterval(this.interval); }
}
