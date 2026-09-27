import { sync } from './sync.js';
import { assert, hash, now } from './util.js';
export class AutoSync {
    constructor(store, readConfig, run = sync) {
        this.store = store;
        this.readConfig = readConfig;
        this.run = run;
        this.passphrase = null;
        this.running = false;
        this.error = null;
        this.closed = false;
        this.interval = setInterval(() => this.flush().catch(() => { }), 15000);
        this.interval.unref();
    }
    fingerprint() { return hash(JSON.stringify(this.store.exportGraph())); }
    status() {
        const configured = !!this.readConfig()?.url, queued = this.fingerprint() !== this.store.local('cloudFingerprint');
        return { configured, unlocked: !!this.passphrase, queued, phase: this.running ? 'syncing' : !configured ? 'unconfigured' : !this.passphrase ? 'locked' : this.error ? 'retrying' : queued ? 'queued' : 'synced', error: this.error, lastSuccess: this.store.local('cloudSuccess') };
    }
    unlock(passphrase) { assert(typeof passphrase === 'string' && passphrase.length >= 12, 'Encryption passphrase needs at least 12 characters.'); this.passphrase = passphrase; this.error = null; }
    lock() { this.passphrase = null; clearTimeout(this.timer); }
    schedule() {
        if (this.closed)
            return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush().catch(() => { }), 700);
        this.timer.unref();
    }
    async flush(direction = 'both', explicit = false) {
        if (this.running || this.closed)
            return null;
        if (!this.readConfig()?.url || !this.passphrase) {
            if (explicit)
                throw new Error('Configure WebDAV and unlock project sync first.');
            return null;
        }
        this.running = true;
        this.error = null;
        try {
            const result = await this.run(this.store, this.readConfig(), this.passphrase, direction);
            // Pull alone does not acknowledge unsent local edits.
            if (direction !== 'pull')
                this.store.local('cloudFingerprint', this.fingerprint());
            this.store.local('cloudSuccess', now());
            return result;
        }
        catch (e) {
            this.error = e.message;
            throw e;
        }
        finally {
            this.running = false;
        }
    }
    close() { this.closed = true; this.passphrase = null; clearInterval(this.interval); clearTimeout(this.timer); }
}
