import path from 'node:path';
import { GitCloud } from './git-cloud.js';
import { gitRemote } from './git-remote.js';
import { atomic, json, assert } from './util.js';
import { preferences, savePreferences } from './preferences.js';

export function connectionError(error) {
    const message = error.message || '';
    if (/Permission denied.*publickey|no supported authentication/i.test(message)) return 'SSH authentication failed. Check your SSH key and repository access.';
    if (/Host key verification failed/i.test(message)) return 'SSH host verification failed. Verify this host in your SSH configuration.';
    if (/Repository not found|does not appear to be a git repository/i.test(message)) return 'Repository unavailable. Check its address and your account access.';
    if (/Could not resolve|Connection timed out|Connection refused|Network is unreachable/i.test(message)) return 'Cannot reach the Git server. Check the address and network connection.';
    if (error.code === 'ENOENT') return 'Git is not installed or is unavailable to Grove.';
    return message;
}

export class GitSettings {
    constructor(root, store, autoSync, onTimers) {
        Object.assign(this, { root, store, autoSync, onTimers });
        this.file = path.join(root, 'git-sync.json');
        this.job = null;
    }
    read() { return { ...json(this.file, {}), provider: 'git' }; }
    status() {
        const config = this.read();
        return { provider: 'git', url: config.url || '', verified: !!config.verified,
            preferences: preferences(this.store), job: this.job };
    }
    async verify(body) {
        assert(!this.autoSync.running && !this.job, 'Wait for the current transfer before changing repositories.', 409);
        const config = { provider: 'git', url: gitRemote(body.url?.trim()) };
        this.job = { state: 'running', phase: 'Checking Git repository' };
        const cloud = new GitCloud(this.store, () => config);
        try {
            // Fetch validates access and the Grove format without publishing anything.
            await cloud.connect();
            await cloud.connection.remote.fetch();
            this.autoSync.lock();
            atomic(this.file, JSON.stringify({ ...config, verified: true }));
            this.autoSync.cloud.cacheKey = undefined;
            this.autoSync.unlock('');
            this.autoSync.error = null; this.autoSync.needsReview = null;
            this.autoSync.lastFailure = null; this.autoSync.lastManualOperation = null; this.autoSync.operation = null;
            this.store.local('lastSyncFailure', null); this.store.local('lastManualSync', null);
            this.store.local('syncStarted', false);
            this.autoSync.configureTimer();
            return this.status();
        } catch (error) {
            throw new Error(connectionError(error), { cause: error });
        } finally { cloud.lock(); this.job = null; }
    }
    async start(body) { return this.verify(body); }
    async recover() { throw new Error('Reconnect the Git repository in Settings.'); }
    timers(body) {
        const saved = savePreferences(this.store, body);
        if (body.autoUploadEnabled === true) this.store.local('syncStarted', true);
        this.autoSync.configureTimer(); this.onTimers(); return saved;
    }
}
