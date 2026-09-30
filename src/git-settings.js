import fs from 'node:fs';
import path from 'node:path';
import { GitCloud } from './git-cloud.js';
import { gitRemote } from './git-remote.js';
import { atomic, json, assert } from './util.js';
import { preferences, savePreferences } from './preferences.js';

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
            legacyAvailable: fs.existsSync(path.join(this.root, 'webdav.json')),
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
