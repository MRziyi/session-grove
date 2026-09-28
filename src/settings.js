import fs from 'node:fs';
import path from 'node:path';
import { connectionConfig, baseUrl, APP_FOLDER, verifyConnection, migrateVault, vaultKey } from './vault.js';
import { WebDAV } from './sync.js';
import { Cloud } from './cloud.js';
import { atomic, json, assert, hash } from './util.js';
import { preferences, savePreferences } from './preferences.js';
export class Settings {
    constructor(root, store, autoSync, onTimers) {
        Object.assign(this, { root, store, autoSync, onTimers });
        this.file = path.join(root, 'webdav.json'); this.keyFile = path.join(root, 'sync-key.txt'); this.journal = path.join(root, 'sync-settings-pending.json');
        this.job = null; this.draft = null;
    }
    read() { return json(this.file, {}); }
    savedKey() { try { assert(!(fs.statSync(this.keyFile).mode & 0o077), 'Sync key file must have owner-only permissions.'); return fs.readFileSync(this.keyFile, 'utf8').replace(/\r?\n$/, ''); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
    status() {
        const c = this.draft?.config || this.read(), key = this.savedKey();
        return { url: baseUrl(c), suffix: APP_FOLDER + '/', username: c.username || '', hasPassword: !!c.password, verified: !!this.draft || !!c.verified,
            encryptionReady: !this.draft && !!c.encryptionReady, encrypted: c.encryptionReady ? c.encrypted : this.draft?.vault ? this.draft.vault.mode !== 'plain' : key !== null && key !== '',
            hasPassphrase: key !== null && key !== '', needsCurrentPassphrase: !!this.draft?.vault && this.draft.vault.mode !== 'plain' && key === null,
            existingVault: !!this.draft?.vault, preferences: preferences(this.store), job: this.job, recoverable: fs.existsSync(this.journal) };
    }
    async verify(body) {
        assert(!this.job || !['running'].includes(this.job.state), 'Settings migration in progress.');
        const old = this.read(), config = connectionConfig(body, old), result = await verifyConnection(config);
        if (old.url && config.url !== old.url) assert(!result.vault, 'Destination already has a vault. Choose an empty application folder.');
        this.draft = { config, vault: result.vault }; return this.status();
    }
    start(body) {
        assert(!this.job || this.job.state !== 'running', 'Settings migration in progress.');
        const old = this.read(), destination = this.draft?.config || old;
        assert(this.draft || old.verified, 'Verify WebDAV first.');
        const oldPassphrase = body.currentPassphrase ?? this.savedKey();
        const passphrase = body.passphrase === undefined ? oldPassphrase ?? (this.draft?.vault?.mode === 'plain' ? '' : null) : body.passphrase;
        assert(typeof passphrase === 'string' && (!passphrase.length || passphrase.length >= 12), 'Use at least 12 characters, or leave encryption off.');
        this.job = { state: 'running', phase: this.autoSync.running ? 'waiting' : 'preparing', completed: 0, total: 0 };
        this.autoSync.migrating = true;
        const started = Date.now(); this.diagnostics?.record('settings-change', { phase: 'started' });
        this.pending = (async () => {
            let cleanupPending = 0, migratedCache = null;
            try {
                await this.autoSync.pending?.catch(() => {});
                this.autoSync.lock();
                // Journal is private and contains the new key before the remote publication point.
                atomic(this.journal, JSON.stringify({ destination, passphrase }));
                const sourceConfig = (old.encryptionReady || old.url && this.savedKey() !== null) && old.url !== destination.url ? old : destination;
                const { vault } = await verifyConnection(sourceConfig);
                if (vault) {
                    assert(oldPassphrase !== null || vault.mode === 'plain', 'Enter the current encryption passphrase to unlock existing data.');
                    const previous = vault.mode === 'plain' ? '' : oldPassphrase;
                    vaultKey(vault, previous);
                    if (sourceConfig.url !== destination.url || previous !== passphrase) {
                        migratedCache = this.store.local('cloud:' + hash(new WebDAV(sourceConfig).base + vault.salt));
                        const result = await migrateVault(sourceConfig, destination, previous, passphrase, progress => { if (this.job.phase !== progress.phase) this.diagnostics?.record('settings-change', { phase: progress.phase, count: progress.completed }); Object.assign(this.job, progress); }); cleanupPending = result.cleanupPending;
                    }
                }
                const cloud = new Cloud(this.store, () => destination); await cloud.connect(passphrase); if (migratedCache) cloud.save(migratedCache); cloud.lock();
                this.commit(destination, passphrase);
                this.autoSync.unlock(passphrase); await this.autoSync.flush('pull', true);
                this.diagnostics?.record('settings-change', { phase: 'complete', count: cleanupPending, durationMs: Date.now() - started });
                this.job = { ...this.job, state: 'complete', phase: 'complete', cleanupPending }; this.draft = null;
            } catch (e) {
                this.diagnostics?.record('settings-change', { phase: 'failed', code: 'SETTINGS_CHANGE_FAILED', durationMs: Date.now() - started });
                this.job = { ...this.job, state: 'failed', error: e.message };
                this.autoSync.lock();
            } finally { this.autoSync.migrating = false; if (this.autoSync.passphrase !== null && this.autoSync.queue.size) this.autoSync.schedule([...this.autoSync.queue]); }
        })();
        return this.status();
    }
    commit(destination, passphrase) {
        atomic(this.keyFile, passphrase + '\n');
        atomic(this.file, JSON.stringify({ ...destination, verified: true, encryptionReady: true, encrypted: !!passphrase }));
        this.autoSync.cloud.lock(); this.autoSync.cloud.cacheKey = undefined;
        fs.rmSync(this.journal, { force: true });
    }
    async recover() {
        const pending = json(this.journal, null); assert(pending, 'No settings recovery is pending.');
        const { vault } = await verifyConnection(pending.destination); assert(vault, 'Migration did not publish. Verify the connection and retry the change.');
        vaultKey(vault, pending.passphrase); this.commit(pending.destination, pending.passphrase); this.autoSync.unlock(pending.passphrase);
        this.job = null; this.draft = null; await this.autoSync.flush('pull'); return this.status();
    }
    timers(body) { const p = savePreferences(this.store, body); this.autoSync.configureTimer(); this.onTimers(); return p; }
}
