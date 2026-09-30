import { discardChanges } from './discard-changes.js';
import { refreshNativeClients } from './client-refresh.js';
import {stageTrash,stageTrashAsync,restoreTrash,expireTrash,cleanupLocal,isTrashed} from './trash.js';
import {nativeTrashCandidates,moveNativeToRecovery,deleteRecoveryCopies,restoreRecoveryCopies} from './trash-actions.js';
import os from 'node:os';
import { recordPreview } from './record-preview.js';
import { VERSION } from './version.js';
import { INBOX_ID, inboxProject } from './inbox.js';
import { GitSettings as Settings } from './git-settings.js';
import { preferences } from './preferences.js';
import { Intelligence } from './intelligence.js';
import {NativeContextSettings} from './native-context-settings.js';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { Diagnostics } from './diagnostics.js';
import { activationInfo } from './activation.js';
import { nodeActivation, groveTitle } from './node-activation.js';
import { prepareConversion, createConversion } from './conversion.js';
import { packGraph } from './graph-wire.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Store } from './store.js';
import { Native } from './native.js';
import { archiveNative } from './native-archive.js';
import { AutoSync } from './auto-sync.js';
import { metadata, treeMembers } from './organization.js';
import { isActive } from './workspace.js';
import { assert, atomic, json, text, now, id, hash } from './util.js';
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
export function createApp({ root, roots, guard, demo = false }) {
    const store = new Store(root), native = new Native(store, { roots, guard }), token = randomBytes(32).toString('hex');
    const webAssets = new Map(['index.html', 'app.js', 'library-view.js', 'session-drag.js', 'select.js', 'markdown.js', 'i18n.js', 'style.css'].map(file => [file, fs.readFileSync(path.join(webRoot, file))]));
    const configFile = path.join(root, 'git-sync.json');
    const diagnostics = new Diagnostics(root);
    const autoSync = new AutoSync(store, () => ({ ...json(configFile, {}), provider: 'git' }), null, { provider: 'git' });
    autoSync.diagnostics = diagnostics;
    if (store.local('localUpdateStarted') === null) store.local('localUpdateStarted', demo || store.instances().length > 0);
    if (store.local('syncStarted') === null) store.local('syncStarted', !!store.local('lastSync') || !!autoSync.status().lastCheck);
    autoSync.configureTimer();
    autoSync.beforeUpload = () => store.local('localUpdateStarted') ? captureLocal() : null;
    let capturePromise; let interval, nextCaptureAt = null, lastCaptureAt = null;
    const settings = new Settings(root, store, autoSync, configureCapture); settings.diagnostics = diagnostics;
    const contextSettings=new NativeContextSettings(root,native.roots);

    const management = () => new Map(store.collections().items.map(i => [i.id, hash(JSON.stringify([
        i.projectId ? store.get('project', i.projectId) : inboxProject(), i.sessionIds.map(id => { const b = store.get('branch', id); return [b.id, b.name, b.projectId, b.archived, b.parentId, b.forkEnd, b.nodeHead, b.layoutHead, b.contextPolicy, b.endpointName]; }),
        store.get('branch', i.id).layoutHead
    ]))]));
    const streams = new Set(); let updateOperation = null, trashOperation = null, trashPromise = null;
    let stopping = false, discardPromise = null, discardOperation = null, discardRequest = null;
    const instance = id();
    const operation = (kind, value) => { for (const res of streams) res.write('event: operation\ndata: ' + JSON.stringify({kind, ...value}) + '\n\n'); };
    autoSync.onOperation = value => operation('sync', {...value, status:autoSync.status()});
    const intelligence = new Intelligence(store, { onChange: id => autoSync.schedule([id]), onStatus: value => operation('intelligence', value), canApply: () => !capturePromise && !trashPromise && !discardPromise && !stopping });
    const timing = () => ({ discardOperation, intelligence: intelligence.status(), trashOperation, appVersion: VERSION, serverNow: Date.now(), stateVersion: diagnostics.startedAt + ':' + store.version + ':' + store.cloudVersion, update: { nextRunAt: nextCaptureAt, lastRunAt: lastCaptureAt, started: !!store.local('localUpdateStarted'), operation: updateOperation } });
    let expiryTimer;const configureExpiry=()=>{clearTimeout(expiryTimer);const entries=expireTrash(store),next=entries.filter(e=>!e.expired).map(e=>Date.parse(e.expiresAt)).sort((a,b)=>a-b)[0];if(next){expiryTimer=setTimeout(configureExpiry,Math.max(1000,Math.min(2147483647,next-Date.now())));expiryTimer.unref();}};configureExpiry();
    const trashSnapshot = () => ({ trashEntries:(store.local('trashEntries')||[]).filter(e=>!e.expired&&!e.restoredAt), trashNative:nativeTrashCandidates(store) });
    const snapshot = () => ({ ...autoSync.decorate(store.snapshot()), preferences: preferences(store), ...trashSnapshot() });
    const server = http.createServer(async (req, res) => {
        const started = performance.now(), requestId = id().slice(0, 8);
        const beforeManagement = req.method !== 'GET' && /^\/api\/(trees|move|manage|projects|branches|conflicts)(?:\/|$)/.test(req.url) ? management() : null;
        const send = (status, value, type = 'application/json') => { let output = type === 'application/json' ? JSON.stringify(value) : value; const compressed = Buffer.byteLength(output) > 262144 && /\bgzip\b/.test(req.headers['accept-encoding'] || ''); if (compressed) output = gzipSync(output, { level: 1 }); diagnostics.request(req.method, req.url.split('?')[0], status, performance.now() - started, requestId); res.writeHead(status, { ...(compressed ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}), 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" }); res.end(output); if (beforeManagement && status < 400 && !req.url.startsWith('/api/sync') && !['/api/collect', '/api/webdav'].includes(req.url)) {
            const changed = [...management()].filter(([id, value]) => beforeManagement.get(id) !== value).map(([id]) => id);
            if (changed.length) { autoSync.schedule(changed); intelligence.observe(); }
        } };
        try {
            const expected = `127.0.0.1:${server.address().port}`;
            assert(req.headers.host === expected, '请使用启动时显示的本地地址', 403);
            assert(!req.headers.origin || req.headers.origin === `http://${expected}`, '不允许跨站请求', 403);
            assert(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), '不允许跨站请求', 403);
            const url = new URL(req.url, `http://${expected}`), route = url.pathname;
            if (req.method === 'GET' && route === '/api/service') return send(200, { pid: process.pid, instance, stopping });
            if (req.method === 'GET' && ['/', '/app.js', '/library-view.js', '/session-drag.js', '/i18n.js', '/select.js', '/markdown.js', '/style.css'].includes(route)) {
                const file = route === '/' ? 'index.html' : route.slice(1);
                return send(200, webAssets.get(file), file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
            }
            if (req.method === 'GET' && route === '/api/bootstrap') {
                return send(200, { token, demo, ...snapshot(), ...timing(), roots: native.roots, cloud: autoSync.status(), lastSync: store.local('lastSync'), plan: native.plan() });
            }
            const supplied = Buffer.from(req.headers['x-grove-token'] || '');
            assert(supplied.length === token.length && timingSafeEqual(supplied, Buffer.from(token)), '本地访问凭证无效，请刷新页面', 403);
            if (req.method === 'POST' && route === '/api/service/stop') { send(202, { stopping: true }); setImmediate(() => app.onStop?.()); return; }
            assert(!stopping, 'Server is stopping.', 503);
            assert(req.method==='GET'||!discardPromise,'Wait for changes to finish reverting.',409);
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
                assert(!trashPromise, 'A Trash operation is in progress.', 409);
                assert(!capturePromise || route==='/api/collect', 'Local update in progress.', 409);
                assert(settings.job?.state !== 'running' || !/^\/api\/(sync|synchronize|settings|webdav)/.test(route), 'Settings migration in progress.', 409);
            }
            if (req.method === 'GET' && route === '/api/events') {
                res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.write(': connected\n\n'); streams.add(res); req.on('close',()=>streams.delete(res)); return;
            }
            if(req.method==='GET'&&route==='/api/directories'){
                let directory=url.searchParams.get('path')||os.homedir();
                if(!path.isAbsolute(directory)||!fs.existsSync(directory))directory=os.homedir();
                directory=await fs.promises.realpath(directory);assert((await fs.promises.stat(directory)).isDirectory(),'Choose a directory.');
                const entries=await fs.promises.readdir(directory,{withFileTypes:true});
                const folders=entries.filter(e=>e.isDirectory()&&!e.name.startsWith('.')).map(e=>({name:e.name,path:path.join(directory,e.name)})).sort((a,b)=>a.name.localeCompare(b.name));
                return send(200,{path:directory,parent:path.dirname(directory),home:os.homedir(),folders});
            }
            if (req.method === 'GET' && route === '/api/status') return send(200, { ...timing(), cloud: autoSync.status() });
            if (req.method === 'GET' && route === '/api/synchronize/pending') return send(200, { items: autoSync.pendingItems() });
            if(req.method==='POST'&&route==='/api/synchronize/discard'){
                if(discardRequest)return send(200,await discardRequest);
                const repository=autoSync.readConfig()?.url;
                discardOperation={id:id(),state:'running',phase:'Reading current changes',startedAt:Date.now()};
                const report=async progress=>{discardOperation={...discardOperation,...progress};operation('discard',discardOperation);await new Promise(r=>setImmediate(r));};
                discardRequest=(async()=>{
                    let acquired=false;
                    try{
                        if(autoSync.running||autoSync.pending||autoSync.migrating||capturePromise||trashPromise||settings.job?.state==='running')await report({phase:'Waiting for current operation'});
                        while(autoSync.running||autoSync.pending||autoSync.migrating||capturePromise||trashPromise||settings.job?.state==='running'){
                            assert(!stopping,'Server is stopping.',503);
                            const waiting=[autoSync.pending,capturePromise,trashPromise,settings.pending].filter(Boolean);
                            if(waiting.length)await Promise.allSettled(waiting);else await new Promise(r=>setTimeout(r,50));
                        }
                        assert(!stopping,'Server is stopping.',503);
                        assert(repository===autoSync.readConfig()?.url,'The sync repository changed while waiting. Current data was kept.',409);
                        autoSync.migrating=true;store.transferReaders=(store.transferReaders||0)+1;acquired=true;
                        discardPromise=discardChanges(store,autoSync.cloud,native,body.selections,{confirmation:body.confirmation,onProgress:report,deactivate:async branchIds=>{
                            const before=store.instances();
                            if(!demo&&!guard)await archiveNative(store,native,branchIds,{archiveBranches:false});
                            else{try{for(const id of branchIds)native.setActive(id,null,false);native.apply(branchIds);}catch(error){const current=store.instances();for(const i of current){const old=before.find(v=>v.id===i.id);i.desired=old?.desired||false;}store.local('instances',current);throw error;}}
                            await refreshNativeClients(native,before);
                        }});
                        const result=await discardPromise;const dirty=new Set(autoSync.cloud.dirtyIds());autoSync.queue=new Set([...autoSync.queue].filter(id=>dirty.has(id)));store.local('uploadQueue',[...autoSync.queue]);return result;
                    }catch(error){await report({state:'error',phase:error.message});throw error;}
                    finally{if(acquired){discardPromise=null;autoSync.migrating=false;store.transferReaders--;if(!store.transferReaders&&store.cleanupDeferred)cleanupLocal(store);autoSync.configureTimer();configureExpiry();intelligence.kick();}}
                })();
                try{return send(200,await discardRequest);}finally{discardRequest=null;}
            }

            if (req.method === 'POST' && route === '/api/synchronize/transfer') return send(202, autoSync.startTransfer(body.direction));
            if (req.method === 'GET' && route === '/api/trash') return send(200, trashSnapshot());
            if (req.method === 'POST' && route === '/api/synchronize/plan') return send(200, await autoSync.prepareSync());
            if (req.method === 'POST' && route === '/api/synchronize/start') return send(202, autoSync.startSync(body.planId, body.confirmed));
            if (req.method === 'GET' && route === '/api/state')
                return send(200, { ...snapshot(), ...timing(), cloud: autoSync.status(), discoveryError: store.local('discoveryError'), lastSync: store.local('lastSync'), plan: native.plan() });
            if (req.method === 'GET' && route === '/api/diagnostics') return send(200, { ...diagnostics.report(), git: { commit: autoSync.cloud.connection?.remote.head || null, progress: autoSync.status().operation?.progress || null }, fallbackMinutes: autoSync.status().fallbackMinutes });
            if (req.method === 'GET' && route === '/api/discover')
                return send(200, native.discover());
            if (req.method === 'GET' && ['/api/webdav', '/api/settings'].includes(route)) return send(200, { ...settings.status(), intelligence: intelligence.status(), context:contextSettings.status() });
            if (req.method === 'POST' && route === '/api/settings/context') return send(200,contextSettings.save(body));
            if (req.method === 'POST' && route === '/api/settings/intelligence') return send(200, await intelligence.save(body));
            if (req.method === 'POST' && route === '/api/intelligence/retry') return send(200, intelligence.retry());
            if (req.method === 'POST' && route === '/api/settings/verify') return send(200, await settings.verify(body));
            if (req.method === 'POST' && route === '/api/settings/confirm') return send(200, await settings.start(body));
            if (req.method === 'POST' && route === '/api/settings/recover') return send(200, await settings.recover());
            if (req.method === 'POST' && route === '/api/settings/timers') { const previous = preferences(store).showScheduledSessions, saved = settings.timers(body); if (saved.showScheduledSessions && !previous) await captureLocal(); return send(200, saved); }
            if (req.method === 'GET' && route === '/api/list') {
                const scope = url.searchParams.get('scope') || 'active:codex', query = url.searchParams.get('q') || '';
                // Browsing and search use the saved directory and local transcripts only.
                return send(200, autoSync.listing(scope, query));
            }
            const tree = route.match(/^\/api\/trees\/([^/]+)$/);
            if (req.method === 'GET' && tree) { await autoSync.openTree(tree[1], { check: url.searchParams.get('check') === '1' }); const graph = store.treeGraph(tree[1], url.searchParams.get('view') || 'in-use'); return send(200, req.headers['x-grove-graph'] === 'shared-messages-v1' ? store.memo('wire:' + graph.id + ':' + graph.view, () => packGraph(graph)) : graph); }
            if (req.method === 'POST' && tree) return send(200, store.organize(tree[1], body));
            if(req.method==='POST'&&route==='/api/trash'){
                const requestedTrees=body.itemIds||[];for(const id of requestedTrees)await autoSync.openTree(id);
                const archived=b=>b.archived||b.projectId&&store.get('project',b.projectId).archived;
                const activeAgent = /^active:(codex|claude)$/.exec(body.view || '')?.[1];
                const ids=requestedTrees.length?[...new Set(requestedTrees.flatMap(id=>treeMembers(store,id).filter(b=>!b.synthetic&&!isTrashed(store,b.id)&&(body.view==='archived'?archived(b):!archived(b))&&(!activeAgent||b.agent===activeAgent)).map(b=>b.id)))]:body.branchIds||[];
                assert(ids.length,'Select sessions first.');
                const treeIds=requestedTrees.filter(id=>treeMembers(store,id).filter(b=>!b.synthetic&&!isTrashed(store,b.id)).every(b=>ids.includes(b.id)));
                if(!requestedTrees.length){assert(ids.length===1,'Select one complete path.');const graph=store.treeGraph(ids[0],'all');assert(graph.version===body.version&&graph.nodes.some(n=>n.id===body.nodeId&&n.endBranchIds.includes(ids[0])),'Select a complete session endpoint.',409);}
                const selectedIds=new Set(requestedTrees.length?requestedTrees.flatMap(id=>treeMembers(store,id).filter(b=>!b.synthetic&&!isTrashed(store,b.id)).map(b=>b.id)):ids);
                assert(!store.instances().some(i=>selectedIds.has(i.branchId)&&isActive(i)),'Deactivate all active sessions in the selection before moving it to Trash.',409);
                const entry=await runTrash('trash',async report=>{
                    await report({phase:'Reading local changes',completed:0,total:null});native.collect();
                    assert(!store.instances().some(i=>selectedIds.has(i.branchId)&&isActive(i)),'Deactivate all active sessions in the selection before moving it to Trash.',409);
                    const entry=await stageTrashAsync(store,ids,treeIds,{onProgress:report});
                    const copies=store.instances().filter(i=>ids.includes(i.branchId)&&i.file&&fs.existsSync(i.file));
                    const cleanup=copies.length?await moveNativeToRecovery(store,native,copies.map(i=>i.id),{onProgress:report}):{blocked:[]};
                    await report({phase:'Removing unused local records',completed:0,total:null});cleanupLocal(store);
                    configureExpiry();autoSync.reconcileTimer();return {...entry,blocked:cleanup.blocked};
                });return send(202,entry);
            }
            if(req.method==='POST'&&route==='/api/trash/restore'){const result=restoreTrash(store,body.id);autoSync.schedule();return send(201,result);}
            if(req.method==='POST'&&route==='/api/trash/native'){
                const ids=body.instanceIds || nativeTrashCandidates(store).filter(i=>(body.branchIds||[]).includes(i.branchId)).map(i=>i.id);
                const result=await runTrash('recovery',report=>moveNativeToRecovery(store,native,ids,{onProgress:report}));configureExpiry();autoSync.schedule();return send(200,result);
            }
            if(req.method==='POST'&&route==='/api/trash/recovery'){
                assert(Array.isArray(body.ids)&&body.ids.length&&body.ids.every(id=>typeof id==='string'),'Select recovery copies.');
                assert(['restore','delete'].includes(body.action),'Choose Restore or Delete now.');
                const result=body.action==='restore'?restoreRecoveryCopies(store,body.ids):deleteRecoveryCopies(store,body.ids);
                configureExpiry();autoSync.schedule();return send(200,result);
            }
            if (req.method === 'POST' && route === '/api/move') {
                for (const id of body.itemIds || []) await autoSync.openTree(id, { check: true });
                if (body.projectId && body.projectId !== INBOX_ID && !store.all('project').some(p => p.id === body.projectId)) {
                    const p = autoSync.cloud.summaries().find(p => p.id === body.projectId); assert(p, 'Project not found.');
                    const { index, treeIds, indexAncestors, count, ...project } = p; store.put('project', project);
                }
                return send(200, store.moveItems(body));
            }
            if (req.method === 'POST' && route === '/api/activation-check') return send(200, activationInfo(store, native, body.branchId, body.cwd));
            if (req.method === 'POST' && ['/api/node-activation/check', '/api/node-activation/activate'].includes(route)) {
                const selected = nodeActivation(store, native, body), check = selected.preview;
                if (route.endsWith('/check')) return send(200, check);
                assert(check.complete, 'Select a node ending at a completed turn.');
                assert(body.contextAcknowledgement === check.fingerprint, 'Activation preview changed. Review it again.', 409);
                assert(typeof body.cwd === 'string' && path.isAbsolute(body.cwd) && fs.existsSync(body.cwd) && fs.statSync(body.cwd).isDirectory(), 'Choose an existing working directory.');
                let branch = selected.branch;
                if (check.createsContinuation) { branch = store.fork(branch.id, { name: branch.name.slice(0, 200), end: selected.end, revisionId: branch.head, nodeBoundary: selected.nodeBoundary }); branch = store.put('branch', { ...branch, activationNodeName: check.nodeName }); }
                const before = store.instances();
                try { native.setActive(branch.id, body.cwd, true, { nodeName: check.nodeName }); native.apply([branch.id]); }
                catch (e) { store.local('instances', before); if (check.createsContinuation) e.message = 'Continuation saved, but activation failed: ' + e.message; throw e; }
                autoSync.schedule([branch.id]); intelligence.observe();
                const clientRefresh=await refreshNativeClients(native,before);
                return send(201, { branch, clientRefresh, title: check.title, nodeId: check.createsContinuation ? 'empty-' + branch.id : selected.node.id });
            }
            if (req.method === 'POST' && ['/api/conversion-check', '/api/convert'].includes(route)) {
                const selected = body.nodeId ? nodeActivation(store, native, body) : null;
                if (selected) { assert(selected.end, 'Select a node ending at a completed turn.'); body.end = selected.end; }
                const prepared = prepareConversion(store, body.branchId, body);
                const projected = { context: { model: null, compactions: [], lastUsage: null }, messages: prepared.entries.map((e, i) => ({ ...e, line: i + 1 })), records: [], complete: true, errors: [], warnings: [] };
                const virtual = { get: () => ({ ...prepared.branch, agent: body.target, contextPolicy: null }), parsed: () => projected, instances: () => [] };
                const budget = activationInfo(virtual, native, body.branchId, body.cwd);
                if (route === '/api/conversion-check') return send(200, { ...prepared.preview, budget, title: groveTitle(prepared.branch.name, selected?.preview.nodeName || 'Pending') });
                assert(!budget.risk || body.contextAcknowledgement === budget.fingerprint, 'Review the context-length warning before activating.', 409);
                assert(typeof body.cwd === 'string' && path.isAbsolute(body.cwd) && fs.existsSync(body.cwd) && fs.statSync(body.cwd).isDirectory(), 'Choose an existing working directory.');
                const result = createConversion(store, body.branchId, body);
                const before=store.instances();
                try { native.setActive(result.branch.id, body.cwd, true, { nodeName: selected?.preview.nodeName || 'Pending' }); native.apply([result.branch.id]); }
                catch (e) { native.setActive(result.branch.id, null, false); throw Object.assign(new Error(`Conversion was saved in Grove but activation failed: ${e.message}`), { status: e.status || 409 }); }
                autoSync.schedule([result.branch.id]);
                result.clientRefresh=await refreshNativeClients(native,before);
                return send(201, result);
            }
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
                assert(body.projectId !== INBOX_ID, 'Select individual inbox sessions.');
                let members;
                if (body.projectId) members = store.all('branch').filter(b => b.projectId === store.get('project', body.projectId).id);
                else if (body.itemIds?.length) members = [...new Map(body.itemIds.flatMap(id => treeMembers(store, id)).map(b => [b.id, b])).values()];
                else members = (body.branchIds || []).map(id => store.get('branch', id));
                if (body.projectId || body.itemIds) members = members.filter(b => !isTrashed(store,b.id)&&(!b.excluded || b.background && preferences(store).showScheduledSessions));
                assert(members.length, 'Select sessions first.');
                assert(members.every(b=>!isTrashed(store,b.id)||b.trashDependency),'Restore from Trash as a new session.',410);
                assert(members.every(b => !b.excluded || b.background && preferences(store).showScheduledSessions), 'Agent-owned or empty records are not managed as sessions.');
                if (body.action === 'deactivate' && body.agent) members = members.filter(b => b.agent === body.agent && store.instances().some(i => i.branchId === b.id && isActive(i)));
                if (body.action === 'activate') {
                    assert(members.length === 1 && !members[0].synthetic, 'Select one native session to activate.');
                    assert(!body.agent || body.agent === members[0].agent, 'Cross-agent context conversion is not supported.');
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
                if (['archive','deactivate'].includes(body.action) && !demo && !guard) await archiveNative(store,native,members.filter(b=>!b.synthetic).map(b=>b.id),{archiveBranches:body.action==='archive'});
                else if (body.action !== 'restore') {
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
                    if (body.action === 'restore' && members.some(b => !b.projectId) && (body.destinationProjectId || body.projectName)) {
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
                const clientRefresh=await refreshNativeClients(native,before);
                return send(200, { changed: members.filter(b => !b.synthetic).length, clientRefresh });
            }
            const compaction = route.match(/^\/api\/branches\/([^/]+)\/compaction$/);
            if (req.method === 'POST' && compaction) return send(200, store.setCompaction(compaction[1], body));
            const record = route.match(/^\/api\/branches\/([^/]+)\/records\/(\d+)$/);
            if (req.method === 'GET' && record) { const branch = store.get('branch', record[1]); assert(url.searchParams.get('head') === branch.head, 'History changed. Refresh before opening this record.', 409); const ref=store.get('revision',branch.head).refs[Number(record[2])-1];assert(ref,'Record not found.',404);const raw=store.objectStatement.get(ref)?.body;assert(raw,'Record not found.',404);return send(200,recordPreview(JSON.parse(raw),Number(url.searchParams.get('offset')||0))); }
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
            if (req.method === 'POST' && route === '/api/collect') { store.local('localUpdateStarted', true); const r = await captureLocal(); return send(200, r); }
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
                return send(200, await autoSync.flush(body.direction || 'both', true));
            }
            if (req.method === 'POST' && route === '/api/conflicts/resolve') {
                const conflicts = store.local('conflicts') || [], c = conflicts[body.index];
                assert(c, '冲突不存在');
                if (c.kind === 'session') {
                    assert(['local', 'remote'].includes(body.choice), 'Unknown session choice.');
                    const current = store.get('branch', c.local.id), chosen = body.choice === 'remote' ? c.remote : current;
                    store.put('branch', metadata(current, { ...chosen, metaAncestors: [...new Set([...(chosen.metaAncestors || []), c.remote.metaVersion].filter(Boolean))] }));
                } else if (c.kind === 'layout') {
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
    async function runTrash(action, task) {
        assert(!trashPromise,'A Trash operation is in progress.',409);
        trashOperation={id:id(),action,state:'running',startedAt:Date.now()};
        let emittedAt=0,phaseStartedAt=Date.now();
        const report=async progress=>{const at=Date.now(),changed=trashOperation.progress?.phase!==progress.phase;if(changed&&trashOperation.progress)diagnostics.record('trash-phase',{phase:trashOperation.progress.phase,durationMs:at-phaseStartedAt});if(changed)phaseStartedAt=at;trashOperation={...trashOperation,progress};if(changed||progress.completed===progress.total||at-emittedAt>=100){operation('trash',trashOperation);emittedAt=at;}await new Promise(resolve=>setImmediate(resolve));};
        trashPromise=(async()=>{
            try {const result=await task(report);trashOperation={...trashOperation,state:result?.blocked?.length?'error':'success',error:result?.blocked?.map(e=>e.reason).join('\n')||null,finishedAt:Date.now()};return result;}
            catch(error){trashOperation={...trashOperation,state:'error',error:error.message,finishedAt:Date.now()};throw error;}
            finally{if(trashOperation.progress)diagnostics.record('trash-phase',{phase:trashOperation.progress.phase,durationMs:Date.now()-phaseStartedAt});operation('trash',trashOperation);}
        })();
        try{return await trashPromise;}finally{trashPromise=null;intelligence.kick();}
    }
    function captureLocal() {
        if(discardPromise)return discardPromise.catch(()=>{}).then(()=>captureLocal());
        if(trashPromise)return trashPromise.catch(()=>{}).then(()=>captureLocal());
        if(capturePromise) return capturePromise;
        capturePromise = performCapture().finally(()=>{capturePromise=null;intelligence.kick();}); return capturePromise;
    }
    async function performCapture() {
        const startedAt = Date.now(); updateOperation = { id: id(), state: 'running', startedAt }; operation('update', updateOperation);
        // Flush the operation event before synchronous native parsing starts.
        await new Promise(resolve => setImmediate(resolve));
        try {
            const start = performance.now(), r = native.refreshLocal(); lastCaptureAt = Date.now();
            diagnostics.record('capture', { updated: r.updates.length, discovered: r.discovered, count: r.errors.length, durationMs: Math.round(performance.now() - start) });
            for (const [phase, durationMs] of Object.entries(r.timings || {})) diagnostics.record('capture-phase', { phase, durationMs });
            intelligence.observe();
            updateOperation = { ...updateOperation, state: r.errors.length ? 'error' : 'success', finishedAt: Date.now() };
            return r;
        } catch(e) { updateOperation = { ...updateOperation, state: 'error', finishedAt: Date.now() }; throw e; }
        finally { autoSync.reconcileTimer(); configureCapture(); operation('update', {...updateOperation,status:{nextRunAt:nextCaptureAt,lastRunAt:lastCaptureAt,started:true}}); }
    }
    function configureCapture() {
        clearTimeout(interval); nextCaptureAt = null;
        const p = preferences(store); if (stopping || !p.localUpdateEnabled || !store.local('localUpdateStarted')) return;
        nextCaptureAt = Date.now() + p.localUpdateMinutes * 60000;
        interval = setTimeout(async () => {
            try { if (settings.job?.state !== 'running') await captureLocal(); else configureCapture(); }
            catch { diagnostics.record('capture-error', { code: 'capture_failed' }); configureCapture(); }
        }, p.localUpdateMinutes * 60000); interval.unref();
    }
    configureCapture();
    server.on('close', () => { clearInterval(interval);clearTimeout(expiryTimer); autoSync.close(); store.close(); });
    const app = { server, store, native, autoSync, diagnostics, settings, intelligence, token, instance, quiesce() {
        stopping = true; intelligence.close(); clearTimeout(interval);clearTimeout(expiryTimer); autoSync.closed = true;
        clearTimeout(autoSync.timer); clearTimeout(autoSync.retryTimer); clearTimeout(autoSync.interval);
        if (settings.job?.state !== 'running') autoSync.cloud.connection?.dav.controller?.abort(new Error('Server is stopping.'));
    }, close(callback) {
        app.quiesce();
        for(const res of streams)res.end(); streams.clear();
        if(capturePromise||trashPromise||intelligence.pending||discardRequest)Promise.allSettled([capturePromise,trashPromise,intelligence.pending,discardRequest]).finally(()=>server.close(callback)); else server.close(callback);
    } };
    return app;
}
