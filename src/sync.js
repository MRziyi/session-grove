import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(gzip);
export async function sealAsync(value, key) {
    const body = await compress(Buffer.from(JSON.stringify(value)), { level: 6 });
    if (key === null) return Buffer.concat([Buffer.from('SGP1'), body]);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
import { assert, hash, id, now } from './util.js';
export function seal(value, key) {
    if (key === null) return Buffer.concat([Buffer.from('SGP1'), gzipSync(Buffer.from(JSON.stringify(value)))]);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(value)))), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
export function unseal(buffer, key) {
    if (key === null) { assert(buffer.subarray(0, 4).toString() === 'SGP1', 'Expected an unencrypted object.'); return JSON.parse(gunzipSync(buffer.subarray(4), { maxOutputLength: 128 * 1024 * 1024 }).toString()); }
    assert(buffer.length > 28, '同步对象不完整');
    try {
        const cipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
        cipher.setAuthTag(buffer.subarray(12, 28));
        return JSON.parse(gunzipSync(Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]), { maxOutputLength: 128 * 1024 * 1024 }).toString());
    }
    catch {
        throw new Error('解密或完整性校验失败，请检查加密口令');
    }
}
export class WebDAV {
    constructor(config) {
        const url = new URL(config.url);
        assert(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'WebDAV 需要 HTTPS（本地测试可用 HTTP）');
        assert(!url.username && !url.password && !url.search && !url.hash, 'URL 不应包含凭据、查询或片段');
        this.metrics = { requests: 0, methods: {}, bytesSent: 0, bytesReceived: 0, requestMs: 0 };
        this.controller = new AbortController();
        this.base = url.href.replace(/\/$/, '') + '/session-grove-v1/';
        this.authorization = 'Basic ' + Buffer.from(`${config.username || ''}:${config.password || ''}`).toString('base64');
    }
    scoped(prefix) { const child = Object.create(this); child.base = this.base + prefix; return child; }
    async request(method, key = '', body, extra = {}, expectedBytes = 0) {
        this.controller.signal.throwIfAborted();
        assert(!key.split('/').some(p => p === '..' || p === '.'), '无效远程路径');
        const started = performance.now(); this.metrics.requests++; this.metrics.methods[method] = (this.metrics.methods[method] || 0) + 1; this.metrics.bytesSent += body ? Buffer.byteLength(body) : 0;
        const size = body ? Buffer.byteLength(body) : Number.isFinite(expectedBytes) && expectedBytes > 0 ? expectedBytes : 0;
        const timeout = /^(objects|trees|projects)\//.test(key) || size>262144 ? Math.min(600000, Math.max(180000, 30000 + Math.ceil(size / 32768) * 1000)) : 30000;
        const response = await fetch(this.base + key.split('/').map(encodeURIComponent).join('/'), { method, body, headers: { Authorization: this.authorization, 'Accept-Encoding': 'identity', ...extra }, redirect: 'error', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeout)]) });
        this.metrics.requestMs += performance.now() - started;
        if ([429, 503].includes(response.status)) {
            const retry = response.headers.get('retry-after'), seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.max(0, (Date.parse(retry) - Date.now()) / 1000) : 60;
            await response.body?.cancel();
            throw Object.assign(new Error(`WebDAV temporarily unavailable (${response.status}).`), { code: 'WEBDAV_BACKOFF', retryAfterMs: Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000) });
        }
        return response;
    }
    async get(key, expectedBytes = 0) {
        for (let attempt=0;;attempt++) {
            try {
                const r = await this.request('GET', key, undefined, {}, expectedBytes);
                if (r.status === 404) return null;
                assert(r.ok, `WebDAV GET 失败 (${r.status})`);
                return await this.readResponse(r);
            } catch(e) {
                const code=e.cause?.code||e.code;
                if(this.controller.signal.aborted||attempt>=2||!['UND_ERR_SOCKET','ECONNRESET','ETIMEDOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code))throw e;
                await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
            }
        }
    }
    async readResponse(r, limit = 128 * 1024 * 1024) {
        if (!r.body) return Buffer.alloc(0);
        const chunks = [];
        let size = 0;
        for await (const chunk of r.body) {
            size += chunk.length; this.metrics.bytesReceived += chunk.length;
            assert(size <= limit, '远端对象超过大小限制');
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
    async put(key, body, exclusive = false) {
        const r = await this.request('PUT', key, body, exclusive ? { 'If-None-Match': '*' } : {});
        await this.readResponse(r, 1024 * 1024);
        if (exclusive && r.status === 412)
            return false;
        assert(r.ok, `WebDAV PUT 失败 (${r.status})`);
        return true;
    }
    async mkdir(key = '') {
        const r = await this.request('MKCOL', key);
        await this.readResponse(r, 1024 * 1024);
        assert(r.ok || r.status === 405, `WebDAV 创建目录失败 (${r.status})`);
    }
    async list(directory = 'commits/', pattern = /^[0-9T-]+-[a-f0-9-]+\.bin$/) {
        const r = await this.request('PROPFIND', directory, undefined, { Depth: '1' });
        assert(r.ok, `WebDAV 列出版本失败 (${r.status})`);
        const xml = (await this.readResponse(r, 16 * 1024 * 1024)).toString();
        assert(xml.length < 16 * 1024 * 1024, '远端目录过大');
        const result = [];
        for (const m of xml.matchAll(/<(?:[\w-]+:)?href(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?href>/g)) {
            const href = m[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
            const name = decodeURIComponent(href.split('/').at(-1));
            if (pattern.test(name))
                result.push(name);
        }
        return [...new Set(result)].sort();
    }
}
export async function sync(store, config, passphrase, direction = 'both') {
    assert(['push', 'pull', 'both'].includes(direction), '未知同步方向');
    assert(typeof passphrase === 'string' && passphrase.length >= 12, '加密口令至少 12 字符；新设备使用同一口令');
    const dav = new WebDAV(config);
    await dav.mkdir();
    await dav.mkdir('objects/');
    await dav.mkdir('commits/');
    let vaultBytes = await dav.get('vault.json');
    if (!vaultBytes) {
        assert(direction !== 'pull', '远端还没有 Session Grove 资料库');
        const salt = randomBytes(16).toString('hex'), key = scryptSync(passphrase, salt, 32);
        await dav.put('vault.json', Buffer.from(JSON.stringify({ schema: 1, salt, check: seal('session-grove', key).toString('base64') })), true);
        vaultBytes = await dav.get('vault.json');
    }
    const vault = JSON.parse(vaultBytes.toString());
    assert(vault.schema === 1 && /^[a-f0-9]{32}$/.test(vault.salt), '不兼容的远端资料库');
    const key = scryptSync(passphrase, vault.salt, 32);
    assert(unseal(Buffer.from(vault.check, 'base64'), key) === 'session-grove', '口令不匹配');
    const trackingKey = 'sync:' + hash(dav.base + vault.salt), tracking = store.local(trackingKey) || { seen: [], uploaded: [] };
    const result = { pulled: 0, uploaded: 0, forks: 0, conflicts: 0 };
    if (direction !== 'push') {
        for (const name of await dav.list()) {
            if (tracking.seen.includes(name))
                continue;
            const bytes = await dav.get('commits/' + name);
            assert(bytes, '远端版本在读取中消失');
            const commit = unseal(bytes, key);
            assert([1, 2, 3].includes(commit.graph?.schema) && Array.isArray(commit.graph.revisions), '无效版本清单');
            const objects = {};
            for (const h of new Set(commit.graph.revisions.flatMap(r => r.refs))) {
                assert(typeof h === 'string' && /^[a-f0-9]{64}$/.test(h), '无效对象引用');
                if (store.db.prepare('SELECT 1 FROM objects WHERE hash=?').get(h))
                    continue;
                const object = await dav.get('objects/' + h + '.bin');
                assert(object, `远端版本不完整：缺少 ${h.slice(0, 12)}`);
                objects[h] = unseal(object, key);
                assert(typeof objects[h] === 'string' && hash(objects[h]) === h, '内容校验失败');
            }
            const merged = store.merge(commit.graph, objects);
            result.forks += merged.forks;
            result.conflicts = merged.conflicts;
            tracking.seen.push(name);
            store.local(trackingKey, tracking);
            result.pulled++;
        }
    }
    if (direction !== 'pull') {
        const uploaded = new Set(tracking.uploaded), graph = store.exportGraph();
        for (const h of new Set(graph.revisions.flatMap(r => r.refs))) {
            if (uploaded.has(h))
                continue;
            const body = store.db.prepare('SELECT body FROM objects WHERE hash=?').get(h)?.body;
            assert(typeof body === 'string', '本地对象缺失');
            const existing = await dav.request('HEAD', 'objects/' + h + '.bin');
            if (existing.status === 404) {
                await dav.put('objects/' + h + '.bin', seal(body, key), true);
                result.uploaded++;
            }
            else
                assert(existing.ok, `WebDAV HEAD 失败 (${existing.status})`);
            uploaded.add(h);
        }
        const fingerprint = hash(JSON.stringify(graph));
        if (tracking.lastFingerprint !== fingerprint) {
            const name = now().replace(/[:.Z]/g, '-') + '-' + id() + '.bin';
            await dav.put('commits/' + name, seal({ device: store.device, createdAt: now(), graph }, key), true);
            tracking.seen.push(name);
            tracking.lastFingerprint = fingerprint;
        }
        tracking.uploaded = [...uploaded];
        store.local(trackingKey, tracking);
    }
    store.local('lastSync', { at: now(), ...result });
    return result;
}
