import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { Native } from './native.js';
import { AutoSync } from './auto-sync.js';
import { metadata } from './organization.js';
import { assert, atomic, json, text, now } from './util.js';
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
export function createApp({ root, roots, guard, demo = false }) {
    const store = new Store(root), native = new Native(store, { roots, guard }), token = randomBytes(32).toString('hex');
    const configFile = path.join(root, 'webdav.json');
    const autoSync = new AutoSync(store, () => json(configFile, {}));
    try {
        native.refreshLocal();
    }
    catch (e) {
        store.local('discoveryError', e.message);
    }
    const server = http.createServer(async (req, res) => {
        const send = (status, value, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" }); res.end(type === 'application/json' ? JSON.stringify(value) : value); if (req.method !== 'GET' && status < 400)
            autoSync.schedule(); };
        try {
            const expected = `127.0.0.1:${server.address().port}`;
            assert(req.headers.host === expected, '请使用启动时显示的本地地址', 403);
            assert(!req.headers.origin || req.headers.origin === `http://${expected}`, '不允许跨站请求', 403);
            assert(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), '不允许跨站请求', 403);
            const url = new URL(req.url, `http://${expected}`), route = url.pathname;
            if (req.method === 'GET' && ['/', '/app.js', '/i18n.js', '/style.css'].includes(route)) {
                const file = route === '/' ? 'index.html' : route.slice(1);
                return send(200, fs.readFileSync(path.join(webRoot, file)), file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
            }
            if (req.method === 'GET' && route === '/api/bootstrap')
                return send(200, { token, demo, ...store.snapshot(), roots: native.roots, cloud: autoSync.status(), lastSync: store.local('lastSync'), plan: native.plan() });
            const supplied = Buffer.from(req.headers['x-grove-token'] || '');
            assert(supplied.length === token.length && timingSafeEqual(supplied, Buffer.from(token)), '本地访问凭证无效，请刷新页面', 403);
            let body = {};
            if (!['GET', 'HEAD'].includes(req.method)) {
                assert(req.headers['content-type']?.startsWith('application/json'), '请求必须是 JSON', 415);
                const chunks = [];
                let bytes = 0;
                for await (const chunk of req) {
                    bytes += chunk.length;
                    assert(bytes < 2 * 1024 * 1024, '请求过大', 413);
                    chunks.push(chunk);
                }
                try {
                    body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
                }
                catch {
                    throw Object.assign(new Error('JSON 格式错误'), { status: 400 });
                }
                assert(!autoSync.running, '同步进行中，请稍后操作', 409);
            }
            if (req.method === 'GET' && route === '/api/state')
                return send(200, { ...store.snapshot(), cloud: autoSync.status(), discoveryError: store.local('discoveryError'), lastSync: store.local('lastSync'), plan: native.plan() });
            if (req.method === 'GET' && route === '/api/discover')
                return send(200, native.discover());
            if (req.method === 'GET' && route === '/api/webdav') {
                const c = json(configFile, {});
                return send(200, { url: c.url || '', username: c.username || '', hasPassword: !!c.password });
            }
            const detail = route.match(/^\/api\/branches\/([^/]+)$/);
            if (req.method === 'GET' && detail)
                return send(200, store.detail(detail[1]));
            if (req.method === 'POST' && route === '/api/projects')
                return send(201, store.project(body.name, body.description));
            const project = route.match(/^\/api\/projects\/([^/]+)$/);
            if (req.method === 'PATCH' && project) {
                const p = store.get('project', project[1]), previous = structuredClone(p);
                if ('name' in body)
                    p.name = text(body.name);
                if ('description' in body)
                    p.description = String(body.description).slice(0, 2000);
                p.updatedAt = now();
                return send(200, store.put('project', metadata(previous, p)));
            }
            if (req.method === 'POST' && route === '/api/branches')
                return send(201, store.branch(body.projectId, body.name, body.agent));
            if (req.method === 'PATCH' && detail) {
                const b = store.edit(detail[1], body);
                if (body.archived)
                    native.setActive(b.id, null, false);
                return send(200, b);
            }
            const action = route.match(/^\/api\/branches\/([^/]+)\/(fork|active|commit|move)$/);
            if (req.method === 'POST' && action) {
                if (action[2] === 'commit')
                    return send(201, store.commitPending(action[1], body));
                if (action[2] === 'move')
                    return send(200, store.moveTree(action[1], body.projectId, body.group));
                return send(200, action[2] === 'fork' ? store.fork(action[1], body) : native.setActive(action[1], body.cwd, !!body.desired));
            }
            if (req.method === 'POST' && route === '/api/import')
                return send(201, native.import(body.key, body.projectId, body.name));
            if (req.method === 'POST' && route === '/api/collect')
                return send(200, native.refreshLocal());
            if (req.method === 'POST' && route === '/api/apply')
                return send(200, native.apply());
            if (req.method === 'POST' && route === '/api/recover')
                return send(200, native.recover(body.id));
            if (req.method === 'POST' && route === '/api/webdav') {
                const old = json(configFile, {}), url = new URL(body.url);
                assert(['http:', 'https:'].includes(url.protocol), '无效 URL');
                atomic(configFile, JSON.stringify({ url: body.url, username: String(body.username || ''), password: body.password || old.password || '' }));
                return send(200, { saved: true });
            }
            if (req.method === 'POST' && route === '/api/sync/lock') {
                autoSync.lock();
                return send(200, autoSync.status());
            }
            if (req.method === 'POST' && route === '/api/sync') {
                if (body.passphrase)
                    autoSync.unlock(body.passphrase);
                native.refreshLocal();
                return send(200, await autoSync.flush(body.direction || 'both', true));
            }
            if (req.method === 'POST' && route === '/api/conflicts/resolve') {
                const conflicts = store.local('conflicts') || [], c = conflicts[body.index];
                assert(c, '冲突不存在');
                if (body.choice === 'remote') {
                    if (c.kind === 'organization') {
                        const b = store.get('branch', c.local.id);
                        store.put('branch', { ...b, nodeHead: c.remote.nodeHead, updatedAt: now() });
                    }
                    else if (c.kind === 'branch') {
                        store.edit(c.local.id, { name: c.remote.name, group: c.remote.group, archived: c.remote.archived });
                        if (c.remote.archived)
                            native.setActive(c.local.id, null, false);
                    }
                    else {
                        const p = store.get('project', c.local.id);
                        store.put('project', metadata(p, { name: c.remote.name, description: c.remote.description }));
                    }
                }
                else
                    assert(body.choice === 'local', '未知选择');
                conflicts.splice(body.index, 1);
                store.local('conflicts', conflicts);
                return send(200, { resolved: true });
            }
            return send(404, { error: '接口不存在' });
        }
        catch (e) {
            send(e.status || 400, { error: e.message });
        }
    });
    const interval = setInterval(() => {
        if (!autoSync.running) {
            try {
                const r = native.refreshLocal();
                if (r.updates.length || r.discovered || r.grouped)
                    autoSync.schedule();
            }
            catch { /* Next manual capture surfaces errors. */ }
        }
    }, 10000);
    interval.unref();
    server.on('close', () => { clearInterval(interval); autoSync.close(); store.close(); });
    return { server, store, native, autoSync };
}
