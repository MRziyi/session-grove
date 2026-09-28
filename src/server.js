import { Settings } from './settings.js';
import { preferences } from './preferences.js';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { Diagnostics } from './diagnostics.js';
import { activationInfo } from './activation.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { Native } from './native.js';
import { AutoSync } from './auto-sync.js';
import { metadata, treeMembers } from './organization.js';
import { isActive } from './workspace.js';
import { assert, atomic, json, text, now, id, hash } from './util.js';
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
export function createApp({ root, roots, guard, demo = false }) {
    const store = new Store(root), native = new Native(store, { roots, guard }), token = randomBytes(32).toString('hex');
    const webAssets = new Map(['index.html', 'app.js', 'select.js', 'markdown.js', 'i18n.js', 'style.css'].map(file => [file, fs.readFileSync(path.join(webRoot, file))]));
    const configFile = path.join(root, 'webdav.json');
    const diagnostics = new Diagnostics(root);
    const autoSync = new AutoSync(store, () => json(configFile, {}));
    autoSync.diagnostics = diagnostics;
    autoSync.beforeUpload = () => { const r = native.refreshLocal(); diagnostics.record('capture', { updated: r.updates.length, discovered: r.discovered, count: r.errors.length }); };
    let interval;
    const settings = new Settings(root, store, autoSync, configureCapture); settings.diagnostics = diagnostics;
    const savedKey = settings.savedKey();
    if (savedKey !== null && !fs.existsSync(settings.journal)) autoSync.unlock(savedKey);
    try {
        const started = performance.now(), captured = native.refreshLocal();
        diagnostics.record('capture', { mode: demo ? 'demo' : 'personal', discovered: captured.discovered, updated: captured.updates.length, count: captured.errors.length, durationMs: Math.round(performance.now() - started) });
    }
    catch (e) {
        diagnostics.record('capture-error', { code: 'INITIAL_CAPTURE_FAILED' });
        store.local('discoveryError', e.message);
    }
    const management = () => new Map(store.collections().items.filter(i => i.projectId).map(i => [i.id, hash(JSON.stringify([
        store.get('project', i.projectId), i.sessionIds.map(id => { const b = store.get('branch', id); return [b.id, b.name, b.projectId, b.archived, b.parentId, b.forkEnd, b.nodeHead, b.layoutHead, b.contextPolicy]; }),
        store.get('branch', i.id).layoutHead
    ]))]));
    const snapshot = () => autoSync.decorate(store.snapshot());
    const server = http.createServer(async (req, res) => {
        const started = performance.now(), requestId = id().slice(0, 8);
        const beforeManagement = req.method !== 'GET' ? management() : null;
        const send = (status, value, type = 'application/json') => { diagnostics.request(req.method, req.url.split('?')[0], status, performance.now() - started, requestId); res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" }); res.end(type === 'application/json' ? JSON.stringify(value) : value); if (beforeManagement && status < 400 && !req.url.startsWith('/api/sync') && !['/api/collect', '/api/webdav'].includes(req.url)) {
            const changed = [...management()].filter(([id, value]) => beforeManagement.get(id) !== value).map(([id]) => id);
            if (changed.length) autoSync.schedule(changed);
        } };
        try {
            const expected = `127.0.0.1:${server.address().port}`;
            assert(req.headers.host === expected, '请使用启动时显示的本地地址', 403);
            assert(!req.headers.origin || req.headers.origin === `http://${expected}`, '不允许跨站请求', 403);
            assert(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), '不允许跨站请求', 403);
            const url = new URL(req.url, `http://${expected}`), route = url.pathname;
            if (req.method === 'GET' && ['/', '/app.js', '/i18n.js', '/select.js', '/markdown.js', '/style.css'].includes(route)) {
                const file = route === '/' ? 'index.html' : route.slice(1);
                return send(200, webAssets.get(file), file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
            }
            if (req.method === 'GET' && route === '/api/bootstrap') {
                if (autoSync.passphrase !== null) autoSync.checkCatalog(5 * 60 * 1000).catch(() => {});
                return send(200, { token, demo, ...snapshot(), roots: native.roots, cloud: autoSync.status(), lastSync: store.local('lastSync'), plan: native.plan() });
            }
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
                assert(settings.job?.state !== 'running', 'Settings migration in progress.', 409);
            }
            if (req.method === 'GET' && route === '/api/state')
                return send(200, { ...snapshot(), cloud: autoSync.status(), discoveryError: store.local('discoveryError'), lastSync: store.local('lastSync'), plan: native.plan() });
            if (req.method === 'GET' && route === '/api/diagnostics') return send(200, { ...diagnostics.report(), webdav: autoSync.cloud.connection?.dav.metrics || null, fallbackMinutes: autoSync.status().fallbackMinutes });
            if (req.method === 'GET' && route === '/api/discover')
                return send(200, native.discover());
            if (req.method === 'GET' && ['/api/webdav', '/api/settings'].includes(route)) return send(200, settings.status());
            if (req.method === 'POST' && route === '/api/settings/verify') return send(200, await settings.verify(body));
            if (req.method === 'POST' && route === '/api/settings/confirm') return send(202, settings.start(body));
            if (req.method === 'POST' && route === '/api/settings/recover') return send(200, await settings.recover());
            if (req.method === 'POST' && route === '/api/settings/timers') return send(200, settings.timers(body));
            if (req.method === 'GET' && route === '/api/list') {
                const check = url.searchParams.get('check') === '1';
                const scope = url.searchParams.get('scope') || 'active:codex', query = url.searchParams.get('q') || '';
                if (scope === 'archived') for (const p of autoSync.cloud.summaries()) await autoSync.openProject(p.id, query, { check });
                else if (!scope.startsWith('active:')) await autoSync.openProject(scope, query, { check });
                return send(200, autoSync.listing(scope, query));
            }
            const tree = route.match(/^\/api\/trees\/([^/]+)$/);
            if (req.method === 'GET' && tree) { await autoSync.openTree(tree[1], { check: url.searchParams.get('check') === '1' }); return send(200, store.treeGraph(tree[1], url.searchParams.get('view') || 'in-use')); }
            if (req.method === 'POST' && tree) return send(200, store.organize(tree[1], body));
            if (req.method === 'POST' && route === '/api/move') {
                for (const id of body.itemIds || []) await autoSync.openTree(id, { check: true });
                if (body.projectId && !store.all('project').some(p => p.id === body.projectId)) {
                    const p = autoSync.cloud.summaries().find(p => p.id === body.projectId); assert(p, 'Project not found.');
                    const { index, treeIds, indexAncestors, count, ...project } = p; store.put('project', project);
                }
                return send(200, store.moveItems(body));
            }
            if (req.method === 'POST' && route === '/api/activation-check') return send(200, activationInfo(store, native, body.branchId, body.cwd));
            if (req.method === 'POST' && route === '/api/manage') {
                assert(['activate', 'deactivate', 'archive', 'restore'].includes(body.action), 'Unknown session action.');
                if (body.projectId && autoSync.passphrase !== null) {
                    await autoSync.openProject(body.projectId);
                    for (const i of autoSync.cloud.items().filter(i => i.projectId === body.projectId)) await autoSync.openTree(i.id);
                }
                for (const id of body.itemIds || []) await autoSync.openTree(id, { check: true });
                if (body.destinationProjectId && !store.all('project').some(p => p.id === body.destinationProjectId)) {
                    const p = autoSync.cloud.summaries().find(p => p.id === body.destinationProjectId); assert(p, 'Project not found.');
                    const { index, treeIds, indexAncestors, count, ...project } = p; store.put('project', project);
                }
                let members;
                if (body.projectId) members = store.all('branch').filter(b => b.projectId === store.get('project', body.projectId).id);
                else if (body.itemIds?.length) members = [...new Map(body.itemIds.flatMap(id => treeMembers(store, id)).map(b => [b.id, b])).values()];
                else members = (body.branchIds || []).map(id => store.get('branch', id));
                if (body.projectId || body.itemIds) members = members.filter(b => !b.excluded);
                assert(members.length, 'Select sessions first.');
                assert(members.every(b => !b.excluded), 'Agent-owned or empty records are not managed as sessions.');
                if (body.action === 'deactivate' && body.agent) members = members.filter(b => b.agent === body.agent && store.instances().some(i => i.branchId === b.id && isActive(i)));
                if (body.action === 'activate') {
                    assert(members.length === 1 && !members[0].synthetic, 'Select one native session to activate.');
                    assert(!members[0].projectId || !store.get('project', members[0].projectId).archived, 'Restore the project first.');
                }
                if (body.action === 'archive' && !body.projectId && !body.itemIds) {
                    assert(members.length === 1 && !members[0].synthetic && !members[0].archived, 'Select one in-use session endpoint to archive.');
                    const graph = store.treeGraph(members[0].id), node = graph.nodes.find(n => n.id === body.nodeId);
                    assert(body.version === graph.version && node?.endBranchIds.includes(members[0].id), 'Select the current session endpoint to archive.', 409);
                }
                if (body.action === 'activate') {
                    const check = activationInfo(store, native, members[0].id, body.cwd);
                    assert(!check.risk || body.contextAcknowledgement === check.fingerprint, 'Review the context-length warning before activating.', 409);
                }
                // Metadata changes follow successful native changes. A busy client leaves
                // both membership and Archive state untouched; the user can retry safely.
                const before = store.instances();
                if (body.action !== 'restore') {
                    try {
                        for (const b of members.filter(b => !b.synthetic)) native.setActive(b.id, body.cwd, body.action === 'activate');
                        if (native.plan().operations.some(op => members.some(b => b.id === op.branchId))) native.apply(members.map(b => b.id));
                    } catch (e) {
                        const after = store.instances();
                        for (const i of after) { const old = before.find(v => v.id === i.id); i.desired = old ? old.desired : false; }
                        store.local('instances', after);
                        throw e;
                    }
                }
                if (['archive', 'restore'].includes(body.action)) store.transaction(() => {
                    if (body.action === 'restore' && members.some(b => !b.projectId)) {
                        assert(body.destinationProjectId || body.projectName, 'Choose a project to restore ungrouped sessions.');
                        const destination = body.destinationProjectId ? store.get('project', body.destinationProjectId) : store.project(body.projectName);
                        assert(!destination.archived, 'Restore the destination project first.');
                        const unfiled = [...new Map(members.filter(b => !b.projectId).flatMap(b => treeMembers(store, b.id)).map(b => [b.id, b])).values()];
                        for (const b of unfiled) store.put('branch', metadata(b, { projectId: destination.id, group: '' }));
                        members = members.map(b => store.get('branch', b.id));
                    }
                    for (const b of members) store.edit(b.id, { archived: body.action === 'archive' });
                    if (body.projectId) {
                        const p = store.get('project', body.projectId);
                        store.put('project', metadata(p, { archived: body.action === 'archive' }));
                    } else if (body.action === 'restore') {
                        for (const id of new Set(members.map(b => b.projectId).filter(Boolean))) {
                            const p = store.get('project', id);
                            if (p.archived) store.put('project', metadata(p, { archived: false }));
                        }
                    }
                });
                return send(200, { changed: members.filter(b => !b.synthetic).length });
            }
            const compaction = route.match(/^\/api\/branches\/([^/]+)\/compaction$/);
            if (req.method === 'POST' && compaction) return send(200, store.setCompaction(compaction[1], body));
            const record = route.match(/^\/api\/branches\/([^/]+)\/records\/(\d+)$/);
            if (req.method === 'GET' && record) { const branch = store.get('branch', record[1]); assert(url.searchParams.get('head') === branch.head, 'History changed. Refresh before opening this record.', 409); const r = store.parsed(branch.head, branch.agent).records[Number(record[2]) - 1]; assert(r, 'Record not found.', 404); return send(200, { value: r.value, raw: r.raw }); }
            const detail = route.match(/^\/api\/branches\/([^/]+)$/);
            if (req.method === 'GET' && detail)
                return send(200, store.detail(detail[1]));
            if (req.method === 'POST' && route === '/api/projects')
                return send(201, store.moveItems({ itemIds: body.itemIds, projectName: body.name }));
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
                return send(400, { error: 'Start new sessions in Codex or Claude Code.' });
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
            if (req.method === 'POST' && route === '/api/collect') { const r = native.refreshLocal(); diagnostics.record('capture', { updated: r.updates.length, discovered: r.discovered, count: r.errors.length }); return send(200, r); }
            if (req.method === 'POST' && route === '/api/apply')
                return send(200, native.apply());
            if (req.method === 'POST' && route === '/api/recover')
                return send(200, native.recover(body.id));
            if (req.method === 'POST' && route === '/api/webdav') return send(200, await settings.verify(body));
            if (req.method === 'POST' && route === '/api/cloud/check') { await autoSync.checkCatalog(5 * 60 * 1000); return send(200, autoSync.status()); }
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
                if (c.kind === 'layout') {
                    assert(['local', 'remote'].includes(body.choice), 'Unknown conflict choice.');
                    const b = store.get('branch', c.local.id);
                    const chosen = store.get('layout', body.choice === 'remote' ? c.remote.layoutHead : b.layoutHead);
                    const layout = { ...chosen, id: id(), parent: b.layoutHead, mergeParents: [c.remote.layoutHead], createdAt: now() };
                    store.put('layout', layout);
                    store.put('branch', { ...b, layoutHead: layout.id });
                }
                else if (body.choice === 'remote') {
                    if (c.kind === 'organization') {
                        const b = store.get('branch', c.local.id);
                        store.put('branch', { ...b, nodeHead: c.remote.nodeHead, updatedAt: now() });
                    }
                    else if (c.kind === 'branch') {
                        store.edit(c.local.id, { name: c.remote.name, group: c.remote.group, archived: c.remote.archived, contextPolicy: c.remote.contextPolicy });
                        if (c.remote.archived)
                            native.setActive(c.local.id, null, false);
                    }
                    else {
                        const p = store.get('project', c.local.id);
                        store.put('project', metadata(p, { name: c.remote.name, description: c.remote.description, archived: c.remote.archived }));
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
            diagnostics.record('request-error', { id: requestId, code: typeof e.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(e.code) ? e.code : e instanceof TypeError ? 'TYPE_ERROR' : 'REQUEST_FAILED' });
            send(e.status || 400, { error: e.message, requestId });
        }
    });
    function configureCapture() {
        clearInterval(interval);
        const p = preferences(store);
        if (!p.localUpdateEnabled) return;
        interval = setInterval(() => {
            if (!autoSync.running && settings.job?.state !== 'running') {
                try { const start = performance.now(), r = native.refreshLocal();
                    if (r.updates.length || r.discovered || r.errors.length) diagnostics.record('capture', { updated: r.updates.length, discovered: r.discovered, count: r.errors.length, durationMs: Math.round(performance.now() - start) });
                } catch { diagnostics.record('capture-error', { code: 'capture_failed' }); }
            }
        }, p.localUpdateMinutes * 60000); interval.unref();
    }
    configureCapture();
    server.on('close', () => { clearInterval(interval); autoSync.close(); store.close(); });
    return { server, store, native, autoSync, diagnostics, settings };
}
