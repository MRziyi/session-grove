import {installInlineNames} from './inline-name.js';
import { installSessionDrag } from './session-drag.js';
import { graphLayout, pathCamera, foldedItems, pendingLabels, projectGroups, selectRange, inactiveProject, olderProject, transferStages } from './library-view.js';
import { markdown } from './markdown.js';
import { enhanceSelect } from './select.js';
import { t, locale, setLocale, errorText } from './i18n.js';
const PROJECTS = 'projects';
const INBOX = '00000000-0000-4000-8000-000000000001';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
    codex: '<path d="m4 6 6 6-6 6m9 0h7"/>',
    claude: '<path fill="currentColor" stroke="none" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>',
    studio: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M4 10h16M6 14h2m2 0h2"/><circle cx="18" cy="14" r=".5"/>',
    download: '<path class="transfer-arrow" d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v4h16v-4"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>',
    desktop: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-5 0h10"/>',
    laptop: '<path d="M5 4h14v12H5ZM2 20l3-4h14l3 4Z"/>',
    windows: '<path d="M3 5l8-1v8H3Zm10-1 8-1v9h-8ZM3 14h8v7l-8-1Zm10 0h8v9l-8-2Z"/>',
    website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18Z"/>',
    github: '<path d="M9 19c-4 1-4-2-5-2m10 5v-3.9a3.4 3.4 0 0 0-1-2.7c3.3-.4 6.7-1.6 6.7-7.3a5.7 5.7 0 0 0-1.5-4c.1-1 .1-2.1-.5-3.1 0 0-1.2-.4-4 1.5a13.4 13.4 0 0 0-7 0C4.9.6 3.7 1 3.7 1c-.6 1-.6 2.1-.5 3.1a5.7 5.7 0 0 0-1.5 4c0 5.7 3.4 6.9 6.7 7.3a3.4 3.4 0 0 0-1 2.7V22"/>',
    upload: '<path class="transfer-arrow" d="M12 16V3m-4 4 4-4 4 4"/><path d="M4 17v4h16v-4"/>',
    sync: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
    refresh: '<path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    session: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    tree: '<rect x="9" y="2" width="6" height="5" rx="1"/><path d="M12 7v5M5 16v-4h14v4"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="white"/><circle cx="15" cy="17" r="3" fill="white"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
    cloud: '<path d="M6 18h12a4 4 0 0 0 .6-8A7 7 0 0 0 5.2 8.4 5 5 0 0 0 6 18Z"/>',
    source: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.session}</svg>`;
const palette = {
    'color-0': ['#4d86bb', '#e7f1fa'], 'color-1': ['#4c987a', '#e6f3ed'], 'color-2': ['#7288c5', '#edf0fc'],
    'color-3': ['#529a9e', '#e6f3f3'], 'color-4': ['#678c65', '#edf4e7'], 'color-5': ['#637eab', '#eaf0f9'], 'color-6': ['#578c8b', '#e5f1ee'],
    'pending-0': ['#576b85', '#566b852b'], 'pending-1': ['#726486', '#7161842b'], 'pending-2': ['#526f73', '#536f732b'], 'pending-3': ['#7c6979', '#7c69792b']
};
const style = n => { const [tone, tint] = palette[n.color]; return `--tone:${tone};--tint:${tint}`; };
const state = { data: null, token: '', roots: {}, scope: 'active:codex', list: { items: [] }, query: '', selected: new Set(), tree: null, branchId: null, nodeId: null, compactionId: null, chats: new Set(), rangeStart: null, rangeEnd: null, expandedGroups: new Set(), expandedProjects: new Set(), projectFocus: null, expanded: new Set() };
let clockTimer = null, modalVersion = 0;
const operations = {}, operationTimers = {}, seenOperations={};
let activityGroups=[];
function showOperation(kind, value) {
    if(kind==='discard'){if(state.pendingDiscard){if(value.phase&&!state.pendingDiscard.steps.includes(value.phase))state.pendingDiscard.steps.push(value.phase);renderDiscardProgress();}showOperation('trash',{...value,action:'discard',progress:{phase:value.phase,completed:value.completed,total:value.total,detail:value.detail},state:value.state==='confirmation'?'success':value.state,finishedAt:value.state!=='running'?Date.now():undefined});return;}
    if(kind==='intelligence'){if(state.data)state.data.intelligence=value;renderCloudStatus();return;}
    const signature=value.id+':'+value.state+':'+JSON.stringify(value.progress||null); if(seenOperations[kind]===signature)return;seenOperations[kind]=signature;
    if (value.state==='success' && value.finishedAt && Date.now() - value.finishedAt > 3500) { if(kind==='trash'){delete operations.trash;if(state.data)state.data.trashOperation=value;renderCloudStatus();} return; }
    operations[kind] = value;
    if(value.status && state.data){ if(kind==='sync')state.data.cloud=value.status;else state.data.update={...state.data.update,...value.status}; }
    clearTimeout(operationTimers[kind]);
    if (value.state === 'success') operationTimers[kind] = setTimeout(() => { delete operations[kind]; renderCloudStatus(); }, 3500);
    renderCloudStatus();
}
let eventController;
async function watchOperations() {
    for (;;) {
        if(document.hidden)await new Promise(resolve=>{const visible=()=>{if(!document.hidden){document.removeEventListener('visibilitychange',visible);resolve();}};document.addEventListener('visibilitychange',visible);});
        try {
            eventController=new AbortController();
            const response = await fetch('/api/events', {headers:{'X-Grove-Token':state.token},signal:eventController.signal}); if(!response.ok) { await api('/status'); throw new Error('Reconnect event stream'); }
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader(); let buffer='';
            for (;;) { const {value,done}=await reader.read(); if(done)break; buffer+=value; let end;
                while((end=buffer.indexOf('\n\n'))!==-1){const message=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=message.split('\n').find(l=>l.startsWith('data: '));if(data){const value=JSON.parse(data.slice(6));if(value.kind!=='open'||operations.open?.id===value.id&&operations.open.state==='running')showOperation(value.kind,value);}}
            }
        } catch {}
        await new Promise(resolve=>setTimeout(resolve,5000));
    }
}
let submitAction, toastTimer, searchTimer, requestId = 0, working = false, opening = false, openController;
const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
function cancelOpening(){openController?.abort();openController=null;opening=false;delete operations.open;clearTimeout(operationTimers.open);$('#main').removeAttribute('aria-busy');$$('[data-loading]').forEach(el=>el.removeAttribute('data-loading'));renderCloudStatus();}
const camera = { x: 0, y: 0, zoom: 1, width: 0, height: 0, rootX: 0, newView: true };
const compactNumber = n => new Intl.NumberFormat(locale() === 'zh' ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const tokenLabel = n => t('≈ {count} tokens', { count: compactNumber(n.tokens?.recordedEstimate ?? n.tokens?.estimate ?? 0) });
const cloudMark = item => {
    const badge = (kind, glyph, label) => `<span class="cloud-mark session-state ${kind}" title="${esc(t(label))}" aria-label="${esc(t(label))}">${glyph}</span>`;
    return ''
        + (item.sessions?.some(s => s.active) ? badge('active-state', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/><path d="m10 8 6 4-6 4Z" fill="white"/></svg>', 'Active on this device') : '')
        + (item.cloudState === 'local' ? badge('modified-state', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 10-10 4 4-10 10-5 1Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>', state.data?.cloud.configured?'Local changes waiting to push':'Saved on this computer') : '');
};

const date = value => value ? new Date(value).toLocaleString(locale() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('Never');
const currentProject = () => state.data.projects.find(p => p.id === state.scope);
const route = () => state.tree?.paths.find(p => p.branchId === state.branchId);
const selectedNode = () => state.tree?.nodes.find(n => n.id === state.nodeId);
let labeledTree, nodeLabels;
const nodeName = n => { if(labeledTree!==state.tree){labeledTree=state.tree;nodeLabels=pendingLabels(state.tree.nodes);}return n.name||`${t('Pending')} ${nodeLabels.get(n.id)}`; };
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 6000); }
async function api(path, method = 'GET', body, retried = false, options = {}) {
    let r;
    try { r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Grove-Token': state.token, 'X-Grove-Graph': 'shared-messages-v1',...(options.openId?{'X-Grove-Open-Id':options.openId}:{}) },signal:options.signal, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch (e) { if(e.name==='AbortError')throw e;state.connected = false; if (state.data) renderCloudStatus(); throw e; }
    await options.onStage?.('Receiving session history');
    const data = await r.json();
    options.signal?.throwIfAborted();
    if (r.status === 403 && data.error === '本地访问凭证无效，请刷新页面' && !retried) {
        const boot = await (await fetch('/api/bootstrap')).json(); state.token = boot.token;
        return api(path, method, body, true, options);
    }
    state.connected = r.status !== 503;
    if (!r.ok) throw new Error(errorText(data.error) + (data.requestId ? ` [${data.requestId}]` : ''));
    if (data.format === 'shared-messages-v1') { await options.onStage?.('Preparing conversation');for (const [index,p] of data.paths.entries()){p.messages = p.messages.map(m => ({ ...data.messagePool[m.ref], line: m.line }));if(options.openId&&index%8===7){await nextPaint();options.signal?.throwIfAborted();}}delete data.messagePool;delete data.format; }
    return data;
}
function modal(title, html, action, label = 'Save') {
    modalVersion++;
    $$('[data-modal-action]').forEach(el=>el.remove());
    $('#dialog').dataset.kind = ({About:'about',Settings:'settings',Information:'information'})[title] || 'normal'; $('#dialog-title').textContent = t(title); $('#dialog-content').innerHTML = html; $('#dialog-error').textContent = '';
    $('.dialog-actions').hidden = !action;
    $('#dialog-submit').textContent = t(label); $('#dialog-submit').hidden = !action; $('#dialog-submit').disabled = false;
    $('#dialog-cancel').textContent = t(action ? 'Cancel' : 'Close'); submitAction = action;
    if (!$('#dialog').open) $('#dialog').showModal();
}
const field = (label, name, value = '', type = 'text') => `<label class="field">${t(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${type === 'text' ? 'maxlength="200"' : ''}></label>`;
let outsideDialog = null;
const outside = (dialog, event) => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
document.addEventListener('pointerdown', event => { outsideDialog = event.target instanceof HTMLDialogElement && outside(event.target,event) ? event.target : null; });
document.addEventListener('click', event => { if (outsideDialog?.open && event.target === outsideDialog && outside(outsideDialog,event)) outsideDialog.close(); outsideDialog = null; });
$('#dialog-close').onclick = $('#dialog-cancel').onclick = () => $('#dialog').close();
$('#dialog-form').onsubmit = async e => {
    e.preventDefault(); if (!submitAction || working) return;
    working = true; $('#dialog-submit').disabled = true; renderCloudStatus();
    try { const complete = await submitAction(new FormData(e.target)); if (complete === false) return; $('#dialog').close(); await refresh(); }
    catch (e) { $('#dialog-error').textContent = e.message; }
    finally { working = false; $('#dialog-submit').disabled = false; renderCloudStatus(); }
};
async function run(fn, activity = null) {
    if (working) return; working = true; state.uiBusy = activity; renderCloudStatus();
    if(activity) showOperation(activity,{id:'local-'+Date.now(),state:'running'});
    try { await fn(); await refresh(); if(activity && operations[activity]?.state!=='error')showOperation(activity,{id:'local-'+Date.now(),state:'success',finishedAt:Date.now()}); } catch (e) { if(activity)showOperation(activity,{id:'local-'+Date.now(),state:'error',finishedAt:Date.now()}); toast(e.message); } finally { working = false; state.uiBusy = null; renderCloudStatus(); }
}
function actionDisabled(el) { return state.connected === false || working || opening; }
function button(id, label, fn) { const el = $(id); if (el) { el.textContent = t(label); el.onclick = fn; el.disabled = actionDisabled(el); } }
function translateBanner() {
    for (const [id, glyph, label] of [['sync', 'download', 'Pull'], ['upload', 'upload', 'Push'], ['collect', 'refresh', 'Update'], ['settings', 'settings', 'Settings']]) {
        const el = $('#' + id); el.dataset.glyph= glyph; el.innerHTML = `${icon(glyph)}<span class="button-label">${t(label)}</span>${['sync','upload'].includes(id)?'<span class="button-check" aria-hidden="true">✓</span>':''}`; el.title = t(label); el.setAttribute('aria-label', t(label));
    }
    $('#language-toggle').textContent=locale()==='zh'?'中':'En';$('#language-toggle').title=locale()==='zh'?'English':'中文';
    $('#about').textContent = t('About'); $('#information').textContent='ⓘ';$('#information').setAttribute('aria-label',t('Information'));$('#information').title=t('Information');
    $('#search-icon').innerHTML = icon('search'); $('#search').placeholder = t('Search title or content…'); $('#search').setAttribute('aria-label', t('Search title or content…'));
    $('#back').innerHTML = icon('back'); $('#back').title = t('Back to list'); $('#back').setAttribute('aria-label', t('Back to list'));
    $('#source').innerHTML = icon('source')+'<span>'+t('Source')+'</span>'; $('#source').title = t('Source & revisions'); $('#source').setAttribute('aria-label', t('Source & revisions'));
    $('#transcripts-title').textContent = t('Transcripts'); $('#graph-title').textContent = t('Graph'); $('#graph-reset').textContent = t('Reset view'); $('#zoom-in').title = t('Zoom in'); $('#zoom-out').title = t('Zoom out');
    $('#graph-fit').textContent = t('Fit tree');$('#graph-fit-path').textContent=t('Fit path');
}
function editableName(kind,id,name,css='') {
    return `<span class="editable-name ${css}" data-name-kind="${kind}" data-name-id="${esc(id)}">${esc(name)}</span>`;
}
function projectName(id,name){const project=state.data.projects.find(p=>p.id===id);return project&&!project.builtin&&id!==INBOX?editableName('project',id,name):esc(name);}
function listedSession(item){return item.sessions.find(s=>s.id===item.id)||item.sessions[0];}
function renderNavigation() {
    const d = state.data, directoryScroll = $('.project-directory-scroll')?.scrollTop || 0;
    const selectedScope = state.scope === PROJECTS ? state.projectFocus : state.scope;
    const entry = (scope, name, count, css = '') => `<button class="nav-entry ${css} ${selectedScope === scope ? 'selected' : ''}" data-scope="${esc(scope)}" ${selectedScope === scope ? 'aria-current="page"' : ''}><span class="nav-name">${state.data.projects.some(p=>p.id===scope)?projectName(scope,name):esc(name)}</span><span class="count">${count}</span></button>`;
    const directoryGroups=projectGroups(d.items.filter(i=>!i.archived).map(i=>({...i,updatedAt:i.sessions.filter(s=>!s.archived).map(s=>s.updatedAt).sort().at(-1)||i.updatedAt})), d.projects);
    const projectTimes=new Map(directoryGroups.map(g=>[g.id,g.updatedAt])),olderIds=new Set(directoryGroups.filter(g=>isOlder(g.items)).map(g=>g.id));
    const projects = d.projects.filter(p => !p.archived);
    const archivedProjects = d.projects.filter(p => p.archived && (d.items.some(i => i.projectId === p.id) || p.count>0));
    const archivedSessions = d.items.filter(i => !archivedProjects.some(p => p.id === i.projectId)).reduce((n, i) => n + i.sessions.filter(s => s.archived).length, 0);
    const clientArchiveCount=new Set([...(d.trashNative||[]).filter(i=>i.clientArchived&&(!i.background||d.preferences?.showScheduledSessions)).map(i=>i.branchId),...d.items.flatMap(i=>i.sessions.filter(s=>s.archived||archivedProjects.some(p=>p.id===i.projectId)).map(s=>s.id))]).size;
    const directory = rows => rows.sort((a,b) => (projectTimes.get(b.id)||'').localeCompare(projectTimes.get(a.id)||'') || a.name.localeCompare(b.name)).map(p => entry(p.id, p.builtin ? t('Ungrouped') : p.name==='Scheduled & background'?t(p.name):p.name, Math.max(p.count || 0, d.items.filter(i => i.projectId === p.id && !i.archived).length))).join('');
    const recent = projects.filter(p=>!olderIds.has(p.id)), older = projects.filter(p=>olderIds.has(p.id));
    $('#navigation').innerHTML = `<section class="nav-group"><h2 class="nav-label">${t('Current Active')}</h2>${entry('active:codex', 'Codex', d.activeCounts.codex, 'codex')}${entry('active:claude', 'Claude', d.activeCounts.claude, 'claude')}</section><section class="nav-group project-directory"><h2 class="nav-label">${t('Projects')}</h2><div class="project-directory-scroll">${directory(recent)}${older.length?olderToggle(older.length)+(state.olderProjects?directory(older):''):''}</div></section><section class="nav-group"><h2 class="nav-label">${t('Trash')}</h2>${clientArchiveCount?entry('archived',t('Client archive'),clientArchiveCount):''}${entry('trash',t('Trash'),(d.trashEntries||[]).filter(e=>!e.restoredAt&&!e.expired).length)}</section>`;
    $('.project-directory-scroll').scrollTop = directoryScroll;
    $$('[data-scope]').forEach(el => el.onclick = () => navigate(el.dataset.scope));
    bindOlderProjects();
    renderCloudStatus();
}

const pendingSelection=new Map(),conflictSelection=new Map();
let pendingTimer, pendingFetch, pendingTicket = 0, completionTimer, fillOperation = null, fillState = {pull:0,push:0};
const bytesLabel = bytes => bytes < 1024 ? `${bytes || 0} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
function positionSyncPanel(panel, anchor) {
    const rect = anchor.getBoundingClientRect(), width = Math.min(panel.dataset.mode==='conflicts'?480:panel.id==='pending-uploads'?380:420, innerWidth - 20), top = Math.min(Math.max(rect.bottom, $('.banner').getBoundingClientRect().bottom) + (panel.id==='pending-uploads'?0:8), innerHeight - 80);
    Object.assign(panel.style, { width: width + 'px', left: Math.max(10, Math.min(rect.right - width, innerWidth - width - 10)) + 'px', top: top + 'px', maxHeight: Math.max(60, innerHeight - top - 12) + 'px' });
}
function showSyncPanel(panel, anchor) { panel.hidden = false; panel.showPopover?.(); positionSyncPanel(panel, anchor); }
function hideSyncPanel(panel) { panel.hidePopover?.(); panel.hidden = true; }
const transferPhaseNames={'Fetching Git changes':'Checking for updates','Importing session from Git cache':'Updating local sessions','Pulling sessions':'Updating local sessions','Preparing Git commit':'Preparing changes','Pushing Git commit':'Sending changes','Receiving objects':'Receiving changes','Writing objects':'Sending changes','Counting objects':'Counting changes','Compressing objects':'Compressing changes','Resolving deltas':'Applying differences','Downloading records':'Pulling changes','Uploading records':'Pushing changes','Applying downloaded changes':'Updating sessions','Updating downloaded sessions':'Updating sessions','Checking cloud directory':'Checking for changes','Reading cloud session manifests':'Checking shared history','Publishing project indexes':'Saving changes','Publishing cloud directory':'Finishing push','Download complete':'Pull complete','Preparing upload snapshot':'Preparing changes to push','Preparing shared history':'Preparing remaining sessions','Reclaiming cloud space':'Cleaning up removed sessions'};

function renderIntelligence(){
    const value=state.data?.intelligence,button=$('#smart-status');if(!button)return;
    button.hidden=!value?.running&&!value?.error&&!value?.pending;
    const phase=t(value?.phase||'Smart organization queued');
    button.textContent=t(value?.error?'Smart organization needs attention':value?.phase||'Smart organization queued');
    button.title=value?.error?[value.current,errorText(value.error)].filter(Boolean).join(' · '):[value?.current,value?.pending?t('{count} remaining',{count:value.pending}):''].filter(Boolean).join(' · ');
    button.classList.toggle('has-error',!!value?.error);button.onclick=()=>settings();
    const detail=$('#intelligence-status');if(detail)detail.textContent=value?.error?[t('Smart organization needs attention'),value.current,errorText(value.error)].filter(Boolean).join(' · '):value?.pending||value?.running?[phase,value.current,value.activeRequests?t('{count} active',{count:value.activeRequests}):'',t('{count} remaining',{count:value.pending})].filter(Boolean).join(' · '):value?.waitingForEvidence?t('{count} sessions are waiting for their own first request and reply.',{count:value.waitingForEvidence}):'';
    if($('#retry-intelligence'))$('#retry-intelligence').hidden=!value?.error;
}

function renderCloudStatus(){
    const d=state.data;if(!d)return;
    if(!d.conflicts?.length&&!d.cloud.error&&!d.cloud.operation&&operations.sync?.state==='error'&&/Resolve sync conflicts before (uploading|pushing)\./.test(operations.sync.error||'')){delete operations.sync;delete seenOperations.sync;state.syncOperation=null;}
    const syncReady=d.cloud.configured&&d.cloud.unlocked;
    const setup=$('#sync-setup');setup.hidden=!!syncReady;setup.querySelector('p').textContent=t('Sync is optional. Connect a private Git repository in Settings to use Pull and Push.');setup.querySelector('button').textContent=t('Set up sync');setup.querySelector('button').onclick=()=>settings({focusSync:true});
    const offline=state.connected===false, operation=d.cloud.operation || operations.sync, busy=operation?.state==='running'||['syncing','migrating'].includes(d.cloud.phase), step=operation?.step || 'pull';
    const phase=operation?.progress?.phase;
    $('#cloud-status').textContent=t(offline?'Service disconnected':!syncReady?'Sync not connected':busy?(transferPhaseNames[phase] || phase || (step==='pull'?'Pulling changes':'Pushing changes')):d.cloud.needsReview&&operation?.state==='error'?'Review sync':operation?.state==='error'?'Sync failed':d.cloud.dirty?'Local changes':d.cloud.started?'Up to date':'Ready to sync');
    $('#sync-details').classList.toggle('has-error',operation?.state==='error');
    $('#sync-details').title=operation?.progress?.detail || '';
    const stages=transferStages(operation), appearance={running:'running',complete:'success',failed:'error',paused:'paused',pending:''};
    $('#sync').dataset.operation=appearance[stages.pull]; $('#upload').dataset.operation=appearance[stages.push];
    $('#upload').classList.toggle('has-pending',!!d.cloud.dirty&&!!syncReady);
    if (!busy && d.cloud.dirty && stages.push === 'complete') $('#upload').dataset.operation = '';
    $('#upload').setAttribute('aria-label',t(syncReady&&d.cloud.dirty?'Push · local changes waiting':'Push'));
    for(const id of ['sync','upload']) { $('#'+id).disabled=!syncReady||offline||busy||!!state.syncPreparing; $('#'+id).setAttribute('aria-busy',String(busy&&(id==='sync'?step==='pull':step==='push'))); }
    const updating=operations.update?.state==='running'||state.uiBusy==='update';$('#collect').dataset.operation=updating?'running':'';$('#collect').disabled=offline||working||updating;
    $('#collect .button-label').textContent=t(updating?'Updating…':'Update');
    $$('.actions button,button[data-compaction],[data-trash-restore],[data-trash-native]').forEach(el=>el.disabled=actionDisabled(el));
    renderTransfer();renderCountdowns();renderTrashProgress();renderIntelligence();
    for(const el of $$('[data-guide-update]'))el.disabled=offline||working||updating;
    if(!syncReady){hideSyncPanel($('#pending-uploads'));$('#push-zone').tabIndex=-1;$('#cloud-status').textContent=t(offline?'Service disconnected':'Sync not connected');}else $('#push-zone').tabIndex=0;
    const ticking=!document.hidden&&!offline&&(d.update?.nextRunAt||d.cloud?.nextRunAt||busy);
    if(ticking&&!clockTimer)clockTimer=setInterval(()=>{renderCountdowns();renderTransfer();},1000);if(!ticking&&clockTimer){clearInterval(clockTimer);clockTimer=null;}
}
// The fill communicates workflow stages; the number beside it is the measured
// current phase percentage. Unknown work remains animated, never a fake ETA.
function renderTransfer() {
    const cloud=state.data.cloud, op=cloud.operation||operations.sync, p=op?.progress;
    const running=op?.state==='running', step=op?.step || 'pull', stages=transferStages(op);
    if (fillOperation!==op?.id) { fillOperation=op?.id;fillState={pull:0,push:0}; }
    const measurement=step==='pull' && /session/i.test(p?.phase || '') && op?.stageProgress?.total>0 ? op.stageProgress : p;
    const fraction=measurement?.total>0?Math.min(1,(measurement.completed||0)/measurement.total):null;
    const sequences=step==='pull'
        ? {'Receiving objects':[0,.65],'Resolving deltas':[.65,.75],'Updating project lists':[.75,.8],'Updating downloaded sessions':[.8,.99],'Pulling sessions':[.8,.99],'Importing session from Git cache':[.8,.99]}
        : {'Preparing Git commit':[0,.2],'Counting objects':[.2,.25],'Compressing objects':[.25,.4],'Writing objects':[.4,.95],'Resolving deltas':[.95,.99]};
    if (running && sequences[p?.phase] && fraction!==null) {
        const [start,end]=sequences[p.phase];
        const amount=step==='pull' && op.stageProgress?.total>0 && /session/i.test(p.phase)?op.stageProgress.completed/op.stageProgress.total:fraction;
        fillState[step]=Math.max(fillState[step],start+(end-start)*amount);
    }
    const recent=op?.state==='success' && Date.now()-(op.finishedAt||0)<2400;
    for (const [key,id] of [['pull','sync'],['push','upload']]) {
        const el=$('#'+id), complete=stages[key]==='complete', dirty=key==='push'&&cloud.dirty&&!running;
        if (complete) fillState[key]=1;
        el.style.setProperty('--transfer-fill',String((running||recent)&&!dirty?fillState[key]:0));
        el.classList.toggle('transfer-unknown',running&&step===key&&fraction===null&&fillState[key]===0);
        if (complete&&!running&&(!recent||dirty)) el.dataset.operation='';
    }
    clearTimeout(completionTimer);
    if (recent) completionTimer=setTimeout(()=>{if(state.data)renderCloudStatus();},Math.max(20,2420-(Date.now()-op.finishedAt)));
    const metrics=[];
    if(running&&fraction!==null)metrics.push(Math.floor(fraction*100)+'%');
    if(running&&p?.rateBytesPerSecond>0)metrics.push(bytesLabel(p.rateBytesPerSecond)+'/s');
    if(running&&p?.etaSeconds>0)metrics.push(t('This stage: about {time} left',{time:Math.floor(p.etaSeconds/60)+':'+String(p.etaSeconds%60).padStart(2,'0')}));
    $('#sync-substatus').textContent=metrics.join(' · ');
    const hasConflicts=!!state.data?.conflicts?.length,error=hasConflicts?t('Resolve sync conflicts before uploading.'):op?.state==='error'?op.error:null,box=$('#sync-error');
    box.querySelector('summary').onclick=hasConflicts?event=>{event.preventDefault();showPendingUploads(true);}:null;
    box.hidden=!error;if(hasConflicts)box.open=false;
    if(error){box.querySelector('summary').textContent=error.length>100?error.slice(0,100)+'…':error;box.querySelector('div').textContent=hasConflicts?'':error;}
    else box.open=false;
    if(!running&&op?.state==='success'&&op.direction==='pull'&&op.summary?.unchanged&&!cloud.dirty)$('#cloud-status').textContent=t('Already up to date');
    if(state.syncOperation&&cloud.manualOperation?.id===state.syncOperation&&cloud.manualOperation.state!=='running'){
        const done=cloud.manualOperation;state.syncOperation=null;
        toast(t(done.state==='error'?'Sync failed':done.direction==='pull'?(done.summary?.unchanged?'Already up to date':'Pull complete'):'Push complete'));
        if(!$('#dialog').open&&!working&&!inlineNames.editing)queueMicrotask(()=>refresh().catch(e=>toast(e.message)));
    }
}
function renderTrashProgress() {
    const op=[operations.open,operations.trash||state.data?.trashOperation].filter(value=>value&&state.dismissedTask!==value.id&&!(value.state==='success'&&Date.now()-(value.finishedAt||0)>3500)).sort((a,b)=>Number(b.state==='running')-Number(a.state==='running')||(b.startedAt||b.finishedAt||0)-(a.startedAt||a.finishedAt||0))[0],box=$('#trash-progress');
    box.hidden=!op||state.dismissedTask===op.id||op.state==='success'&&Date.now()-(op.finishedAt||0)>3500;
    if(box.hidden){box.hidePopover?.();return;}
    if(box.showPopover&&!box.matches(':popover-open'))box.showPopover();
    const p=op.progress||{},total=p.total,count=p.completed||0;
    box.innerHTML=`<strong>${t(({resolve:'Resolve conflicts',open:'Open session',recovery:'Move to recovery',restore:'Restore to Projects',delete:'Delete recovery copies',activate:'Activate',deactivate:'Deactivate',archive:'Client archive',convert:'Activate as',discard:'Discard'})[op.action]||'Move to Trash')}</strong>${op.state==='error'?`<button type="button" data-dismiss-task aria-label="${t('Close')}">×</button>`:''}<div>${esc(t(op.state==='error'?op.error:op.state==='success'?'Complete':p.phase||'Checking selection'))}</div>${p.detail?`<small class="task-detail">${esc(p.detail)}</small>`:''}${op.state==='running'?`<progress ${total>0?`max="${total}" value="${count}"`:''}></progress>${total>0?`<small>${count} / ${total}</small>`:''}`:''}`;
    const dismiss=box.querySelector('[data-dismiss-task]');if(dismiss)dismiss.onclick=()=>{state.dismissedTask=op.id;renderTrashProgress();};
}
async function trashRequest(path,body,action) {
    showOperation('trash',{id:'pending-'+Date.now(),action,state:'running',startedAt:Date.now(),progress:{phase:'Checking selection'}});
    try {const result=await api(path,'POST',body);if(operations.trash?.state==='running')showOperation('trash',{...operations.trash,state:(result.blocked?.length||result.failed?.length)?'error':'success',error:[...(result.blocked||[]),...(result.failed||[])].map(e=>e.reason).join('\n'),finishedAt:Date.now()});return result;}
    catch(error){showOperation('trash',{...operations.trash,state:'error',error:error.message,finishedAt:Date.now()});throw error;}
}
function renderDiscardProgress(){
    const box=$('#pending-progress'),action=state.pendingDiscard;if(!box||!action)return;
    const goals=action.approval?[...action.approval.sessions.map(s=>t('Deactivate {name} ({client}) and discard its changes.',{name:s.name,client:s.agent==='codex'?'Codex':'Claude Code'})),...action.approval.additional.map(s=>t(s.updated?'Updated since selection: {name}':'Also revert {name}',{name:s.name}))]:[];
    box.innerHTML=action.approval?`<div class="discard-confirmation"><span>${esc(goals.join(' '))}</span><button id="confirm-discard" type="button">${t('Confirm')}</button></div>`:action.error?`<p class="pending-status warning" role="alert">${esc(action.error)}</p>`:action.steps?.length?`<p class="pending-status">${esc(t(action.steps.at(-1)))}</p>`:'';
    const confirm=$('#confirm-discard');if(confirm)confirm.onclick=()=>performDiscard(action.approval.confirmation);
}
async function performDiscard(confirmation=null){
    if(working||!pendingSelection.size)return;
    if(!confirmation)state.pendingDiscard={selections:[...pendingSelection].map(([id,version])=>({id,version})),steps:[]};
    const action=state.pendingDiscard;action.approval=null;action.error=null;working=true;clearTimeout(pendingTimer);
    const box=$('#pending-uploads');for(const el of box.querySelectorAll('input,button'))el.disabled=true;
    action.steps.push('Reading current changes');renderDiscardProgress();
    try{
        const result=await api('/synchronize/discard','POST',{selections:action.selections,confirmation});
        if(result.confirmationRequired){action.approval=result;renderDiscardProgress();return;}
        pendingSelection.clear();action.steps.push('Changes discarded');
        if(state.tree){const latest=await api('/state');if(!latest.items.some(i=>i.id===state.tree.id)){state.tree=null;state.scope=PROJECTS;clearRange();}}
        await refresh();if(!box.hidden){await showPendingUploads(true);renderDiscardProgress();}
    }catch(error){action.error=error.message;renderDiscardProgress();}
    finally{working=false;for(const el of box.querySelectorAll('input,button'))el.disabled=false;renderCloudStatus();}
}
async function resolveSelectedConflicts(choice){
    if(working||!conflictSelection.size)return;
    working=true;const box=$('#pending-uploads');for(const el of box.querySelectorAll('button,input'))el.disabled=true;
    try{
        await trashRequest('/conflicts/resolve',{choice,selections:[...conflictSelection].map(([id,version])=>({id,version}))},'resolve');
        conflictSelection.clear();await refresh();delete box.dataset.version;await showPendingUploads(true);
    }catch(error){const status=box.querySelector('[data-conflict-status]');if(status)status.textContent=error.message;else toast(error.message);}
    finally{working=false;for(const el of box.querySelectorAll('button,input'))el.disabled=false;renderCloudStatus();}
}
function renderConflictItems(box,data){
    for(const [id,version] of conflictSelection){const item=data.items.find(i=>i.id===id);if(!item||item.version!==version)conflictSelection.delete(id);}
    box.innerHTML=`<div class="pending-heading"><strong>${t('Sync conflicts')}</strong><div class="actions"><button type="button" id="keep-previous">${t('Keep previous')}</button><button type="button" id="keep-current">${t('Keep current')}</button><button type="button" id="conflict-select-all"></button></div></div>${data.items.length?`<ul>${data.items.map(item=>`<li class="pending-row"><div class="pending-title"><span>${esc(item.name)}</span><small>${esc(t(item.project))}</small></div><input type="checkbox" data-conflict-select="${esc(item.id)}" aria-label="${esc(t('Select {name}',{name:item.name}))}" ${conflictSelection.has(item.id)?'checked':''}><div class="pending-summary"><ul class="conflict-changes">${item.changes.map(change=>`<li><strong>${change.session&&change.session!==item.name?esc(change.session)+' · ':''}${esc(t(change.field))}</strong><div class="conflict-values"><div><small>${t('Previous (synced)')}</small><span>${esc(t(change.previous))}</span>${(change.previousMessages||[]).map(m=>`<p class="conflict-excerpt"><b>${t(m.role==='user'?'You':'Assistant')}</b> ${esc(m.text)}</p>`).join('')}</div><div><small>${t('Current (local)')}</small><span>${esc(t(change.current))}</span>${(change.currentMessages||[]).map(m=>`<p class="conflict-excerpt"><b>${t(m.role==='user'?'You':'Assistant')}</b> ${esc(m.text)}</p>`).join('')}</div></div>${change.previewUnavailable?`<small>${t('History preview is unavailable.')}</small>`:''}${change.contextOnly?`<small>${t('Visible messages match; recorded context differs.')}</small>`:''}</li>`).join('')}</ul>${item.requiresDeactivation?`<p class="conflict-effect">${t('Keeping previous saves a recovery copy and deactivates the current client copy.')}</p>`:''}</div></li>`).join('')}</ul>`:`<p>${t('No sync conflicts.')}</p>`}<p data-conflict-status role="status" aria-live="polite"></p>`;
    const update=()=>{for(const id of ['keep-previous','keep-current'])$('#'+id).hidden=!conflictSelection.size;$('#conflict-select-all').textContent=t(conflictSelection.size?'Deselect':'Select all');$('#conflict-select-all').disabled=!data.items.length;};update();
    $('#conflict-select-all').onclick=()=>{if(conflictSelection.size)conflictSelection.clear();else for(const item of data.items)conflictSelection.set(item.id,item.version);for(const el of box.querySelectorAll('[data-conflict-select]'))el.checked=conflictSelection.has(el.dataset.conflictSelect);update();};
    for(const el of box.querySelectorAll('[data-conflict-select]'))el.onchange=()=>{const item=data.items.find(i=>i.id===el.dataset.conflictSelect);el.checked?conflictSelection.set(item.id,item.version):conflictSelection.delete(item.id);update();};
    $('#keep-previous').onclick=()=>resolveSelectedConflicts('previous');$('#keep-current').onclick=()=>resolveSelectedConflicts('current');
}
async function showPendingUploads(force=false){
    if(!state.data?.cloud.configured||!state.data.cloud.unlocked)return;
    clearTimeout(pendingTimer);const box=$('#pending-uploads'),mode=state.data.conflicts?.length?'conflicts':'pending';if(box.dataset.mode!==mode){delete box.dataset.version;box.dataset.mode=mode;pendingTicket++;force=true;}if(!box.hidden&&force!==true&&(pendingFetch||box.dataset.version===state.data.stateVersion))return;
    if(force!==true&&box.dataset.version===state.data.stateVersion){showSyncPanel(box,$('#push-zone'));return;}
    const ticket=++pendingTicket;showSyncPanel(box,$('#push-zone'));if(!box.dataset.version)box.innerHTML=`<div class="pending-heading"><strong>${t(mode==='conflicts'?'Sync conflicts':'Pending uploads')}</strong></div><p role="status">${t('Reading local changes…')}</p>`;
    try{
        const version=state.data.stateVersion;let request=pendingFetch;if(!request||request.mode!==mode){request={mode,promise:api(mode==='conflicts'?'/conflicts':'/synchronize/pending')};pendingFetch=request;request.promise.finally(()=>{if(pendingFetch===request)pendingFetch=null;}).catch(()=>{});}const data=await request.promise;if(ticket!==pendingTicket||box.hidden)return;box.dataset.version=version;
        if(mode==='conflicts'){renderConflictItems(box,data);positionSyncPanel(box,$('#push-zone'));return;}
        for(const id of pendingSelection.keys()){const item=data.items.find(i=>i.id===id);if(item)pendingSelection.set(id,item.version);else pendingSelection.delete(id);}
        box.innerHTML=`<div class="pending-heading"><strong>${t('Pending uploads')}</strong><div class="actions"><button type="button" id="discard-pending" hidden>${t('Discard')}</button><button type="button" id="pending-select-all"></button></div></div>${data.items.length?`<ul>${data.items.map(i=>`<li class="pending-row"><div class="pending-title"><span title="${esc(i.name)}">${esc(i.name)}</span>${i.project?`<small title="${esc(i.project)}">${esc(i.project)}</small>`:''}</div><input type="checkbox" data-pending-select="${esc(i.id)}" aria-label="${esc(t('Select {name}',{name:i.name}))}" ${pendingSelection.has(i.id)?'checked':''}><div class="pending-summary"><time>${esc(date(i.updatedAt))}</time>${i.changes?.length?`<ul class="pending-changes">${i.changes.map(c=>`<li>${c.session&&c.session!==i.name?esc(c.session)+': ':''}${esc(t(c.label,c))}</li>`).join('')}</ul>`:''}</div></li>`).join('')}</ul>`:`<p>${t('No local changes waiting to upload.')}</p>`}<div id="pending-progress" role="status" aria-live="polite"></div>`;
        const update=()=>{$('#discard-pending').hidden=!pendingSelection.size;$('#pending-select-all').textContent=t(pendingSelection.size?'Deselect':'Select all');$('#pending-select-all').disabled=!data.items.length;};update();
        const clearProgress=()=>{state.pendingDiscard=null;$('#pending-progress').replaceChildren();};
        $('#pending-select-all').onclick=()=>{clearProgress();if(pendingSelection.size)pendingSelection.clear();else for(const i of data.items)pendingSelection.set(i.id,i.version);for(const el of $$('[data-pending-select]'))el.checked=pendingSelection.has(el.dataset.pendingSelect);update();};
        for(const checkbox of $$('[data-pending-select]'))checkbox.onchange=()=>{clearProgress();const item=data.items.find(i=>i.id===checkbox.dataset.pendingSelect);checkbox.checked?pendingSelection.set(item.id,item.version):pendingSelection.delete(item.id);update();};
        $('#discard-pending').onclick=()=>performDiscard();renderDiscardProgress();
        positionSyncPanel(box,$('#push-zone'));
    }catch(e){if(ticket===pendingTicket)box.innerHTML=`<div class="pending-heading"><strong>${t(mode==='conflicts'?'Sync conflicts':'Pending uploads')}</strong></div><p class="settings-error" role="alert">${esc(e.message)}</p>`;}
}

function renderCountdowns(){
    if(!state.data||document.hidden)return;
    for(const [id,deadline]of [['upload',state.data.cloud?.nextRunAt],['collect',state.data.update?.nextRunAt]]){const button=$('#'+id);let counter=button.querySelector('.button-countdown');if(!deadline||state.connected===false){counter?.remove();continue;}if(!counter){counter=document.createElement('span');counter.className='button-countdown';button.append(counter);}const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));const text=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(counter.textContent!==text)counter.textContent=text;}
}

function toolTags(agents, compact=false, origin=null) {
    const names=[...new Set((agents||[]).filter(a=>['codex','claude'].includes(a)))];
    return names.map(a=>`<span class="tool-tag ${a} ${compact?'compact':''}" title="${a==='codex'?'Codex':'Claude'}${compact&&origin?' · '+esc(origin.model||origin.name):''}" aria-label="${a==='codex'?'Codex':'Claude'}">${icon(a)}${compact?'':a==='codex'?'Codex':'Claude'}</span>`).join('')+(names.length>1&&!compact?`<span class="mixed-tag">${t('Mixed')}</span>`:'');
}
function sourceTags(item) {
    const o=item.origin, type=o?.platform==='win32'?'windows':o?.kind==='laptop'?'laptop':/Mac Studio/i.test(o?.model||o?.name||'')?'studio':'desktop';
    return `<span class="row-tags">${toolTags(item.agents || item.sessions?.map(s=>s.agent) || [item.agent])}${o?`<span class="device-tag" title="${esc(t(o.observed?'Imported on {device}':'Last conversation update on {device}',{device:o.name}))}">${icon(type)}<span>${esc(o.model||o.name)}</span></span>`:''}</span>`;
}

function isOlder(items) { return olderProject(items,state.data.preferences); }
function olderToggle(count) { return `<button type="button" class="older-projects-toggle" data-older-projects aria-expanded="${!!state.olderProjects}">${state.olderProjects?'▾':'▸'} ${t('Older projects')} <span>${count}</span></button>`; }
function bindOlderProjects() { $$('[data-older-projects]').forEach(el=>el.onclick=()=>{state.olderProjects=!state.olderProjects;renderNavigation();renderList();if(state.tree)renderRail();}); }
let projectObserver, listView = null, viewAnimation;
function animateView(element) {
    viewAnimation?.cancel();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    viewAnimation=element.animate([{opacity:.55},{opacity:1}],{duration:160,easing:'ease-out'});
}
function projectRows(g) {
    const initial=foldedItems(g.items,state.data.preferences),limited=state.scope===PROJECTS&&!state.query&&initial.length<g.items.length&&!(state.olderProjects&&isOlder(g.items));
    const expanded=state.expandedProjects.has(g.id)||g.items.some(i=>state.selected.has(i.id));
    return {limited,expanded,shown:limited&&!expanded?initial:g.items};
}
function foldButton(g,limited,expanded) {return limited?`<button class="show-project" data-expand-project="${esc(g.id)}">${t(expanded?'Show fewer':'Show all {count}',{count:g.items.length})}</button>`:'';}
function bindProjectFolds() {$$('[data-expand-project]').forEach(el=>el.onclick=()=>{const id=el.dataset.expandProject;state.expandedProjects.has(id)?state.expandedProjects.delete(id):state.expandedProjects.add(id);renderList();if(state.tree)renderRail();});}

function focusProject(id, scroll = true) {
    state.projectFocus = id;
    $$('[data-scope]').forEach(el=>{const on=el.dataset.scope===id;el.classList.toggle('selected',on);if(on)el.setAttribute('aria-current','location');else el.removeAttribute('aria-current');});
    if(scroll){state.projectScrollTarget=id;document.querySelector('[data-project-group="'+id+'"]')?.scrollIntoView({block:'start',behavior:'instant'});}
    const tab=$$('[data-scope]').find(el=>el.dataset.scope===id); if(tab && !scroll) tab.scrollIntoView({block:'nearest'});
}
async function navigate(scope) {
    const project = !scope.startsWith('active:') && scope !== 'archived' && scope !== 'trash';
    const focus = project ? (scope === PROJECTS ? state.projectFocus : scope) : null;
    if(project && state.scope===PROJECTS && !state.tree && !state.query&&!opening){focusProject(focus);return;}
    ++requestId;cancelOpening();listView=null;$('#main').removeAttribute('aria-busy');state.scope=project?PROJECTS:scope;state.projectFocus=focus;state.tree=null;state.list={items:[],sessionCount:0};state.query='';state.selected.clear();clearRange();$('#search').value='';
    render();if(scope !== 'trash')$('#session-list').innerHTML=`<p class="empty">${t('Loading project index…')}</p>`;
    try {await refresh();if(project&&focus)focusProject(focus);}catch(e){toast(e.message);}
}
function title() { if(state.scope==='trash')return t('Trash'); if(state.scope === PROJECTS) return t('Projects'); if(state.scope === INBOX) return t('Ungrouped'); return state.scope === 'active:codex' ? t('Active Codex Sessions') : state.scope === 'active:claude' ? t('Active Claude Code Sessions') : state.scope === 'archived' ? t('Client archive') : currentProject()?.name || t('Projects'); }
function groups() { return projectGroups(state.list.items,state.data.projects); }
function itemMeta(item) {
    if (item.kind === 'tree') return t('{count} branches', { count: item.sessions.length });
    return item.sessions[0]?.chats == null ? t('Session') : t('{count} chats', { count: item.sessions[0].chats });
}
function emptySessionGuide() {
    if(state.query)return `<div class="empty-guide"><h2>${t('No matching sessions')}</h2><p>${t('Try another search, or clear it to see this view.')}</p><button data-guide-clear>${t('Clear search')}</button></div>`;
    const empty=!state.data.items.length,started=state.data.update?.started;
    const heading=empty?(started?'No local sessions found yet':'Bring your conversations together'):'No sessions in this view';
    const description=empty?(started?'Create a conversation in Codex or Claude Code, then run Update again. If your history is elsewhere, check the folders below.':'Grove organizes your Codex and Claude Code history into projects and branches. Keep chatting in your client; use Grove to find and continue your work.'):'Current Active shows client sessions available on this computer. Projects contains your saved library, including inactive sessions.';
    return `<section class="empty-guide"><h2>${t(heading)}</h2><p>${t(description)}</p>${empty?`<ol><li><strong>${t('Read local sessions')}</strong><span>${t('Update scans this computer. It does not upload your conversations.')}</span></li><li><strong>${t('Explore and organize')}</strong><span>${t('Open a session to read its transcript and tree. Select sessions, then Move to project to create or choose a project.')}</span></li><li><strong>${t('Continue from a node')}</strong><span>${t('Select a node and Activate to continue from that context in your client.')}</span></li></ol>`:''}<div class="guide-actions"><button class="primary" data-guide-update>${t(started?'Update again':'Update · find local sessions')}</button>${!empty?`<button data-guide-projects>${t('Open Projects')}</button>`:''}<button data-guide-help>${t('Quick guide')}</button></div>${empty?`<details><summary>${t('Session folders')}</summary>${Object.entries(state.roots||{}).map(([agent,folder])=>`<p><strong>${esc(agent)}</strong><code>${esc(folder)}</code></p>`).join('')}</details>`:''}</section>`;
}
function bindSessionGuide(){
    $$('[data-guide-update]').forEach(el=>el.onclick=updateSessions);
    $$('[data-guide-help]').forEach(el=>el.onclick=information);
    $$('[data-guide-projects]').forEach(el=>el.onclick=()=>navigate(PROJECTS));
    $$('[data-guide-clear]').forEach(el=>el.onclick=()=>{$('#search').value='';state.query='';refresh().catch(e=>toast(e.message));});
}
async function updateSessions(){
    const firstLibrary=!state.data.items.length&&!state.tree;
    return run(async()=>{const r=await api('/collect','POST',{});if(r.errors?.length)toast(r.errors.map(e=>errorText(e.message)).join('\n'));else toast(t('Refresh complete · {updates} updated · {discovered} discovered',{updates:r.updates.length,discovered:r.discovered}));if(firstLibrary){state.scope=PROJECTS;state.query='';$('#search').value='';}},'update');
}
function renderList() {
    if(state.scope==='trash'){renderTrash();return;}
    if(state.scope==='archived'){renderClientArchive();return;}
    $('#list-title').textContent = title();
    const pending = state.list.pendingDeactivation || [],discarded=(state.data.trashNative||[]).filter(i=>i.active&&i.discarded&&(!i.background||state.data.preferences?.showScheduledSessions)&&state.scope==='active:'+i.agent); $('#active-notice').hidden = !pending.length&&!discarded.length;
    $('#active-notice').innerHTML = pending.length ? `<span>${t('{count} archived sessions are still active on this device.',{count:pending.length})}</span><button id="deactivate-archived">${t('Deactivate archived sessions')}</button>` : '';
    if(discarded.length){$('#active-notice').insertAdjacentHTML('beforeend',`<span>${t('{count} local client copies of trashed sessions remain.',{count:discarded.length})}</span><button id="open-trash">${t('Open Trash')}</button>`);$('#open-trash').onclick=()=>navigate('trash');}
    if(pending.length)$('#deactivate-archived').onclick=()=>run(()=>api('/manage','POST',{action:'deactivate',branchIds:pending.map(s=>s.id)}));
    $('#list-count').textContent = t('{count} sessions', { count: state.list.sessionCount || 0 });
    const selected = state.list.items.filter(i => state.selected.has(i.id));
    const activeIds=[...new Set(selected.flatMap(i=>(state.data.items.find(v=>v.id===i.id)||i).sessions.filter(s=>s.active).map(s=>s.id)))];
    const organizing = state.scope !== 'archived';
    $('#list-actions').innerHTML = '<button id="select-all"></button>' + (selected.length ? `<span class="selection-count">${t('{count} selected',{count:selected.length})}</span>${state.scope==='archived'?'<button id="restore-items"></button>':organizing?'<button id="move-items"></button>':''}<button id="archive-items"></button>`:'');
    button('#select-all',state.selected.size?'Deselect':'Select all',()=>{state.selected=state.selected.size?new Set():new Set(state.list.items.map(i=>i.id));renderList();});
    button('#move-items','Move to project',()=>moveDialog([...state.selected]));
    button('#archive-items',activeIds.length?t('Deactivate ({count})',{count:activeIds.length}):'Move to Trash',()=>activeIds.length?run(async()=>{await api('/manage','POST',{action:'deactivate',branchIds:activeIds});if(state.scope.startsWith('active:')){state.scope=PROJECTS;state.projectFocus=selected[0]?.projectId||INBOX;}}):trashDialog({itemIds:[...state.selected],view:state.scope==='archived'?'archived':'in-use'},selected.length));
    button('#restore-items','Restore',()=>restore({itemIds:[...state.selected]}));
    button('#deactivate-items','Deactivate',()=>run(()=>api('/manage','POST',{action:'deactivate',itemIds:[...state.selected],agent:state.scope.slice(7)})));
    const row=i=>`<article class="session-row ${state.selected.has(i.id)?'checked':''}" data-item="${esc(i.id)}" draggable="${organizing?'true':'false'}"><button class="row-open" data-open="${esc(i.id)}">${icon(i.kind)}<span class="row-text"><span class="row-title">${editableName('session',i.id,i.name)} ${cloudMark(i)}</span><span class="row-meta">${itemMeta(i)} ${sourceTags(i)}</span></span><time class="row-date">${date(i.updatedAt)}</time></button>${`<input type="checkbox" data-select="${esc(i.id)}" aria-label="${esc(t('Select {name}',{name:i.name}))}" ${state.selected.has(i.id)?'checked':''}>`}</article>`;
    const groupHtml = g=>{const {limited,expanded,shown}=projectRows(g);return `<section class="list-group project-group" data-project-group="${esc(g.id||INBOX)}"><h2>${projectName(g.id,g.name==='Scheduled & background'?t(g.name):g.name)}<span class="group-actions"><span>${g.items.length}</span><input type="checkbox" data-group-select="${esc(g.id)}" aria-label="${esc(t('Select group {name}',{name:g.name}))}"></span></h2>${shown.map(row).join('')}${foldButton(g,limited,expanded)}</section>`;};
    const allGroups = groups(), older = state.scope===PROJECTS&&!state.query ? allGroups.filter(g=>isOlder(g.items)) : [], olderIds = new Set(older.map(g=>g.id));
    $('#session-list').innerHTML = allGroups.filter(g=>!olderIds.has(g.id)).map(groupHtml).join('') + (older.length ? `<section class="older-projects">${olderToggle(older.length)}${state.olderProjects?older.map(groupHtml).join(''):''}</section>` : '') || emptySessionGuide();
    bindSessionGuide();
    $('#select-all').hidden=!state.list.items.length;
    bindOlderProjects();
    $$('[data-group-select]').forEach(el=>{const items=allGroups.find(g=>g.id===el.dataset.groupSelect)?.items||[],count=items.filter(i=>state.selected.has(i.id)).length;el.checked=!!items.length&&count===items.length;el.indeterminate=count>0&&count<items.length;el.onchange=()=>{for(const i of items)el.checked?state.selected.add(i.id):state.selected.delete(i.id);renderList();};});
    $$('[data-open]').forEach(el=>el.onclick=()=>openTree(el.dataset.open));
    $$('[data-select]').forEach(el=>el.onchange=()=>{el.checked?state.selected.add(el.dataset.select):state.selected.delete(el.dataset.select);renderList();});
    bindProjectFolds();
    projectObserver?.disconnect();
    if(state.scope===PROJECTS&&!state.tree){projectObserver=new IntersectionObserver(entries=>{if(state.projectScrollTarget)return;const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);if(visible[0])focusProject(visible[0].target.dataset.projectGroup,false);},{root:$('#session-list'),rootMargin:'0px 0px -65% 0px',threshold:0});$$('[data-project-group]').forEach(el=>projectObserver.observe(el));}
}

function renderRail() {
    const top=$('#session-rail').scrollTop;
    const group=g=>{const {limited,expanded,shown}=projectRows(g);return `<section data-rail-project="${esc(g.id)}"><h2 class="rail-heading">${projectName(g.id,g.name)}</h2>${shown.map(i=>`<button class="rail-row ${state.tree?.id===i.id?'selected':''}" data-rail="${esc(i.id)}" ${state.tree?.id===i.id?'aria-current="true"':''}>${icon(i.kind)}<span class="row-text"><span class="row-title">${editableName('session',i.id,i.name)} ${cloudMark(i)}</span><span class="row-meta">${itemMeta(i)} ${sourceTags(i)}</span></span></button>`).join('')}${foldButton(g,limited,expanded)}</section>`;};
    const all=groups(),older=state.scope===PROJECTS&&!state.query?all.filter(g=>isOlder(g.items)):[],ids=new Set(older.map(g=>g.id));
    $('#rail-content').innerHTML=all.filter(g=>!ids.has(g.id)).map(group).join('')+(older.length?olderToggle(older.length)+(state.olderProjects?older.map(group).join(''):''):'');
    $('#session-rail').scrollTop=top;
    $$('[data-rail]').forEach(el=>el.onclick=()=>openTree(el.dataset.rail));bindProjectFolds();bindOlderProjects();
}
async function openTree(id) {
    if (state.tree?.id === id && !opening) return;
    cancelOpening();
    const ticket = ++requestId, scope = state.scope, view = scope === 'archived' ? 'archived' : 'in-use';
    const item = state.list.items.find(i => i.id === id);
    if (!state.tree && !listView) { listView={scroll:$('#session-list').scrollTop,projectFocus:state.projectFocus};$('#session-list').scrollTo({top:listView.scroll,behavior:'instant'}); }
    opening = true;const controller=openController=new AbortController(),openId='open-'+ticket+'-'+Date.now();$('#main').setAttribute('aria-busy','true');
    const progress=async phase=>{if(ticket!==requestId)return;showOperation('open',{id:openId,action:'open',state:'running',startedAt:Date.now(),progress:{phase}});await nextPaint();};
    $$('[data-loading]').forEach(el=>el.removeAttribute('data-loading'));
    ($(`[data-rail="${id}"]`) || $(`[data-open="${id}"]`))?.setAttribute('data-loading','true');
    try {
        await progress('Reading session history');
        const tree = await api('/trees/' + encodeURIComponent(id) + '?view=' + view,'GET',null,false,{openId,signal:controller.signal,onStage:progress});
        if (ticket !== requestId || state.scope !== scope) return;
        if (tree.view !== view || tree.paths.some(p => view === 'archived' ? !p.archived && !tree.projectArchived : p.archived || tree.projectArchived)) throw new Error(t('The view changed. Please open the session again.'));
        if (!tree.paths.length) {state.tree=null;cancelOpening();render();return;}
        await progress('Drawing conversation tree');
        if(ticket!==requestId||controller.signal.aborted)return;
        state.tree = tree;state.projectFocus=tree.projectId || INBOX;if(listView&&!listView.entryProject)listView.entryProject=state.projectFocus;
        state.branchId = (state.query ? tree.paths.find(p => item?.matchedSessionIds?.includes(p.branchId)) : null)?.branchId || tree.paths.find(p=>p.branchId===tree.id)?.branchId || [...tree.paths].sort((a,b)=>b.nodeIds.length-a.nodeIds.length)[0].branchId;
        for (const list of [state.list.items,state.data.items]) { const cached=list.find(i=>i.id===id); if(cached)cached.cloudState='cached'; }
        state.nodeId = null; state.compactionId = null; clearRange(); state.expanded.clear(); camera.x = 0; camera.y = 0; camera.zoom = 1; camera.newView = true; render();animateView($('#detail-page'));
        const tab=$$('[data-scope]').find(el=>el.dataset.scope===state.projectFocus);tab?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
        await nextPaint();
        if(ticket===requestId)showOperation('open',{id:openId,action:'open',state:'success',finishedAt:Date.now()});
    } catch (e) { if (ticket === requestId&&e.name!=='AbortError') { if (!state.tree) listView=null;showOperation('open',{id:openId,action:'open',state:'error',error:e.message,finishedAt:Date.now()});toast(e.message); } }
    finally { if (ticket === requestId) { openController=null;opening = false; $('#main').removeAttribute('aria-busy');$$('[data-loading]').forEach(el=>el.removeAttribute('data-loading'));renderCloudStatus(); } }
}

function render({keepDetail=false} = {}) {
    translateBanner(); renderNavigation(); renderList();
    const detail = !!state.tree;
    $('#layout').classList.toggle('detail', detail); $('#list-page').hidden = detail; $('#detail-page').hidden = !detail; $('#session-rail').hidden = !detail;
    if (detail) { renderRail(); if(keepDetail)renderDetailActions();else renderDetail(); }
    else {
        // Drop the last transcript's object graph as well as its DOM. These caches
        // and delegated handlers otherwise retain message bodies on the list page.
        drawnTree=null;currentGraphLayout=null;labeledTree=null;nodeLabels=null;activityGroups=[];
        $('#branch-picker').replaceChildren();$('#detail-actions').replaceChildren();
        $('#transcripts').onclick=null;$('#transcripts').replaceChildren();$('#graph').replaceChildren();$('#ribbons').replaceChildren();
    }
}
function renderDetail() {
    const tree = state.tree, p = route(); if (!p) { state.tree = null; render(); return; }
    $('#session-title').innerHTML = editableName('session',tree.id,tree.name);
    const tokens = p.nodeIds.reduce((sum, id) => sum + (tree.nodes.find(n => n.id === id)?.tokens?.recordedEstimate || 0), 0);
    $('#session-meta').textContent = `${p.agent === 'codex' ? 'Codex' : 'Claude'} · ≈ ${compactNumber(tokens)} tokens${p.context?.compactions.some(e=>e.controlPrimary!==false) ? ' · ' + t('{count} compactions', { count: p.context.compactions.filter(e=>e.controlPrimary!==false).length }) : ''}`;
    $('#detail-count').textContent = `${t('{count} branches', { count: tree.paths.length })} · ${t('{count} chats', { count: tree.chatCount })} · ${t('{count} pending', { count: tree.pendingCount })}`;
    $('#branch-picker').innerHTML = tree.paths.map(v => `<option value="${esc(v.branchId)}" ${v.branchId === p.branchId ? 'selected' : ''}>${esc(v.transcriptionTitle || v.originalTitle || v.name)}</option>`).join('');
    enhanceSelect($('#branch-picker'));
    renderDetailActions(); renderTranscript(); renderGraph(); scheduleRibbons();
}

function canCombine() {
    const p = route(), positions = p.messages.map((m, i) => state.chats.has(m.id) ? i : -1).filter(i => i >= 0);
    if (!positions.length || positions.at(-1) - positions[0] + 1 !== positions.length) return false;
    return !state.tree.nodes.some(n => {
        const end = p.messages.findIndex(m => m.id === n.chatIds.at(-1));
        return end >= positions[0] && end < positions.at(-1) && (n.splitBoundary ?? (n.childIds.length > 1 || n.endBranchIds.length));
    });
}
function renderDetailActions() {
    const p = route(), node = selectedNode(), terminal = node?.endBranchIds.includes(p.branchId);
    const archived = p.archived || state.data.projects.find(v => v.id === state.tree.projectId)?.archived;
    const editable = !archived && state.scope !== 'archived';
    const dissolve = state.tree.nodes.some(n => !n.pending && n.chatIds.some(id => state.chats.has(id)));
    $('#detail-actions').innerHTML = state.chats.size ? `<span>${t('{count} selected', { count: state.chats.size })}</span>${editable && state.rangeEnd !== null && canCombine() ? '<button id="combine"></button>' : ''}${editable && state.rangeEnd !== null && dissolve ? '<button id="dissolve"></button>' : ''}<button id="clear-selection"></button>` : node ? `${editable ? '<button id="activate-node"></button>' : ''}${terminal && !p.active ? `${archived ? '<button id="restore-session"></button>' : ''}<button id="archive-path"></button>` : ''}` : '';
    const nativeInstance=terminal&&p.active&&state.data.instances.find(i=>i.branchId===p.branchId&&i.applied&&!i.missing);
    if(nativeInstance&&state.data.clientLinks?.[nativeInstance.agent]){const href=nativeInstance.agent==='claude'?'vscode://anthropic.claude-code/open?session='+encodeURIComponent(nativeInstance.nativeId):'vscode://openai.chatgpt/local/'+encodeURIComponent(nativeInstance.nativeId);$('#detail-actions').insertAdjacentHTML('beforeend',`<a class="native-client-link" href="${esc(href)}" title="${esc(t('Open the matching workspace in VS Code first.'))}">${t('Open in VS Code')}</a>`);}
    button('#activate-node', terminal && p.active ? 'Deactivate' : 'Activate', () => terminal && p.active ? run(()=>api('/manage','POST',{action:'deactivate',branchIds:[p.branchId]})) : activateDialog(p));
    button('#combine', 'Combine', combineDialog);
    button('#dissolve', 'Dissolve', () => run(async () => { await saveOrganization('dissolve'); clearRange(); }));
    button('#clear-selection', 'Deselect', () => { clearRange(); updateRangeSelection(); renderDetailActions(); renderGraph(); });
    button('#restore-session', 'Restore', () => restore({ branchIds: [p.branchId] }));
    button('#archive-path', 'Move to Trash', archivePath);
}
function excerpt(text, expanded) {
    if (expanded || text.length < 380) return `<div class="markdown">${markdown(text)}</div>`;
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
    const shortened = paragraphs.length > 2 ? paragraphs[0].slice(0, 600) + '\n\n…\n\n' + paragraphs.at(-1).slice(-500) : text.slice(0, 210) + '\n\n…\n\n' + text.slice(-150);
    return `<div class="markdown">${markdown(shortened)}</div>`;
}
function activityEntries(entries,p) {
    return entries.map(e=>`<div class="activity-entry"><button type="button" data-record="${e.line}" data-head="${esc(p.head)}">${esc(e.label)} <span>${t(e.kind)}</span></button>${e.unreadable?`<p class="dialog-copy">${t('No readable summary')}</p>`:''}${e.files?.length?`<div class="file-tags">${e.files.map(f=>`<code>${esc(f)}</code>`).join('')}</div>`:''}<span class="activity-cost">${e.opaque?t('Opaque or non-text; token size unknown'):'≈ '+compactNumber(e.tokens)+' tokens'}</span>${e.preview?.trim()?`<pre>${esc(e.preview)}</pre>`:''}</div>`).join('');
}
function activityHtml(entries, p) {
    if(!entries?.length) return '';
    const index=activityGroups.push({entries,p})-1;
    return `<details class="activity" data-activity="${index}"><summary>${t('Recorded activity')} · ${entries.length} · ≈ ${compactNumber(entries.reduce((n,e)=>n+e.tokens,0))} tokens</summary><div class="activity-body"></div></details>`;
}
function contextBreakdown(p) {
    const ledger=p.context?.ledger;if(!ledger)return '';
    const fidelity = !p.canRewriteContext ? `<p class="fidelity-note">${t('Some native history is missing or unsupported. Update to read the referenced segments before changing context.')}</p>` : '';
    const labels={'tool-call':'Tool inputs','tool-result':'Tool results',reasoning:'Readable reasoning',instructions:'Recorded instructions'};
    return fidelity + `<details class="context-breakdown"><summary>${t('Recorded context')} · ${t('Tool activity')}: ≈ ${compactNumber((ledger.totals['tool-call']||0)+(ledger.totals['tool-result']||0))} tokens${p.context.lastUsage?` · ${t('Last native input')}: ${compactNumber(p.context.lastUsage.input)}`:''}</summary><div class="token-breakdown">${Object.entries(ledger.totals).filter(([,n])=>n).map(([k,n])=>`<span>${t(labels[k])}<b>≈ ${compactNumber(n)}</b></span>`).join('')}</div>${activityHtml(ledger.entries.filter(e=>e.chatLine===null),p)}</details>`;
}
function compactionsAt(n, p) { return (p.context?.compactions || []).filter(e => e.controlPrimary!==false&&n.chatIds.includes(p.messages.find(m => m.line > e.line)?.id)); }
function mutedNode(n, p) {
    const last = (p.context?.compactions || []).filter(e => e.enabled).at(-1);
    if (!last) return false;
    const chats = p.messages.filter(m => n.chatIds.includes(m.id));
    return chats.length > 0 && chats.every(m => m.line < last.line);
}
function compactionButton(e, compact = false, owner=route()) {
    const enabled=e.groupEnabled??e.enabled,mixed=!!e.groupMixed,canRewrite=e.groupCanRewrite??owner?.canRewriteContext,canDisable=e.groupCanDisable??e.canDisable;
    const label=t(mixed?'Mixed':enabled?'On':'Off'),scope='';
    if(!canRewrite||state.scope==='archived'||!canDisable&&enabled&&!mixed)return `<span class="context-switch">${t('Compact')}${scope} · ${label}</span>`;
    return `<button type="button" class="context-switch ${enabled&&!mixed?'enabled':''}" data-compaction="${esc(e.id)}" data-compaction-path="${esc(owner.branchId)}" aria-label="${esc(t('Use compaction')+scope)}" aria-pressed="${mixed?'mixed':!!enabled}">${compact?t('Compact'):t('Use compaction')}${scope}<span>${label}</span></button>`;
}
function bindCompactions(root) { root.querySelectorAll('[data-compaction]').forEach(el => el.onclick = () => {
    const p=state.tree.paths.find(p=>p.branchId===el.dataset.compactionPath)||route(),event=p.context.compactions.find(e=>e.id===el.dataset.compaction);
    state.compactionId=event.id;state.nodeId=null;clearRange();
    run(()=>api('/branches/'+p.branchId+'/compaction','POST',{eventId:event.id,enabled:event.groupMixed?true:!(event.groupEnabled??event.enabled),head:p.head,version:state.tree.version}));
}); }
function reconcileTranscript(markup) {
    const pane=$('#transcripts'),template=document.createElement('template');template.innerHTML=markup;
    const old=new Map([...pane.querySelectorAll(':scope > [data-segment]')].map(el=>[el.dataset.segment,el]));
    const desired=[...template.content.children].map(next=>{
        if(!next.dataset.segment)return next;
        const previous=old.get(next.dataset.segment),body=[...next.children].slice(1).map(el=>el.outerHTML).join('');
        next._chatMarkup=body;
        if(!previous||previous._chatMarkup!==body)return next;
        previous.className=next.className;previous.setAttribute('style',next.getAttribute('style'));
        const caption=next.querySelector('.segment-caption');if(previous.firstElementChild.outerHTML!==caption.outerHTML)previous.firstElementChild.replaceWith(caption);
        return previous;
    });
    const retained=new Set(desired);for(const node of [...pane.children])if(!retained.has(node))node.remove();
    let cursor=pane.firstElementChild;
    for(const node of desired){if(node===cursor)cursor=cursor.nextElementSibling;else pane.insertBefore(node,cursor);}
}
function renderTranscript() {
    activityGroups=[];
    const p = route();
    const markup = contextBreakdown(p) + p.nodeIds.map(id => {
        const n = state.tree.nodes.find(n => n.id === id), messages = p.messages.filter(m => n.chatIds.includes(m.id));
        return `${compactionsAt(n, p).map(e => `<div class="compaction-marker">${t('Context compacted here')}${compactionButton(e)}</div>`).join('')}<section class="transcript-segment ${mutedNode(n, p) ? 'context-muted' : ''} ${n.pending ? 'pending' : ''}" data-segment="${esc(n.id)}" style="${style(n)}"><div class="segment-caption"><button data-focus-node="${esc(n.id)}">${editableName('node',n.id,nodeName(n))} · ${t('{count} chats', { count: messages.length })}</button><span class="token-estimate">${tokenLabel(n)}</span></div>${messages.map(m => `<article data-message="${esc(m.id)}" class="chat ${m.role} ${state.chats.has(m.id) ? 'checked' : ''}">${state.scope === 'archived' ? '' : `<input type="checkbox" data-chat="${esc(m.id)}" aria-label="${esc(t('Select chat {number}', { number: p.messages.findIndex(x => x.id === m.id) + 1 }))}" ${state.chats.has(m.id) ? 'checked' : ''}>`}<div class="bubble"><span class="speaker">${m.role === 'user' ? t('You') : p.agent === 'codex' ? 'Codex' : 'Claude'}</span>${excerpt(m.text, state.expanded.has(m.id))}${activityHtml(m.activity,p)}${m.text.length >= 380 ? `<button class="expand-chat" data-expand="${esc(m.id)}">${t(state.expanded.has(m.id) ? 'Collapse' : 'Expand')}</button>` : ''}</div></article>`).join('')}</section>`;
    }).join('') || `<p class="empty">${t('No chats yet.')}</p>`;
    const trailing = (p.context?.compactions || []).filter(e => e.controlPrimary!==false&&!p.messages.some(m => m.line > e.line));
    reconcileTranscript(markup+trailing.map(e => `<div class="compaction-marker">${t('Context compacted here')}${compactionButton(e)}</div>`).join(''));
    bindCompactions($('#transcripts'));
    $('#transcripts').onclick=async event=>{
        const el=event.target.closest('[data-record]');if(!el)return;
        const branchId=p.branchId, head=el.dataset.head; let offset=0;
        modal('Original context record', `<p>${t('Loading…')}</p>`, null);
        const box=$('#dialog-content'), ticket=modalVersion;
        async function load(){
            try { const r=await api('/branches/'+branchId+'/records/'+el.dataset.record+'?head='+encodeURIComponent(head)+'&offset='+offset);
                if(ticket!==modalVersion || !box.isConnected || !$('#dialog').open)return;
                box.innerHTML=`${r.opaque?`<p class="dialog-copy">${t('No readable text')}</p>`:''}<pre class="record-detail"></pre><div class="record-pages">${offset?'<button type="button" id="record-previous">'+t('Previous')+'</button>':''}<span>${offset+1}–${offset+r.text.length} / ${r.total}</span>${r.next!==null?'<button type="button" id="record-next">'+t('Next')+'</button>':''}</div>`;
                $('.record-detail').textContent=r.text;
                if($('#record-next'))$('#record-next').onclick=()=>{offset=r.next;load();};
                if($('#record-previous'))$('#record-previous').onclick=()=>{offset=Math.max(0,offset-r.pageSize);load();};
            }catch(e){if($('#dialog').open)$('#dialog-error').textContent=e.message;}
        } await load();
    };
    $$('#transcripts details').forEach(el=>el.ontoggle=()=>{if(el.hasAttribute('data-activity')&&el.open&&!el.dataset.loaded){const group=activityGroups[Number(el.dataset.activity)];el.querySelector('.activity-body').innerHTML=activityEntries(group.entries,group.p);el.dataset.loaded='true';}scheduleRibbons();});
    updateRangeSelection();
    $$('[data-chat]').forEach(el => el.onclick = e => {
        const index = p.messages.findIndex(m => m.id === el.dataset.chat);
        const range=selectRange(state.rangeStart,state.rangeEnd,index,e.shiftKey); state.rangeStart=range.start;state.rangeEnd=range.end;
        const end = state.rangeEnd ?? state.rangeStart;
        state.chats = state.rangeStart===null?new Set():new Set(p.messages.slice(Math.min(state.rangeStart, end), Math.max(state.rangeStart, end) + 1).map(m => m.id));
        state.nodeId = null; state.compactionId = null;
        updateRangeSelection(); renderDetailActions(); renderGraph();
    });
    $$('[data-expand]').forEach(el => el.onclick = () => {
        const pane = $('#transcripts'), top = pane.scrollTop, id = el.dataset.expand;
        const expanded = !state.expanded.has(id);
        expanded ? state.expanded.add(id) : state.expanded.delete(id);
        // Keep the list and open activity details intact when toggling one message.
        el.closest('.bubble').querySelector('.markdown').outerHTML = excerpt(p.messages.find(m => m.id === id).text, expanded);
        el.textContent = t(expanded ? 'Collapse' : 'Expand');
        pane.scrollTo({ top, behavior: 'instant' });
        scheduleRibbons();
    });
    $$('[data-focus-node]').forEach(el => el.onclick = () => selectNode(el.dataset.focusNode, false));
}
function updateRangeSelection() {
    $('#range-hint').hidden = state.scope === 'archived';
    $('#range-hint').textContent = state.rangeStart === null ? t('Select a start, then an end.') : state.rangeEnd === null ? t('Start: {number} · select the end', { number: state.rangeStart + 1 }) : t('Selected chats {start}–{end}', { start: Math.min(state.rangeStart, state.rangeEnd) + 1, end: Math.max(state.rangeStart, state.rangeEnd) + 1 });
    for (const el of $$('[data-chat]')) { const checked = state.chats.has(el.dataset.chat); el.checked = checked; el.closest('.chat').classList.toggle('checked', checked); }
}
let drawnTree = null, currentGraphLayout;
function renderGraph() {
    const nodes=state.tree.nodes,p=route(),byNode=new Map(nodes.map(n=>[n.id,n]));
    const layout=currentGraphLayout=graphLayout(state.tree,p.branchId);
    const {positions,controls,edges,junctions,activeNodes,contextNodes,endpoints,width,height,rootX}=layout;
    const pathLabel=p.transcriptionTitle||p.originalTitle||p.name;$('#graph-path-label').textContent=pathLabel;$('#graph-path-label').title=t('Selected path')+': '+pathLabel;
    const edgeMarkup=junctions.map(j=>`<path d="${j.d}" class="graph-junction" fill="none" stroke="#9badbb" stroke-width="1.5"/>`).join('')+[...edges].sort((a,b)=>Number(a.active)-Number(b.active)).map(e=>`<path data-path-edge="${e.active?'current':'other'}" class="path-edge ${e.active?'path-active':'path-inactive'}" d="${e.d}" fill="none" stroke="${palette[e.color][0]}" stroke-width="2" ${e.pending?'stroke-dasharray="4 4"':''}/>`).join('')+junctions.filter(j=>j.activeD).map(j=>`<path class="path-edge path-active" d="${j.activeD}" fill="none"/>`).join('');
    camera.width=width;camera.height=height;camera.rootX=rootX;
    if(camera.newView){const view=$('#graph-scroll');Object.assign(camera,pathCamera(layout,p.branchId,view.clientWidth,view.clientHeight));camera.newView=false;}
    $('#graph').style.width = `${width}px`; $('#graph').style.height = `${height}px`;
    if (drawnTree !== state.tree) {
    $('#graph').innerHTML = `<svg class="graph-edges" width="${width}" height="${height}" aria-hidden="true"></svg>${nodes.map(n => { const pos = positions.get(n.id); return `<button class="graph-node ${mutedNode(n, p) ? 'context-muted' : ''} ${n.pending ? 'pending' : ''} ${n.id === state.nodeId ? 'selected' : ''} ${activeNodes.has(n.id)?'path-active':'dimmed path-inactive'}" data-node="${esc(n.id)}" style="${style(n)};left:${pos.x}px;top:${pos.y}px" aria-pressed="${n.id === state.nodeId}"><span class="node-tools">${toolTags(n.agents || [p.agent],true)}</span><span class="node-title">${editableName('node',n.id,nodeName(n))}</span><span class="node-meta">${t('{count} chats', { count: n.count })} · <span>${tokenLabel(n)}</span></span>${n.endBranchIds.some(id => state.tree.paths.find(p => p.branchId === id)?.active) ? `<span class="active-node-dot" aria-label="${t('Active on this device')}" title="${t('Active on this device')}"></span>` : ''}</button>`; }).join('')}`;
        $('#graph').insertAdjacentHTML('beforeend',contextNodes.map(n=>{const pos=positions.get(n.id);return `<div class="context-point ${activeNodes.has(n.id)?'path-active':'path-inactive'}" data-context-point="${esc(n.id)}" style="left:${pos.x}px;top:${pos.y}px"><span>${t('Compacted context')}</span><small>${t('No new chats')}</small></div>`;}).join(''));
        drawnTree = state.tree;
    } else {
        for (const el of $$('[data-node]')) {
            const n = byNode.get(el.dataset.node);
            el.classList.toggle('selected', n.id === state.nodeId);
            el.classList.toggle('dimmed', !activeNodes.has(n.id));el.classList.toggle('path-active',activeNodes.has(n.id));el.classList.toggle('path-inactive',!activeNodes.has(n.id));
            el.classList.toggle('context-muted', mutedNode(n, p));
            el.setAttribute('aria-pressed', String(n.id === state.nodeId));
        }
    }
    $('#graph .graph-edges').innerHTML=edgeMarkup;
    $$('#graph .context-point').forEach(el=>{el.classList.toggle('path-active',activeNodes.has(el.dataset.contextPoint));el.classList.toggle('path-inactive',!activeNodes.has(el.dataset.contextPoint));});
    $$('#graph .compaction-edge').forEach(el => el.remove());
    $('#graph').insertAdjacentHTML('beforeend',controls.map(({owner,e,before,after,x,y})=>`<div class="compaction-edge ${p.context.compactions.some(c=>c.groupId===e.groupId)?'path-active':'path-inactive'}" data-before="${esc(before?.id||'')}" data-after="${esc(after?.id||'')}" style="left:${x}px;top:${y}px">${compactionButton(e,true,owner)}</div>`).join(''));
    $$('#graph .transcription-end').forEach(el=>el.remove());
    for(const [nodeId,paths] of endpoints){const pos=positions.get(nodeId),title=[...new Set(paths.map(v=>v.transcriptionTitle||v.originalTitle||v.name))].join(' · ');
        $('#graph').insertAdjacentHTML('beforeend',`<div class="transcription-end ${paths.some(v=>v.branchId===p.branchId)?'path-active':''}" data-current-end="${paths.some(v=>v.branchId===p.branchId)}" style="left:${pos.x}px;top:${pos.y+82}px" title="${esc(title)}">${esc(title)}</div>`);camera.height=Math.max(camera.height,pos.y+110);
    }
    $('#graph').style.height=camera.height+'px';
    bindCompactions($('#graph'));
    $$('[data-node]').forEach(el => { el.onpointerdown = e => { if (e.button === 0) e.preventDefault(); }; el.onclick = () => selectNode(el.dataset.node); });
    applyCamera();
}
function selectNode(id, scrollTranscript = true) {
    const n=state.tree.nodes.find(n=>n.id===id);if(!n)return;
    if(opening)cancelOpening();
    ++requestId; // A refresh started before this click must not replace the chosen path.
    const oldPath=state.branchId, hadSelection=state.chats.size>0, graphView=$('#graph-scroll'), graphTop=graphView.scrollTop, graphLeft=graphView.scrollLeft;
    if(!n.branchIds.includes(state.branchId))state.branchId=n.branchIds.find(id=>!state.tree.paths.find(p=>p.branchId===id).archived)||n.branchIds[0];
    clearRange();state.compactionId=null;state.nodeId=id;
    if(oldPath!==state.branchId||hadSelection)renderDetail();else{renderDetailActions();renderGraph();}
    graphView.scrollTo({top:graphTop,left:graphLeft,behavior:'instant'});
    $(`[data-node="${id}"]`)?.focus({preventScroll:true});
    if(scrollTranscript){
        const pane=$('#transcripts'), branchId=state.branchId;
        const align=()=>{if(state.nodeId!==id||state.branchId!==branchId)return;const target=$(`[data-segment="${id}"]`);if(target)pane.scrollTo({top:pane.scrollTop+target.getBoundingClientRect().top-pane.getBoundingClientRect().top,behavior:'instant'});};
        pane.classList.add('positioning-node');
        align();
        requestAnimationFrame(()=>{align();requestAnimationFrame(()=>{align();pane.classList.remove('positioning-node');scheduleRibbons();});});
    }else revealNode(id);
    scheduleRibbons();
}
let ribbonFrame = 0;
function scheduleRibbons() { if (!ribbonFrame) ribbonFrame = requestAnimationFrame(() => { ribbonFrame = 0; drawRibbons(); }); }
function drawRibbons() {
    if (!state.tree || !route() || $('#ribbon-lane').offsetWidth === 0) return;
    const lane = $('#editor').getBoundingClientRect(), view = $('#transcripts').getBoundingClientRect(), graphView = $('#graph-scroll').getBoundingClientRect();
    $('#ribbons').setAttribute('viewBox', `0 0 ${lane.width} ${lane.height}`);
    $('#ribbons').innerHTML = route().nodeIds.map(id => {
        const segment = $(`[data-segment="${id}"]`), node = $(`[data-node="${id}"]`); if (!segment || !node) return '';
        const a = segment.getBoundingClientRect(), b = node.getBoundingClientRect();
        if (a.bottom < view.top || a.top > view.bottom || b.bottom < graphView.top || b.top > graphView.bottom || b.left < graphView.left || b.left > graphView.right) return '';
        const top = Math.max(a.top, view.top) - lane.top, bottom = Math.min(a.bottom, view.bottom) - lane.top;
        const nt = Math.max(b.top, graphView.top) - lane.top, nb = Math.min(b.bottom, graphView.bottom) - lane.top;
        const left = view.right - lane.left, right = Math.max(left, b.left - lane.left), mid = (left + right) / 2;
        const n = state.tree.nodes.find(n => n.id === id);
        return `<path data-ribbon="${esc(id)}" d="M${left} ${top} C${mid} ${top},${mid} ${nt},${right} ${nt} L${right} ${nb} C${mid} ${nb},${mid} ${bottom},${left} ${bottom} Z" fill="${mutedNode(n, route()) ? '#aeb8c1' : palette[n.color][0]}" opacity=".19"/>`;
    }).join('');
}
function applyCamera() {
    if (!state.tree) return;
    $('#graph').style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    const view = $('#graph-scroll');
    view.style.backgroundSize = `${Math.max(12, 18 * camera.zoom)}px ${Math.max(12, 18 * camera.zoom)}px`;
    view.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
    $('#zoom-label').textContent = Math.round(camera.zoom * 100) + '%';
    $('#zoom-out').disabled = camera.zoom <= .02; $('#zoom-in').disabled = camera.zoom >= 1.75;
    scheduleRibbons();
}
function zoom(delta, x, y) {
    const rect = $('#graph-scroll').getBoundingClientRect(), cx = x ?? rect.width / 2, cy = y ?? rect.height / 2;
    const next = Math.max(.02, Math.min(1.75, camera.zoom * delta)), ratio = next / camera.zoom;
    camera.x = cx - (cx - camera.x) * ratio; camera.y = cy - (cy - camera.y) * ratio; camera.zoom = next; applyCamera();
}
function resetCamera() {
    const view = $('#graph-scroll'); camera.zoom = 1; camera.x = view.clientWidth / 2 - camera.rootX; camera.y = 8; applyCamera();
}
function revealNode(id) {
    const el = $(`[data-node="${id}"]`); if (!el) return;
    camera.zoom = Math.max(.85, camera.zoom); applyCamera();
    const view = $('#graph-scroll').getBoundingClientRect(), rect = el.getBoundingClientRect();
    camera.x += view.left + (view.width - rect.width) / 2 - rect.left;
    camera.y += view.top + (view.height - rect.height) / 2 - rect.top;
    applyCamera();
}
let readingIntent=0;
for(const event of ['wheel','touchstart','pointerdown','keydown'])document.addEventListener(event,()=>readingIntent++,{passive:true,capture:true});
function readingPosition() {
    const pane=$('#transcripts'),top=pane.getBoundingClientRect().top;
    const segment=[...pane.querySelectorAll('[data-segment]')].find(el=>el.getBoundingClientRect().bottom>top);
    const message=segment&&[...segment.querySelectorAll('[data-message]')].find(el=>el.getBoundingClientRect().bottom>top);
    const target=message||segment;
    return {branchId:state.branchId,scroll:pane.scrollTop,key:message?'message':'segment',id:target?.dataset[message?'message':'segment'],offset:target?target.getBoundingClientRect().top-top:0,
        heights:new Map([...pane.querySelectorAll('[data-segment]')].map(el=>[el.dataset.segment,el.getBoundingClientRect().height])),
        details:[...pane.querySelectorAll('details[open]')].map(el=>{const chat=el.closest('[data-message]'),parent=chat||pane;return {chat:chat?.dataset.message,index:[...parent.querySelectorAll('details')].indexOf(el)};})};
}
function restoreReadingPosition(saved) {
    if(!saved||saved.branchId!==state.branchId)return;
    const pane=$('#transcripts');
    for(const el of pane.querySelectorAll('[data-segment]')){const height=saved.heights.get(el.dataset.segment);if(height)el.style.containIntrinsicSize='auto '+height+'px';}
    for(const item of saved.details){const parent=item.chat?[...pane.querySelectorAll('[data-message]')].find(el=>el.dataset.message===item.chat):pane,detail=parent?.querySelectorAll('details')[item.index];if(detail){detail.open=true;detail.dispatchEvent(new Event('toggle'));}}
    const align=()=>{const target=[...pane.querySelectorAll('[data-'+saved.key+']')].find(el=>el.dataset[saved.key]===saved.id),offset=target?target.getBoundingClientRect().top-pane.getBoundingClientRect().top:null;pane.scrollTo({top:offset===null?saved.scroll:pane.scrollTop+offset-saved.offset,behavior:'instant'});};
    align();const intent=readingIntent,ticket=requestId;
    const settle=remaining=>requestAnimationFrame(()=>{if(ticket===requestId&&saved.branchId===state.branchId&&readingIntent===intent){align();scheduleRibbons();if(remaining>1)settle(remaining-1);}});settle(2);
}
function sameDetail(a,b) {
    return a&&b&&a.id===b.id&&a.version===b.version&&a.name===b.name&&a.view===b.view&&a.projectArchived===b.projectArchived&&JSON.stringify(a.paths.map(p=>[p.branchId,p.originalTitle,p.transcriptionTitle]))===JSON.stringify(b.paths.map(p=>[p.branchId,p.originalTitle,p.transcriptionTitle]));
}
async function refresh({ checkCloud = false } = {}) {
    if (opening || document.body.classList.contains('session-dragging')) return;
    const id = ++requestId, scope = state.scope;
    if (scope === 'trash') {
        const [trash, status] = await Promise.all([api('/trash'), api('/status')]);
        if (id !== requestId || scope !== state.scope || document.body.classList.contains('session-dragging')) return;
        Object.assign(state.data, status, trash); state.list = { items: [], sessionCount: 0 }; render(); return;
    }
    const [data, list, tree] = await Promise.all([api('/state'), api('/list?scope=' + encodeURIComponent(state.scope) + '&q=' + encodeURIComponent(state.query) + (checkCloud ? '&check=1' : '')), state.tree ? api('/trees/' + encodeURIComponent(state.tree.id) + '?view=' + (state.scope === 'archived' ? 'archived' : 'in-use')) : null]);
    if (id !== requestId || scope !== state.scope || document.body.classList.contains('session-dragging')) return;
    const keepDetail=sameDetail(state.tree,tree),reading=state.tree&&!keepDetail?readingPosition():null,oldNode=selectedNode();
    state.data = data; state.list = list;
    state.selected = new Set([...state.selected].filter(id => list.items.some(i => i.id === id)||scope==='archived'&&(data.trashNative||[]).some(i=>'client:'+i.id===id)));
    if (tree && tree.view !== (scope === 'archived' ? 'archived' : 'in-use')) return;
    if (tree) {
        state.tree = tree.paths.length ? (keepDetail?Object.assign(state.tree,{sessionNameVersion:tree.sessionNameVersion}):tree) : null;
        if (!state.tree) { clearRange(); render(); return; } if (!route()) state.branchId = tree.paths[0]?.branchId;
        if (state.nodeId&&!tree.nodes.some(n => n.id === state.nodeId)) state.nodeId = tree.nodes.find(n=>n.branchIds.includes(state.branchId)&&n.chatIds.some(id=>oldNode?.chatIds.includes(id)))?.id || oldNode?.parentIds.find(id=>tree.nodes.some(n=>n.id===id&&n.branchIds.includes(state.branchId))) || null;
        state.chats = new Set([...state.chats].filter(id => route()?.messages.some(m => m.id === id)));
    }
    const listTop = $('#session-list').scrollTop, graphTop = $('#graph-scroll').scrollTop, graphLeft = $('#graph-scroll').scrollLeft;
    render({keepDetail}); $('#session-list').scrollTo({top:listTop,behavior:'instant'}); restoreReadingPosition(reading); $('#graph-scroll').scrollTo({top:graphTop,left:graphLeft,behavior:'instant'}); scheduleRibbons();revealRestored();
    const pending=$('#pending-uploads');if(!pending.hidden&&pending.dataset.version&&pending.dataset.version!==state.data.stateVersion&&!pendingFetch)showPendingUploads(true);
}
function moveDialog(itemIds, restoreTarget = null) {
    const selectedItems=state.data.items.filter(i=>itemIds.includes(i.id));
    const projects = state.data.projects.filter(p => !p.archived && (p.builtin || p.count > 0 || state.data.items.some(i => i.projectId === p.id)) && !selectedItems.every(i=>(i.projectId||INBOX)===p.id));
    modal(restoreTarget ? 'Restore to project' : 'Move to project', `<label class="field">${t('Destination project')}<select name="projectId" id="destination">${projects.map(p => `<option value="${esc(p.id)}">${esc(p.builtin?t('Ungrouped'):p.name)}</option>`).join('')}<option value="new">${t('New project…')}</option></select></label><div id="new-project-field" ${projects.length ? 'hidden' : ''}>${field('Project name', 'projectName')}</div>`, async form => {
        const projectId = form.get('projectId');
        if (restoreTarget) await api('/manage', 'POST', { ...restoreTarget, action: 'restore', ...(projectId === 'new' ? { projectName: form.get('projectName') } : { destinationProjectId: projectId }) });
        else await api('/move', 'POST', { itemIds, ...(projectId === 'new' ? { projectName: form.get('projectName') } : { projectId }) });
        state.selected.clear(); toast(t(restoreTarget ? 'Restored to project' : 'Moved to project'));
    }, restoreTarget ? 'Restore' : 'Move');
    $('#destination').onchange = e => $('#new-project-field').hidden = e.target.value !== 'new';
    enhanceSelect($('#destination'));
}
function restore(target) { return run(async()=>{const result=await trashRequest('/manage',{...target,action:'restore'},'restore');state.restoredBranchIds=result.branchIds;state.tree=null;state.scope=PROJECTS;state.query='';$('#search').value='';state.selected.clear();}); }

function clearRange() { state.chats.clear(); state.rangeStart = null; state.rangeEnd = null; }

function trashDialog(target,count=1){
    const days=state.data.preferences?.trashRetentionDays||30;
    modal('Move to Trash',`<p>${t('Discard {count} complete paths or trees?',{count})}</p><p class="dialog-copy">${t('Recoverable on this device for {days} days.',{days})}</p>`,async()=>{const result=await trashRequest('/trash',target,'trash');state.trashFeedback=(result.blocked||[]).map(e=>t(e.reason)).join('\n');state.tree=null;state.selected.clear();clearRange();},'Move to Trash');
}
function archivePath(){const p=route(),node=selectedNode();if(!node?.endBranchIds.includes(p.branchId))return;trashDialog({branchIds:[p.branchId],nodeId:node.id,version:state.tree.version});}
function recoveryCategories(rows){
    return projectGroups(rows.flatMap(r=>(r.projectIds?.length?r.projectIds:[INBOX]).map(projectId=>({...r,projectId,updatedAt:r.at||''}))),state.data.projects);
}
function recoveryGroups(rows,row,kind){
    return recoveryCategories(rows).map(g=>`<section class="list-group project-group" data-recovery-project="${esc(g.id)}"><h2>${projectName(g.id,g.id===INBOX?t('Ungrouped'):g.name)}<span class="group-actions"><span>${g.items.length}</span><input type="checkbox" data-${kind}-group="${esc(g.id)}" aria-label="${esc(t('Select group {name}',{name:g.name}))}"></span></h2>${g.items.map(row).join('')}</section>`).join('');
}
function bindRecoveryGroups(rows,kind,render){
    const groups=recoveryCategories(rows);
    $$(`[data-${kind}-group]`).forEach(el=>{
        const items=groups.find(g=>g.id===el.getAttribute(`data-${kind}-group`)).items,count=items.filter(r=>state.selected.has(r.key)).length;
        el.checked=count===items.length;el.indeterminate=count>0&&count<items.length;
        el.onchange=()=>{for(const r of items)el.checked?state.selected.add(r.key):state.selected.delete(r.key);render();};
    });
}
function revealRestored(){
    if(!state.restoredBranchIds?.length||state.scope!==PROJECTS)return;
    const ids=new Set(state.restoredBranchIds),items=state.list.items.filter(i=>i.sessionIds.some(id=>ids.has(id)));
    if(!items.length)return;
    state.restoredBranchIds=null;state.olderProjects=true;
    for(const item of items)state.expandedProjects.add(item.projectId||INBOX);
    renderList();focusProject(items[0].projectId||INBOX);
    const rows=items.map(i=>$$('[data-item]').find(el=>el.dataset.item===i.id)).filter(Boolean);
    rows[0]?.scrollIntoView({block:'center',behavior:'instant'});
    for(const row of rows){row.classList.add('restored-highlight');row.addEventListener('animationend',()=>row.classList.remove('restored-highlight'),{once:true});}
}
function renderClientArchive(){
    $('#list-title').textContent=t('Client archive');$('#active-notice').hidden=true;
    const query=state.query.toLocaleLowerCase(),copies=(state.data.trashNative||[]).filter(i=>i.clientArchived&&(!i.background||state.data.preferences?.showScheduledSessions)&&(!query||(i.title||'').toLocaleLowerCase().includes(query)));
    const copyBranches=new Set(copies.map(i=>i.branchId));
    const rows=[...copies.map(i=>({key:'client:'+i.id,id:i.id,kind:'native',branchIds:[i.branchId],name:i.title||i.agent,agent:i.agent,at:i.updatedAt,projectIds:[i.projectId||INBOX]})),...state.list.items.filter(i=>!i.sessionIds.every(id=>copyBranches.has(id))).map(i=>({key:i.id,id:i.id,kind:'legacy',branchIds:i.sessionIds,name:i.name,agent:i.agent,at:i.updatedAt,projectIds:[i.projectId||INBOX]}))];
    const visible=new Set(rows.map(r=>r.key));state.selected=new Set([...state.selected].filter(id=>visible.has(id)));
    const selected=rows.filter(r=>state.selected.has(r.key));$('#list-count').textContent=t('{count} sessions',{count:rows.length});
    $('#list-actions').innerHTML='<button id="archive-select-all"></button>'+(selected.length?'<button id="archive-restore"></button><button id="archive-move-trash"></button>':'');
    button('#archive-select-all',state.selected.size?'Deselect':'Select all',()=>{state.selected=state.selected.size?new Set():new Set(rows.map(r=>r.key));renderClientArchive();});
    button('#archive-restore','Restore to Projects',()=>restore({branchIds:[...new Set(selected.flatMap(r=>r.branchIds))]}));
    button('#archive-move-trash','Move to Trash',()=>run(async()=>{
        const native=selected.filter(r=>r.kind==='native'),legacy=selected.filter(r=>r.kind==='legacy');
        if(native.length){const result=await trashRequest('/trash/native',{instanceIds:native.map(r=>r.id)},'recovery');if(result.blocked.length)throw Error(result.blocked.map(e=>e.reason).join('\n'));}
        if(legacy.length)await trashRequest('/trash',{itemIds:legacy.map(r=>r.id),view:'archived'},'trash');
        state.scope='trash';state.selected.clear();state.query='';$('#search').value='';
    }));
    const archiveRow=r=>`<article class="session-row ${state.selected.has(r.key)?'checked':''}"><div class="row-open trash-copy"><span class="row-text"><span class="row-title">${esc(r.name)}</span><span class="row-meta">${r.agent==='codex'?'Codex':'Claude Code'}</span></span><time class="row-date">${date(r.at)}</time></div><input type="checkbox" data-client-select="${esc(r.key)}" aria-label="${esc(t('Select {name}',{name:r.name}))}" ${state.selected.has(r.key)?'checked':''}></article>`;
    $('#session-list').innerHTML=recoveryGroups(rows,archiveRow,'client')||`<p class="empty">${t('No archived sessions.')}</p>`;
    bindRecoveryGroups(rows,'client',renderClientArchive);
    $$('[data-client-select]').forEach(el=>el.onchange=()=>{el.checked?state.selected.add(el.dataset.clientSelect):state.selected.delete(el.dataset.clientSelect);renderClientArchive();});
}
function renderTrash(){
    $('#list-title').textContent=t('Trash');$('#active-notice').hidden=true;
    const query=state.query.toLocaleLowerCase(),entries=(state.data.trashEntries||[]).filter(e=>!e.expired&&!e.restoredAt&&(!query||e.names.some(n=>n.toLocaleLowerCase().includes(query)))),copies=[];
    const rows=[...entries.map(e=>({key:'recovery:'+e.id,id:e.id,kind:'recovery',name:e.names.join(', '),projectIds:e.projectIds||[INBOX],at:e.at,description:t('Local recovery until {date}',{date:date(e.expiresAt)})})),...copies.map(i=>({key:'native:'+i.id,id:i.id,kind:'native',name:i.title||i.agent,agent:i.agent,at:i.updatedAt,description:t(i.archived?'Archived in client':i.active?'Client copy still present':'Inactive client copy')}))];
    const visible=new Set(rows.map(r=>r.key));state.selected=new Set([...state.selected].filter(id=>visible.has(id)));
    const recovery=rows.filter(r=>r.kind==='recovery'&&state.selected.has(r.key)),native=rows.filter(r=>r.kind==='native'&&state.selected.has(r.key));
    const cleanup=(state.data.trashNative||[]).filter(i=>i.discarded&&recovery.some(r=>entries.find(e=>e.id===r.id)?.branchIds.includes(i.branchId)));
    $('#list-count').textContent=t('{count} copies',{count:rows.length});$('#search').placeholder=t('Search discarded titles…');
    $('#list-actions').innerHTML='<button id="trash-select-all"></button>'+(native.length?'<button id="trash-move-selected"></button>':'')+(recovery.length?'<button id="trash-restore-selected"></button><button id="trash-delete-selected"></button>':'')+(cleanup.length?'<button id="trash-cleanup-selected"></button>':'');
    button('#trash-cleanup-selected','Finish removal',()=>run(async()=>{const result=await trashRequest('/trash/native',{instanceIds:cleanup.map(i=>i.id)},'recovery');state.trashFeedback=result.blocked.map(e=>t(e.reason)).join('\n');}));
    button('#trash-select-all',state.selected.size?'Deselect':'Select all',()=>{state.selected=state.selected.size?new Set():new Set(rows.map(r=>r.key));renderTrash();});
    button('#trash-move-selected',t('Move to recovery ({count})',{count:native.length}),()=>run(async()=>{
        const result=await trashRequest('/trash/native',{instanceIds:native.map(r=>r.id)},'recovery');
        state.trashFeedback=result.blocked.map(b=>`${native.find(r=>r.id===b.instanceId)?.name||''}: ${t(b.reason)}`).join('\n');
        for(const id of result.moved)state.selected.delete('native:'+id);
        if(result.moved.length)toast(t('Moved {count} copies to recovery.',{count:result.moved.length}));
    }));
    button('#trash-restore-selected',t('Restore ({count})',{count:recovery.length}),()=>run(async()=>{
        const result=await trashRequest('/trash/recovery',{action:'restore',ids:recovery.map(r=>r.id)},'restore');
        state.trashFeedback=result.failed.map(e=>t(e.reason)).join('\n');for(const r of result.restored)state.selected.delete('recovery:'+r.id);
        if(result.restored.length){state.restoredBranchIds=result.restored.flatMap(r=>r.branchIds);state.tree=null;state.scope=PROJECTS;state.query='';$('#search').value='';state.projectFocus=result.restored[0].projectIds[0]||INBOX;state.selected.clear();state.expandedProjects.add(state.projectFocus);toast(t('Restored to Projects'));}
    }));
    button('#trash-delete-selected',t('Delete now ({count})',{count:recovery.length}),()=>modal('Delete recovery copies',`<p>${t('Permanently delete {count} local recovery copies?',{count:recovery.length})}</p>`,async()=>{await trashRequest('/trash/recovery',{action:'delete',ids:recovery.map(r=>r.id)},'delete');state.trashFeedback='';state.selected.clear();},'Delete now'));
    const row=r=>`<article class="session-row ${state.selected.has(r.key)?'checked':''}"><div class="row-open trash-copy"><span class="row-text"><span class="row-title">${esc(r.name)}</span><span class="row-meta">${esc(r.description)}${r.agent?' · '+esc(r.agent==='codex'?'Codex':'Claude'):''}</span></span><time class="row-date">${esc(date(r.at))}</time></div><input type="checkbox" data-trash-select="${esc(r.key)}" aria-label="${esc(t('Select {name}',{name:r.name}))}" ${state.selected.has(r.key)?'checked':''}></article>`;
    $('#session-list').innerHTML=(state.trashFeedback?`<p class="trash-feedback" role="status">${esc(state.trashFeedback)}</p>`:'')+recoveryGroups(rows,row,'trash')+(!rows.length?`<p class="empty">${t('Trash is empty.')}</p>`:'');
    bindRecoveryGroups(rows,'trash',renderTrash);
    $$('[data-trash-select]').forEach(el=>el.onchange=()=>{el.checked?state.selected.add(el.dataset.trashSelect):state.selected.delete(el.dataset.trashSelect);renderTrash();});
    renderCloudStatus();
}

function directoryField(value) { return `<label class="field">${t('Working directory')}<span class="directory-field"><input name="cwd" readonly value="${esc(value||'')}"><button type="button" id="choose-directory">${t('Choose folder')}</button></span></label>`; }
function bindDirectoryPicker() {
    $('#choose-directory').onclick=async()=>{
        const input=$('[name=cwd]'),picker=document.createElement('dialog');picker.className='directory-picker';document.body.append(picker);
        let selected=input.value,request=0;
        picker.innerHTML=`<div class="dialog-heading"><h2>${t('Working directory')}</h2><button type="button" data-close>×</button></div><div class="directory-toolbar"><button type="button" data-home>${t('Home')}</button><button type="button" data-parent>${t('Parent folder')}</button></div><p class="directory-path"></p><div class="directory-folders"></div><p class="directory-error" role="alert"></p><div class="dialog-actions"><button type="button" data-choose>${t('Use this folder')}</button></div>`;
        picker.querySelector('[data-close]').onclick=()=>picker.close();picker.onclose=()=>picker.remove();picker.showModal();
        const choose=picker.querySelector('[data-choose]');choose.disabled=true;
        async function load(directory){const ticket=++request;choose.disabled=true;try{const data=await api('/directories?path='+encodeURIComponent(directory||''));if(!picker.open||request!==ticket)return;selected=data.path;picker.querySelector('.directory-path').textContent=data.path;picker.querySelector('.directory-error').textContent='';picker.querySelector('.directory-folders').innerHTML=data.folders.map((f,i)=>`<button type="button" data-folder="${i}">${esc(f.name)}</button>`).join('');picker.querySelectorAll('[data-folder]').forEach(el=>el.onclick=()=>load(data.folders[el.dataset.folder].path));picker.querySelector('[data-parent]').disabled=data.parent===data.path;picker.querySelector('[data-parent]').onclick=()=>load(data.parent);picker.querySelector('[data-home]').onclick=()=>load(data.home);choose.disabled=false;}catch(e){picker.querySelector('.directory-error').textContent=e.message;}}
        choose.onclick=()=>{input.value=selected;input.dispatchEvent(new Event('input',{bubbles:true}));picker.close();};await load(selected);
    };
}
async function activateDialog(p) {
    const node = selectedNode(); if (!node) return;
    const selection = { branchId: p.branchId, nodeId: node.id, version: state.tree.version };
    try {
        const d = await api('/branches/' + p.branchId), local = state.data.instances.find(i => i.branchId === p.branchId && i.applied);
        let checked = null, checkedPath = null, generation = 0;
        modal('Activate', `<p><strong>${t('Title in your tool')}</strong><br><span id="activation-title"></span></p>${directoryField(local?.cwd || d.cwd)}<div id="activation-budget" role="status">${t('Loading…')}</div><button type="button" id="activate-as">${t('Switch tool')}</button>`, async form => {
            if (!checked || checkedPath !== form.get('cwd')) { await estimate(); if (!checked || checked.risk) return false; }
            if (!checked.complete) return false;
            const result = await api('/node-activation/activate', 'POST', { ...selection, cwd: form.get('cwd'), contextAcknowledgement: checked.fingerprint });
            state.branchId = result.branch.id; state.nodeId = result.nodeId; clearRange();
            toast(t('Session activated. Use Open in VS Code to continue.'));
        }, 'Confirm activation');
        const ticket = modalVersion, cwd = $('[name=cwd]');
        bindDirectoryPicker();
        async function estimate() {
            const turn = ++generation, directory = cwd.value; checked = null; $('#dialog-submit').disabled = true;
            try {
                const c = await api('/node-activation/check', 'POST', { ...selection, cwd: directory });
                if (ticket !== modalVersion || turn !== generation || !$('#dialog').open) return;
                checked = c; checkedPath = directory;
                $('#activation-title').textContent = c.title;
                $('#activation-budget').innerHTML = `${c.estimated == null ? '' : `<p>${c.estimateIncomplete ? t('Token estimate unavailable after encrypted compaction') : `≈ ${compactNumber(c.estimated)} tokens`}</p>${c.window ? `<p class="context-limit">${t('Context capacity')}: ${compactNumber(c.window)} tokens</p>` : ''}${c.compactAt ? `<p class="context-limit">${t('Compaction threshold')}: ${compactNumber(c.compactAt)} tokens</p>` : ''}`}${!c.complete ? `<p class="warning">${t(c.readiness === 'node-boundary' ? 'This node does not end at a completed turn. Select a completed node.' : 'This context is incomplete or unsupported. Check Source before activating.')}</p>` : c.risk ? `<p class="warning">${t('Context may be near its limit. Confirm before activating.')}</p>` : ''}`;
                $('#dialog-submit').disabled = !c.complete; $('#dialog-submit').textContent = t(c.risk ? 'Activate anyway' : 'Confirm activation');
            } catch (e) { if (ticket === modalVersion && turn === generation) $('#dialog-error').textContent = e.message; }
        }
        cwd.oninput = () => { checked = null; generation++; $('#dialog-submit').disabled = true; estimate(); };
        $('#activate-as').onclick = () => conversionDialog(p, selection, cwd.value);
        $('#activate-as').dataset.modalAction='true';
        $('#dialog-submit').before($('#activate-as'));
        await estimate();
    } catch (e) { toast(e.message); }
}
const modeName = mode => ({lean:'Balanced',full:'Complete text',messages:'Messages only'})[mode];
const contextCopy = mode => t(({lean:'Keeps messages, tool calls and errors. Shortens long read-only results.',full:'Keeps messages and full tool inputs/results.',messages:'Keeps user and assistant messages. Omits tool calls and results.'})[mode]);
async function conversionDialog(p, selection = {}, initialCwd = null) {
    try {
        const d = await api('/branches/' + p.branchId), target = p.agent === 'claude' ? 'codex' : 'claude';
        let previews = {}, checkedCwd = null, generation = 0, timer;
        modal('Activate as…', `<p>${p.agent==='claude'?'Claude':'Codex'} → ${target==='claude'?'Claude':'Codex'}</p>${directoryField(initialCwd || d.cwd)}<label class="field">${t('Context mode')}<select name="mode" aria-label="${t('Context mode')}">${['lean','full','messages'].map(mode=>`<option value="${mode}">${t(modeName(mode))}</option>`).join('')}</select></label><div id="conversion-preview" role="status"></div>`, async form => {
            const mode=form.get('mode'), cwd=form.get('cwd'), preview=previews[mode];
            if(!preview || checkedCwd!==cwd){await estimate();return false;}
            const result=await api('/convert','POST',{...selection,branchId:p.branchId,target,mode,cwd,fingerprint:preview.fingerprint,contextAcknowledgement:preview.budget.fingerprint});
            state.scope='active:'+target;state.tree=await api('/trees/'+encodeURIComponent(result.branch.id));state.branchId=result.branch.id;state.nodeId=state.tree.paths.find(path=>path.branchId===result.branch.id)?.nodeIds.at(-1);camera.newView=true;clearRange();toast(t('Session activated. Use Open in VS Code to continue.'));
        }, 'Activate');
        bindDirectoryPicker();
        const ticket=modalVersion, select=$('[name=mode]'), cwd=$('[name=cwd]');
        enhanceSelect(select);
        function show(){
            const preview=previews[select.value]; $('#dialog-submit').disabled=!preview || checkedCwd!==cwd.value;
            $('#conversion-preview').innerHTML=`<p class="dialog-copy">${contextCopy(select.value)}</p>${preview?`<p><strong>${t('Title in your tool')}</strong><br>${esc(preview.title)}</p><p>≈ ${preview.estimated.toLocaleString()} tokens · ${preview.stats.shortenedOutputs ? t('{count} shortened results',{count:preview.stats.shortenedOutputs}):''}</p>${preview.budget.risk?`<p class="warning">${t('Context may be near its limit: about {used} tokens, planning limit {limit}.',{used:compactNumber(preview.estimated),limit:compactNumber(preview.budget.window||preview.budget.compactAt)})}</p>`:''}`:''}`;
            $('#dialog-submit').textContent=t(preview?.budget.risk?'Activate anyway':'Activate');
        }
        async function estimate(){
            const turn=++generation, directory=cwd.value;show();
            try{const values=await Promise.all([api('/conversion-check','POST',{...selection,branchId:p.branchId,target,mode:select.value,cwd:directory})]);
                if(ticket!==modalVersion||turn!==generation||!$('#dialog').open)return;
                checkedCwd=directory;previews={...previews,...Object.fromEntries(values.map(v=>[v.mode,v]))};
                for(const option of select.options)option.textContent=t(modeName(option.value))+(previews[option.value]?' · ≈ '+previews[option.value].estimated.toLocaleString()+' tokens':'');
                enhanceSelect(select);show();
            }catch(e){if(ticket===modalVersion&&turn===generation)$('#dialog-error').textContent=e.message;}
        }
        select.onchange=()=>{show();if(!previews[select.value])estimate();};cwd.oninput=()=>{generation++;previews={};show();clearTimeout(timer);timer=setTimeout(estimate,350);};
        await estimate();
    } catch(e){toast(e.message);}
}

function saveOrganization(action, name) { return api('/trees/' + state.tree.id, 'POST', { version: state.tree.version, pathId: state.branchId, chatIds: [...state.chats], action, name }); }
function combineDialog() {
    const p = route(), positions = p.messages.map((m, i) => state.chats.has(m.id) ? i : -1).filter(i => i >= 0);
    if (positions.at(-1) - positions[0] + 1 !== positions.length) return toast(t('Combine requires consecutive chats.'));
    modal('Combine', field('Node title', 'name'), async form => { await saveOrganization('combine', form.get('name')); clearRange(); }, 'Combine');
}
async function showSource() {
    try {
        const d = await api('/branches/' + state.branchId);
        const operation=value=>t(({import:'Imported history',capture:'Captured client changes',fork:'Created continuation','native-settings':'Client settings update',conversion:'Converted context','shared-prefix':'Shared history','native-fork-snapshot':'Shared history'})[value]||'Saved revision');
        const field=(label,value)=>`<p class="source-title-line"><span>${esc(t(label))}:</span> ${esc(value)}</p>`;
        const originalTitle=d.originalTitle||d.nativeObservedTitle||d.instances.find(i=>i.observedTitle)?.observedTitle;
        modal('Source & revisions', `${originalTitle?field('Original client title',originalTitle):''}${d.sessionAutomaticName?field('Automatic name',d.sessionNameOrigin==='automatic'?d.sessionName:d.sessionAutomaticName.name):''}${d.cwd?field('Working directory',d.cwd):''}${[...new Set(d.instances.map(i=>i.file).filter(Boolean))].map(file=>field('Transcript file',file)).join('')}${d.instances.some(i=>i.nativeId)?field('Client session ID',[...new Set(d.instances.map(i=>i.nativeId).filter(Boolean))].join(' · ')):''}${d.warnings.map(w=>`<p class="warning">${esc(errorText(w))}</p>`).join('')}<section class="source-history"><h3>${t('Capture changes')}</h3><ul>${d.lineage.map(r=>`<li><span>${esc(operation(r.source?.operation))}</span><time datetime="${esc(r.createdAt)}">${esc(date(r.createdAt))}</time></li>`).join('')}</ul></section>`, null);
    } catch (e) { toast(e.message); }
}
function contextSelect(name,value,context,compact=false) {
    const fallback=compact?context.defaultCompactAt:context.defaultWindow;
    const values=[...new Set([...(context.windowOptions||[]),value].filter(n=>n>0))].sort((a,b)=>b-a);
    return `<select name="${name}"><option value="" ${value==null?'selected':''}>${t('Default')} (${fallback?Number(fallback).toLocaleString():t('Model default')})</option>${values.map(n=>`<option value="${n}" ${n===value?'selected':''}>${n.toLocaleString()}${!compact&&n===context.maxWindow?' · '+t('Maximum'):!compact&&n===context.defaultWindow?' · '+t('Client default'):''}</option>`).join('')}</select>`;
}
async function settings(options = {}) {
    try {
        const c = await api('/settings'), edit = options.editConnection || !c.verified;
        const p = c.preferences, smart=c.intelligence||{},contexts=c.context||{},startup=c.autostart||{supported:false,enabled:false};
        modal('Settings', `
          <section class="settings-card" id="startup-settings"><div class="settings-section-heading"><h3>${t('Local service')}</h3><span id="startup-state" role="status" class="setting-state" data-state="${startup.busy?'saving':startup.error?'error':!startup.supported?'unavailable':startup.enabled?'on':'off'}">${esc(t(startup.busy?'Updating':startup.error||(!startup.supported?startup.reason||'Unavailable':startup.enabled?'Enabled':'Disabled')))}</span></div><label class="timer-row"><span>${t('Start automatically at login')}</span><input type="checkbox" name="startAtLogin" ${startup.enabled?'checked':''} ${!startup.supported||startup.error||startup.busy?'disabled':''}></label></section>
          <section class="settings-card" id="git-settings"><div class="settings-section-heading"><h3>${t('Git repository')}</h3>${!edit ? `<span class="setting-ok">✓ ${t('Connected')}</span><button type="button" id="modify-connection">${t('Modify')}</button>` : ''}</div>
          ${edit ? `<p class="settings-hint">${t('Optional: connect an empty private GitHub repository or an existing Grove library using its SSH address. Set up Git SSH access on this computer first. Local Update works without Git sync.')}</p>` : ''}<div class="settings-input-action"><label class="field">${t('Repository address')}<input name="url" type="text" value="${esc(c.url)}" placeholder="git@github.com:owner/repository.git" ${!edit ? 'disabled' : ''}></label>

          ${edit ? `<button type="button" id="verify-connection" class="primary">${t('Verify and connect')}</button>` : ''}</div><p class="settings-error" id="git-settings-error" role="alert"></p>
</section>
          <section class="settings-card" id="intelligence-settings"><div class="settings-section-heading"><h3>${t('Smart organization')}</h3><span class="context-limit">GPT-6 Luna</span></div>
          <div class="settings-input-action"><label class="field">${t('OpenAI API key')}<input type="password" name="intelligenceKey" autocomplete="off" placeholder="${t(smart.hasKey?'Key saved':'Add an API key')}" value="" ${smart.hasKey?'disabled':''}></label>
          ${smart.hasKey?`<button type="button" id="remove-intelligence-key">${t('Remove key')}</button>`:`<button type="button" id="save-intelligence-key" disabled>${t('Verify key')}</button>`}</div><p class="settings-error" id="key-settings-error" role="alert"></p>
          <label class="timer-row"><span>${t('Name sessions and classify new inbox entries')}</span><input type="checkbox" name="smartClassify" ${smart.classify?'checked':''} ${!smart.hasKey?'disabled':''}></label>
          <label class="timer-row"><span>${t('Name branch points and compacted nodes')}</span><input type="checkbox" name="smartNodes" ${smart.nameNodes?'checked':''} ${!smart.hasKey?'disabled':''}></label>
          <label class="timer-row"><span>${t('Update transcription titles on new nodes')}</span><input type="checkbox" name="smartTranscripts" ${smart.nameTranscripts?'checked':''} ${!smart.hasKey||!smart.transcriptionSupport?.supported?'disabled':''}></label>${smart.transcriptionSupport?.supported?'':`<p class="dialog-copy">${esc(t(smart.transcriptionSupport?.reason||'A compatible Codex VS Code client is required for live transcription-title updates.'))}</p>`}
          <label class="timer-row smart-scheduling"><span>${t('Concurrent requests')}</span><select name="smartConcurrency">${[1,2,3,4].map(n=>`<option value="${n}" ${n===(smart.concurrency??2)?'selected':''}>${n===1?t('1 (serial)'):n}</option>`).join('')}</select></label>
          <label class="timer-row"><span>${t('Minimum request interval')}</span><span class="timer-interval"><input type="number" name="smartInterval" min="0" max="60" step="0.1" value="${smart.minIntervalSeconds??0}" aria-label="${t('Minimum request interval')}"><span>${t('seconds')}</span></span></label>
          <p id="intelligence-status" role="status"></p><button type="button" id="retry-intelligence" ${!smart.error?'hidden':''}>${t('Retry')}</button>
          </section>
          <section class="settings-card" id="native-context-settings"><h3>${t('Context windows')}</h3>
          ${['codex','claude'].map(agent=>{const context=contexts[agent]||{};return `<div class="native-context-tool"><strong>${agent==='codex'?'Codex':'Claude Code'}${context.profile?' · '+esc(context.profile):''}</strong>${context.error?`<p class="dialog-copy">${esc(errorText(context.error))}</p>`:`<div class="context-inputs"><label class="field">${t(agent==='codex'?'Context window (tokens)':'Auto-compact window (tokens)')}${contextSelect(agent+'Window',context.window,context)}</label>${agent==='codex'?`<label class="field">${t('Auto-compact at (tokens)')}${contextSelect('codexCompactAt',context.compactAt,context,true)}</label>`:''}</div>${agent==='codex'&&context.compactScope==='body_after_prefix'?`<p class="dialog-copy">${t('Compaction counts new context after the previous summary.')}</p>`:''}${agent==='claude'&&context.compactPercent?`<p class="dialog-copy">${t('Existing compaction percentage: {count}%',{count:context.compactPercent})}</p>`:''}`}</div>`;}).join('')}
          <p id="context-settings-status" role="status"></p></section>
          <section class="settings-card"><h3>${t('Trash')}</h3><label class="field">${t('Local recovery days')}<input type="number" name="trashRetentionDays" min="1" max="365" value="${p.trashRetentionDays}"></label></section><section class="settings-card"><h3>${t('Project contents')}</h3><label class="field">${t('Collapse older sessions')}<select name="projectFoldMode">${[['time','By age'],['count','By count'],['none','Show all']].map(([v,l])=>`<option value="${v}" ${p.projectFoldMode===v?'selected':''}>${t(l)}</option>`).join('')}</select></label><label class="field" data-fold="time" ${p.projectFoldMode==='time'?'':'hidden'}>${t('Keep recent days')}<input type="number" name="projectFoldDays" min="1" max="365" value="${p.projectFoldDays}"></label><label class="field" data-fold="count" ${p.projectFoldMode==='count'?'':'hidden'}>${t('Visible sessions per project')}<input type="number" name="projectFoldCount" min="1" max="365" value="${p.projectFoldCount}"></label></section><section class="settings-card"><h3>${t('Automatic updates')}</h3><div class="timer-row"><label><input type="checkbox" name="showScheduledSessions" ${p.showScheduledSessions?'checked':''}>${t('Show scheduled and background sessions')}</label></div>

            ${[['localUpdate', 'Read local sessions', p.localUpdateEnabled, p.localUpdateMinutes], ['autoUpload', 'Automatically upload local changes', p.autoUploadEnabled, p.autoUploadMinutes]].map(([key,label,on,minutes]) => `<div class="timer-row"><label><input type="checkbox" name="${key}Enabled" ${on ? 'checked' : ''}>${t(label)}</label><label class="timer-interval"><input type="number" name="${key}Minutes" value="${minutes}" min="1" max="1440" ${!on ? 'disabled' : ''}><span>${t('minutes')}</span></label></div>`).join('')}
          </section>`, null);
        $('#dialog-cancel').textContent = t('Close');
        if(options.focusSync){$('#git-settings').scrollIntoView({block:'start'});$('#git-settings input').focus();}
        const busy = async (button, fn) => { if (working) return; working = true; button.disabled = true; const original = button.textContent; button.textContent = t(['verify-connection','save-intelligence-key'].includes(button.id)?'Verifying connection…':'Working…'); const error=$(['verify-connection'].includes(button.id)?'#git-settings-error':['save-intelligence-key','remove-intelligence-key'].includes(button.id)?'#key-settings-error':'#dialog-error');error.textContent = '';
            try { await fn(); } catch(e) { error.textContent = e.message; } finally { working = false; renderCloudStatus(); if (button.isConnected) { button.disabled = false; button.textContent = original; } } };
        const saveSmart=async body=>{state.data.intelligence=await api('/settings/intelligence','POST',body);if('apiKey' in body||body.removeKey)await settings(options);else renderIntelligence();renderCloudStatus();};
        // Serialize saves so fast edits use the newest fingerprint and never overwrite each other.
        let saveQueue=Promise.resolve();
        const dialogError=$('#dialog-error'),contextStatus=$('#context-settings-status');
        const queueSave=fn=>{saveQueue=saveQueue.then(()=>{dialogError.textContent='';return fn();}).catch(error=>{dialogError.textContent=error.message;});};
        for(const agent of ['codex','claude'])for(const input of $$(`[name=${agent}Window]${agent==='codex'?', [name=codexCompactAt]':''}`))input.onchange=()=>{
            const window=$(`[name=${agent}Window]`),compact=$('[name=codexCompactAt]');
            const values={window:window.value===''?null:Number(window.value),...(agent==='codex'?{compactAt:compact.value===''?null:Number(compact.value)}:{})};
            queueSave(async()=>{
                contextStatus.textContent='';
                try{contexts[agent]=await api('/settings/context','POST',{agent,fingerprint:contexts[agent].fingerprint,...values});contextStatus.textContent=t('Context settings saved. Reopen your client session to apply them.');}
                catch(error){contextStatus.textContent=error.message;if(window.value===(values.window==null?'':String(values.window)))window.value=contexts[agent].window??'';if(agent==='codex'&&compact.value===(values.compactAt==null?'':String(values.compactAt)))compact.value=contexts[agent].compactAt??'';window._groveSelect?.update();compact?._groveSelect?.update();throw error;}
            });
        }
        $('[name=startAtLogin]').onchange=async e=>{
            const input=e.currentTarget,before=startup.enabled;input.disabled=true;const badge=$('#startup-state');badge.textContent=t('Updating');badge.dataset.state='saving';
            try{Object.assign(startup,await api('/settings/autostart','POST',{enabled:input.checked}));input.checked=startup.enabled;badge.textContent=t(startup.enabled?'Enabled':'Disabled');badge.dataset.state=startup.enabled?'on':'off';}
            catch(error){input.checked=before;badge.textContent=error.message+' '+t(before?'Login startup remains on.':'Login startup remains off.');badge.dataset.state='error';}
            finally{input.disabled=!startup.supported||!!startup.error;}
        };
        if($('#save-intelligence-key')){
            $('[name=intelligenceKey]').oninput=e=>{$('#save-intelligence-key').disabled=!e.target.value.trim();};
            $('#save-intelligence-key').onclick=e=>busy(e.currentTarget,()=>saveSmart({apiKey:$('[name=intelligenceKey]').value.trim()}));
        }
        if($('#remove-intelligence-key'))$('#remove-intelligence-key').onclick=e=>busy(e.currentTarget,()=>saveSmart({removeKey:true}));
        for(const [name,key] of [['smartClassify','classify'],['smartNodes','nameNodes'],['smartTranscripts','nameTranscripts']])$(`[name=${name}]`).onchange=async e=>{const input=e.currentTarget;input.disabled=true;try{await saveSmart({[key]:input.checked});input.disabled=false;}catch(error){input.checked=!input.checked;input.disabled=false;$('#dialog-error').textContent=error.message;}};
        for(const [name,key] of [['smartConcurrency','concurrency'],['smartInterval','minIntervalSeconds']])$(`[name=${name}]`).onchange=async e=>{const input=e.currentTarget,previous=state.data.intelligence[key];if(!input.checkValidity()){input.reportValidity();return;}input.disabled=true;try{await saveSmart({[key]:Number(input.value)});}catch(error){input.value=previous;$('#dialog-error').textContent=error.message;}finally{input.disabled=false;input._groveSelect?.update();}};
        $('#retry-intelligence').onclick=e=>busy(e.currentTarget,async()=>{state.data.intelligence=await api('/intelligence/retry','POST',{});renderIntelligence();});
        state.data.intelligence=smart;renderIntelligence();
        if ($('#modify-connection')) $('#modify-connection').onclick = () => settings({editConnection:true});
        if ($('#verify-connection')) {
            const input = $('[name=url]'), button = $('#verify-connection');
            const validate = () => { button.disabled = !input.value.trim(); };
            input.addEventListener('input', validate); validate();
            button.onclick = e => busy(e.currentTarget, async () => { await api('/settings/verify', 'POST', {url: input.value.trim()}); await refresh(); await settings(); });
        }
        for(const select of $$('#dialog-content select'))enhanceSelect(select);
        for(const el of $$('[name=projectFoldMode],[name=projectFoldDays],[name=projectFoldCount],[name=trashRetentionDays]'))el.onchange=()=>{
            if(!el.checkValidity()){el.reportValidity();return;}
            const key=el.name,value=key==='projectFoldMode'?el.value:Number(el.value);
            if(key==='projectFoldMode')for(const label of $$('[data-fold]'))label.hidden=label.dataset.fold!==value;
            queueSave(async()=>{await api('/settings/timers','POST',{[key]:value});state.expandedProjects.clear();await refresh();});
        };
        for(const el of $$('[name=showScheduledSessions],[name=localUpdateEnabled],[name=localUpdateMinutes],[name=autoUploadEnabled],[name=autoUploadMinutes]'))el.onchange=()=>{
            if(!el.checkValidity()){el.reportValidity();return;}
            const value=el.type==='checkbox'?el.checked:Number(el.value),key=el.name;
            for(const name of ['localUpdate','autoUpload'])$(`[name=${name}Minutes]`).disabled=!$(`[name=${name}Enabled]`).checked;
            queueSave(async()=>{await api('/settings/timers','POST',{[key]:value});await refresh();});
        }

    } catch(e) { toast(e.message); }
}
function information() {
    modal('Information', `<details open><summary>${t('Using Grove')}</summary><ul class="action-guide"><li>${t('Update reads your local sessions. Pull gets changes from your other devices. Push sends your changes after pulling.')}</li><li>${t('Activate opens the selected node and its preceding context in your tool. Deactivate is available at the active endpoint.')}</li><li>${t('A Session is a whole tree; a transcription is one client path; a node is a stretch of conversation. Pending means it has no node label yet.')}</li><li>${t('Renaming changes the Grove label. Your conversation keeps the same identity.')}</li></ul></details><details><summary>${t('Sync and recovery')}</summary><p>${t('Sessions are stored as readable files in your Git repository. Earlier versions remain in Git history.')}</p><p>${t('Changes made during upload remain queued for the next upload.')}</p><p>${t('Trash keeps a recovery copy on this device until its displayed expiry date.')}</p><p>${t('Discard restores the last synced version. New unsynced sessions are removed from Grove. A local recovery copy is kept.')}</p></details><details><summary>${t('Smart organization')}</summary><p>${t('Smart organization names each session once, including existing sessions and forks. Manual names are preserved. Automatic node names are checked again when their range changes.')}</p><p>${t('Classification uses the first human request, project names and a short workspace hint. Node naming uses the first human request and last assistant reply in that node.')}</p><p>${t('Your API key and switches stay on this device. User messages are kept complete; long assistant replies are shortened in the middle.')}</p></details><details><summary>${t('Tokens and tools')}</summary><p>${t('Token counts estimate the selected conversation and recorded tool context. Model capacity and compaction thresholds come from available model settings.')}</p>${['lean','full','messages'].map(m=>`<p><strong>${t(modeName(m))}</strong> — ${contextCopy(m)}</p>`).join('')}<p>${t('Switching tools creates a new session. Thinking and attachments remain in the original.')}</p></details>${(state.data.plan?.pendingRecovery||[]).map(id=>`<button type="button" data-recover="${esc(id)}">${t('Recover interrupted operation')}</button>`).join('')}${state.data.conflicts.length?`<button type="button" id="review-sync-conflicts">${t('Review sync conflicts')}</button>`:''}}`,null);
    const operation=state.data.cloud.operation;
    if (operation) $('#dialog-content').insertAdjacentHTML('beforeend', `<details id="transfer-diagnostics"><summary>${t('Last transfer')}</summary><dl><dt>${t('Elapsed')}</dt><dd>${Math.round(((operation.finishedAt||Date.now())-operation.startedAt)/1000)} s</dd>${operation.summary?`<dt>${t('Sessions checked')}</dt><dd>${operation.summary.checked||0}</dd><dt>${t('Items pushed')}</dt><dd>${operation.summary.published||0}</dd>`:''}</dl></details>`);
    if($('#review-sync-conflicts'))$('#review-sync-conflicts').onclick=()=>{$('#dialog').close();showPendingUploads(true);};
    $$('[data-recover]').forEach(el=>el.onclick=()=>run(async()=>{await api('/recover','POST',{id:el.dataset.recover});$('#dialog').close();}));
}
function about() {
    modal('About', `<div class="about"><h3>Session Grove <small>${esc(state.data.appVersion || '')}</small></h3><p>${t('Organize agent conversations by project. Keep the context, choose the branch, continue your work.')}</p><p>${t('Developed by')} Ziyi Zhang</p><div class="about-links"><a href="https://ziyi-zhang.vercel.app" target="_blank" rel="noopener noreferrer" aria-label="Ziyi Zhang website" title="Ziyi Zhang">${icon('website')}</a><a href="https://github.com/MRziyi/session-grove" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" title="GitHub">${icon('github')}</a></div></div>`,null);
}
async function sync(direction = 'pull'){
    if(!state.data.cloud.configured||!state.data.cloud.unlocked)return settings();
    if(state.syncPreparing||state.data.cloud.phase==='syncing')return;
    state.syncPreparing=direction;renderCloudStatus();
    try{const result=await api('/synchronize/transfer','POST',{direction});state.syncOperation=result.operationId;const next=await api('/status');state.data.cloud=next.cloud;renderCloudStatus();}
    catch(e){toast(e.message);}finally{state.syncPreparing=false;renderCloudStatus();}
}
$('#language-toggle').onclick=()=>{setLocale(locale()==='zh'?'en':'zh');render();};
$('#about').onclick=about;$('#information').onclick=information;$('#sync').onclick=()=>sync('pull');$('#upload').onclick=()=>sync('push');$('#settings').onclick=()=>settings();
$('#push-zone').onmouseenter=$('#push-zone').onfocusin=showPendingUploads;
const pendingRegion=target=>target instanceof Node&&($('.banner').contains(target)||$('#pending-uploads').contains(target));
document.addEventListener('pointermove',e=>{
    const box=$('#pending-uploads');if(box.hidden)return;
    const panel=box.getBoundingClientRect(),banner=$('.banner').getBoundingClientRect(),bridge=e.clientX>=panel.left&&e.clientX<=panel.right&&e.clientY>=banner.bottom&&e.clientY<=panel.top;
    clearTimeout(pendingTimer);if(pendingRegion(e.target)||bridge)return;
    pendingTimer=setTimeout(()=>{pendingTicket++;hideSyncPanel(box);},100);
});
$('.banner').addEventListener('focusout',e=>{if(e.relatedTarget&&!pendingRegion(e.relatedTarget)){pendingTicket++;hideSyncPanel($('#pending-uploads'));}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideSyncPanel($('#pending-uploads'));$('#sync-details').setAttribute('aria-expanded','false');}});
window.addEventListener('resize',()=>{for(const [panel,anchor]of [['pending-uploads','push-zone']])if(!$('#'+panel).hidden)positionSyncPanel($('#'+panel),$('#'+anchor));});

function applyPanePreferences(){
    const layout=$('#layout');layout.classList.toggle('nav-collapsed',localStorage.getItem('grove-nav-collapsed')==='true');layout.classList.toggle('rail-collapsed',localStorage.getItem('grove-rail-collapsed')==='true');
    $('#toggle-navigation').textContent=layout.classList.contains('nav-collapsed')?'›':'‹';$('#toggle-rail').textContent=layout.classList.contains('rail-collapsed')?'›':'‹';for(const [id,key,label]of [['toggle-navigation','nav','projects'],['toggle-rail','rail','session list']]){const expanded=!layout.classList.contains(key+'-collapsed');$('#'+id).setAttribute('aria-expanded',String(expanded));$('#'+id).title=t((expanded?'Collapse ':'Expand ')+label);}
    const ratio=Math.max(.2,Math.min(.8,Number(localStorage.getItem('grove-pane-ratio'))||.5));$('#editor').style.setProperty('--transcript-share',ratio+'fr');$('#editor').style.setProperty('--graph-share',(1-ratio)+'fr');scheduleRibbons();
}
for(const [button,key]of [['toggle-navigation','nav'],['toggle-rail','rail']])$('#'+button).onclick=()=>{const name='grove-'+key+'-collapsed';localStorage.setItem(name,String(localStorage.getItem(name)!=='true'));applyPanePreferences();};
const divider=$('#ribbon-lane');
divider.onpointerdown=e=>{if(e.button!==0)return;divider.setPointerCapture(e.pointerId);divider.dataset.dragging='true';e.preventDefault();};
divider.onpointermove=e=>{if(!divider.dataset.dragging)return;const rect=$('#editor').getBoundingClientRect(),style=getComputedStyle($('#editor')),left=parseFloat(style.paddingLeft),right=parseFloat(style.paddingRight),width=divider.getBoundingClientRect().width,ratio=Math.max(.2,Math.min(.8,(e.clientX-rect.left-left-width/2)/(rect.width-left-right-width)));localStorage.setItem('grove-pane-ratio',String(ratio));applyPanePreferences();};
divider.onpointerup=divider.onpointercancel=()=>{delete divider.dataset.dragging;};
divider.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();localStorage.setItem('grove-pane-ratio',String((Number(localStorage.getItem('grove-pane-ratio'))||.5)+(e.key==='ArrowRight'?.05:-.05)));applyPanePreferences();};
applyPanePreferences();
$('#collect').onclick = updateSessions;
$('#search').oninput = e => { state.query = e.target.value; state.selected.clear(); clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh().catch(e => toast(e.message)), 180); };
$('#back').onclick = () => { ++requestId;cancelOpening();const target=state.tree?.projectId || INBOX;state.tree=null;clearRange();if(state.scope===PROJECTS)state.projectFocus=target;render();if(state.scope===PROJECTS&&listView?.entryProject!==target)focusProject(target);else if(listView)$('#session-list').scrollTo({top:listView.scroll,behavior:'instant'});listView=null;animateView($('#list-page')); };
$('#source').onclick = showSource;
$('#branch-picker').onchange = e => {if(opening){++requestId;cancelOpening();}state.branchId = e.target.value; clearRange(); state.nodeId = null; state.compactionId = null;camera.newView=true;renderDetail(); };
$('#transcripts').onscroll = () => scheduleRibbons();
$('#zoom-in').onclick = () => zoom(1.15); $('#zoom-out').onclick = () => zoom(1 / 1.15); $('#graph-reset').onclick = resetCamera;
$('#graph-fit-path').onclick=()=>{const view=$('#graph-scroll');if(currentGraphLayout){Object.assign(camera,pathCamera(currentGraphLayout,state.branchId,view.clientWidth,view.clientHeight));applyCamera();}};
$('#graph-fit').onclick = () => { const view = $('#graph-scroll'); camera.zoom = Math.max(.02, Math.min(1, (view.clientWidth - 32) / camera.width, (view.clientHeight - 32) / camera.height)); camera.x = (view.clientWidth - camera.width * camera.zoom) / 2; camera.y = (view.clientHeight - camera.height * camera.zoom) / 2; applyCamera(); };
let pan = null;
$('#graph-scroll').addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    pan = { x: e.clientX, y: e.clientY, startX: camera.x, startY: camera.y }; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.classList.add('panning');
});
$('#graph-scroll').addEventListener('pointermove', e => { if (!pan) return; camera.x = pan.startX + e.clientX - pan.x; camera.y = pan.startY + e.clientY - pan.y; applyCamera(); });
const stopPan = () => { pan = null; $('#graph-scroll').classList.remove('panning'); };
$('#graph-scroll').addEventListener('pointerup', stopPan); $('#graph-scroll').addEventListener('pointercancel', stopPan);
$('#graph-scroll').addEventListener('wheel', e => {
    e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * .008), e.clientX - rect.left, e.clientY - rect.top);
    else { camera.x -= e.deltaX; camera.y -= e.deltaY; applyCamera(); }
}, { passive: false });
// Window focus never performs remote I/O; Sync explicitly refreshes the cloud directory.
window.addEventListener('resize', () => scheduleRibbons());
const inlineNames=installInlineNames({translate:t,saved:()=>refresh(),onError:e=>toast(e.message),describe:anchor=>{
    if(working||state.connected===false)return null;
    const {nameKind:kind,nameId:id}=anchor.dataset;
    if(kind==='project'){
        const project=state.data.projects.find(p=>p.id===id);if(!project||project.builtin)return null;
        return {value:project.name,label:t('Project name'),save:name=>api('/projects/'+id,'PATCH',{name,metaVersion:project.metaVersion})};
    }
    if(kind==='session'){
        const item=state.data.items.find(i=>i.id===id),tree=state.tree?.id===id?state.tree:null;if(!item&&!tree)return null;
        return {value:tree?.name||item.name,label:t('Session name'),save:name=>api('/trees/'+id,'POST',{action:'rename-session',name,metaVersion:tree?.sessionNameVersion||item.sessionNameVersion})};
    }
    const graph=state.tree,node=graph?.nodes.find(n=>n.id===id);if(!node)return null;
    const pathId=node.branchIds.includes(state.branchId)?state.branchId:node.branchIds[0];
    return {value:node.name||'',label:t('Node title'),save:name=>api('/trees/'+graph.id,'POST',{action:'rename',nodeId:id,pathId,version:graph.version,name})};
}});

try {
    const boot = await (await fetch('/api/bootstrap')).json(); if (boot.error) throw new Error(errorText(boot.error));
    state.token = boot.token; state.data = boot; state.roots = boot.roots;if(!boot.items.length&&!boot.update.started)state.scope=PROJECTS; $('#demo-badge').textContent = boot.demo ? 'DEMO' : '';
    setLocale(locale()); await refresh(); watchOperations();
    document.addEventListener('visibilitychange',()=>{if(document.hidden)eventController?.abort();else api('/status').then(next=>{state.data.cloud=next.cloud;state.data.update=next.update;renderCloudStatus();}).catch(()=>{});renderCloudStatus();});renderCloudStatus();
    setInterval(async () => {
        if (document.hidden) return;
        try {
            const next = await api('/status');
            if(next.intelligence)showOperation('intelligence',next.intelligence);
            if(next.cloud.operation)showOperation('sync',next.cloud.operation);
            if(next.discardOperation&&working)showOperation('discard',next.discardOperation);
            if(next.trashOperation)showOperation('trash',next.trashOperation);
            if(next.update.operation)showOperation('update',next.update.operation);
            const canRefresh = !working && !inlineNames.editing && !opening && !$('#dialog').open && !state.chats.size;
            if (next.stateVersion !== state.data.stateVersion && canRefresh) await refresh();
            else { state.data.cloud = next.cloud; state.data.update = next.update; state.data.trashOperation = next.trashOperation; renderCloudStatus(); }
        } catch { /* Explicit Update reports connection errors. */ }
    }, 5000);
} catch (e) { toast(e.message); }

installSessionDrag({
    canDrag:()=>state.scope!=='archived'&&state.scope!=='trash'&&!state.tree&&!working&&state.connected!==false,
    items:()=>state.list.items,selected:()=>state.selected,projects:()=>state.data.projects,
    expandOlder:()=>{state.olderProjects=true;renderNavigation();},
    move:(itemIds,projectId)=>run(async()=>{await api('/move','POST',{itemIds,projectId});state.selected.clear();state.projectFocus=projectId;state.expandedProjects.add(projectId);})
});

for(const event of ['wheel','touchstart','pointerdown','keydown'])$('#session-list').addEventListener(event,()=>{state.projectScrollTarget=null;},{passive:true});
