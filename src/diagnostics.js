import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export class Diagnostics {
    constructor(root) {
        this.directory = path.join(root, 'logs'); this.file = path.join(this.directory, 'operations.jsonl');
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        this.startedAt = new Date().toISOString(); this.metrics = new Map();
        this.record('startup', { mode: 'local' });
    }
    record(event, values = {}) {
        const row = { at: new Date().toISOString(), event, id: values.id || randomUUID().slice(0, 8) };
        // A strict allowlist prevents transcripts, URLs, paths, credentials and request bodies entering logs.
        for (const key of ['method', 'route', 'status', 'durationMs', 'code', 'count', 'updated', 'discovered', 'phase', 'mode']) if (values[key] !== undefined) row[key] = values[key];
        if (row.route) row.route = row.route.replace(/[a-f0-9-]{20,}/g, ':id').split('?')[0];
        try {
            if (fs.existsSync(this.file) && fs.statSync(this.file).size > 1024 * 1024) {
                for (let i = 2; i >= 1; i--) if (fs.existsSync(this.file + '.' + i)) fs.renameSync(this.file + '.' + i, this.file + '.' + (i + 1));
                fs.renameSync(this.file, this.file + '.1');
            }
            fs.appendFileSync(this.file, JSON.stringify(row) + '\n', { mode: 0o600 });
        } catch { /* Logging failure must not corrupt user operations. */ }
        return row.id;
    }
    request(method, route, status, durationMs, id) {
        const key = method + ' ' + route.replace(/[a-f0-9-]{20,}/g, ':id').split('?')[0], values = this.metrics.get(key) || [];
        values.push(durationMs); if (values.length > 128) values.shift(); this.metrics.set(key, values);
        if (method !== 'GET' || status >= 400 || durationMs > 250) this.record('request', { id, method, route: key.slice(method.length + 1), status, durationMs: Math.round(durationMs) });
    }
    report() {
        let events = []; try { events = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).slice(-200).map(v => JSON.parse(v)); } catch {}
        const memory = process.memoryUsage();
        return { version: '0.7.1', startedAt: this.startedAt, memoryMB: Math.round(memory.rss / 1048576), memory: Object.fromEntries(Object.entries(memory).map(([key, value]) => [key + 'MB', Math.round(value / 1048576)])), cpuMs: Object.fromEntries(Object.entries(process.cpuUsage()).map(([key, value]) => [key, Math.round(value / 1000)])), metrics: [...this.metrics].map(([route, values]) => { const sorted = [...values].sort((a, b) => a - b); return { route, samples: values.length, averageMs: Math.round(values.reduce((a, b) => a + b, 0) / values.length), p95Ms: Math.round(sorted[Math.floor((sorted.length - 1) * .95)]) }; }), events };
    }
}
