import { foldedItems, pendingLabels, projectGroups, selectRange, inactiveProject, transferStages } from './library-view.js';
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
    const signature=value.id+':'+value.state+':'+JSON.stringify(value.progress||null); if(seenOperations[kind]===signature)return;seenOperations[kind]=signature;
    if (value.finishedAt && Date.now() - value.finishedAt > 3500) return;
    operations[kind] = value;
    if(value.status && state.data){ if(kind==='sync')state.data.cloud=value.status;else state.data.update={...state.data.update,...value.status}; }
    clearTimeout(operationTimers[kind]);
    if (value.state !== 'running') operationTimers[kind] = setTimeout(() => { delete operations[kind]; renderCloudStatus(); }, 3500);
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
                while((end=buffer.indexOf('\n\n'))!==-1){const message=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=message.split('\n').find(l=>l.startsWith('data: '));if(data){const value=JSON.parse(data.slice(6));showOperation(value.kind,value);}}
            }
        } catch {}
        await new Promise(resolve=>setTimeout(resolve,5000));
    }
}
let submitAction, toastTimer, searchTimer, requestId = 0, working = false, opening = false;
const camera = { x: 0, y: 0, zoom: 1, width: 0, height: 0, rootX: 0, newView: true };
const compactNumber = n => new Intl.NumberFormat(locale() === 'zh' ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const tokenLabel = n => t('≈ {count} tokens', { count: compactNumber(n.tokens?.recordedEstimate ?? n.tokens?.estimate ?? 0) });
const tokenHint = () => t('Rough estimate of recorded message and tool text. Excludes hidden instructions, encrypted content and images; not live context usage.');
const cloudMark = item => {
    const badge = (kind, glyph, label) => `<span class="cloud-mark session-state ${kind}" title="${esc(t(label))}" aria-label="${esc(t(label))}">${glyph}</span>`;
    return (item.cloudState === 'cloud' ? badge('cloud', icon('cloud'), 'Stored in cloud · download on open') : '')
        + (item.sessions?.some(s => s.active) ? badge('active-state', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/><path d="m10 8 6 4-6 4Z" fill="white"/></svg>', 'Active on this device') : '')
        + (item.cloudState === 'local' ? badge('modified-state', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 10-10 4 4-10 10-5 1Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>', 'Local changes waiting to push') : '');
};

const date = value => value ? new Date(value).toLocaleString(locale() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('Never');
const currentProject = () => state.data.projects.find(p => p.id === state.scope);
const route = () => state.tree?.paths.find(p => p.branchId === state.branchId);
const selectedNode = () => state.tree?.nodes.find(n => n.id === state.nodeId);
let labeledTree, nodeLabels;
const nodeName = n => { if(labeledTree!==state.tree){labeledTree=state.tree;nodeLabels=pendingLabels(state.tree.nodes);}return n.name||`${t('Pending')} ${nodeLabels.get(n.id)}`; };
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 6000); }
async function api(path, method = 'GET', body, retried = false) {
    let r;
    try { r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Grove-Token': state.token, 'X-Grove-Graph': 'shared-messages-v1' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch (e) { state.connected = false; if (state.data) renderCloudStatus(); throw e; }
    const data = await r.json();
    if (r.status === 403 && data.error === '本地访问凭证无效，请刷新页面' && !retried) {
        const boot = await (await fetch('/api/bootstrap')).json(); state.token = boot.token;
        return api(path, method, body, true);
    }
    state.connected = r.status !== 503;
    if (!r.ok) throw new Error(errorText(data.error) + (data.requestId ? ` [${data.requestId}]` : ''));
    if (data.format === 'shared-messages-v1') { for (const p of data.paths) p.messages = p.messages.map(m => ({ ...data.messagePool[m.ref], line: m.line })); delete data.messagePool; delete data.format; }
    return data;
}
function modal(title, html, action, label = 'Save') {
    modalVersion++;
    $('#dialog').dataset.kind = title === 'About' ? 'about' : 'normal'; $('#dialog-title').textContent = t(title); $('#dialog-content').innerHTML = html; $('#dialog-error').textContent = '';
    $('#dialog-submit').textContent = t(label); $('#dialog-submit').hidden = !action; $('#dialog-submit').disabled = false;
    $('#dialog-cancel').textContent = t(action ? 'Cancel' : 'Close'); submitAction = action;
    if (!$('#dialog').open) $('#dialog').showModal();
}
const field = (label, name, value = '', type = 'text') => `<label class="field">${t(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${type === 'text' ? 'maxlength="200"' : ''}></label>`;
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
function actionDisabled(el) { return state.connected === false || working; }
function button(id, label, fn) { const el = $(id); if (el) { el.textContent = t(label); el.onclick = fn; el.disabled = actionDisabled(el); } }
function translateBanner() {
    for (const [id, glyph, label] of [['sync', 'download', 'Pull'], ['upload', 'upload', 'Push'], ['collect', 'refresh', 'Update'], ['settings', 'settings', 'Settings']]) {
        const el = $('#' + id); el.dataset.glyph= glyph; el.innerHTML = `${icon(glyph)}<span class="button-label">${t(label)}</span>${['sync','upload'].includes(id)?'<span class="button-check" aria-hidden="true">✓</span>':''}`; el.title = t(label); el.setAttribute('aria-label', t(label));
    }
    $('#about').textContent = t('About'); $('#information').title = t('Information'); $('#information').setAttribute('aria-label', t('Information'));
    $('#search-icon').innerHTML = icon('search'); $('#search').placeholder = t('Search title or content…'); $('#search').setAttribute('aria-label', t('Search title or content…'));
    $('#back').innerHTML = icon('back'); $('#back').title = t('Back to list'); $('#back').setAttribute('aria-label', t('Back to list'));
    $('#source').textContent = t('Source'); $('#source').title = t('Source & revisions'); $('#source').setAttribute('aria-label', t('Source & revisions'));
    $('#transcripts-title').textContent = t('Transcripts'); $('#graph-title').textContent = t('Graph'); $('#graph-reset').textContent = t('Reset view'); $('#zoom-in').title = t('Zoom in'); $('#zoom-out').title = t('Zoom out');
    $('#graph-fit').textContent = t('Fit tree');
}
function renderNavigation() {
    const d = state.data, directoryScroll = $('.project-directory-scroll')?.scrollTop || 0;
    const selectedScope = state.scope === PROJECTS ? state.projectFocus : state.scope;
    const entry = (scope, name, count, css = '') => `<button class="nav-entry ${css} ${selectedScope === scope ? 'selected' : ''}" data-scope="${esc(scope)}" ${selectedScope === scope ? 'aria-current="page"' : ''}><span class="nav-name">${esc(name)}</span><span class="count">${count}</span></button>`;
    const projectTimes = new Map(projectGroups(d.items.filter(i=>!i.archived).map(i=>({...i,updatedAt:i.sessions.filter(s=>!s.archived).map(s=>s.updatedAt).sort().at(-1)||i.updatedAt})), d.projects).map(g=>[g.id,g.updatedAt]));
    const projects = d.projects.filter(p => !p.archived && (d.items.some(i => i.projectId === p.id && !i.archived) || p.count > 0));
    const archivedProjects = d.projects.filter(p => p.archived && (d.items.some(i => i.projectId === p.id) || p.count>0));
    const archivedSessions = d.items.filter(i => !archivedProjects.some(p => p.id === i.projectId)).reduce((n, i) => n + i.sessions.filter(s => s.archived).length, 0);
    const directory = rows => rows.sort((a,b) => (projectTimes.get(b.id)||'').localeCompare(projectTimes.get(a.id)||'') || a.name.localeCompare(b.name)).map(p => entry(p.id, p.builtin ? t('Ungrouped') : p.name==='Scheduled & background'?t(p.name):p.name, Math.max(p.count || 0, d.items.filter(i => i.projectId === p.id && !i.archived).length))).join('');
    const recent = projects.filter(p=>p.builtin||!isInactive(projectTimes.get(p.id))), older = projects.filter(p=>!p.builtin&&isInactive(projectTimes.get(p.id)));
    $('#navigation').innerHTML = `<section class="nav-group"><h2 class="nav-label">${t('Current Active')}</h2>${entry('active:codex', 'Codex', d.activeCounts.codex, 'codex')}${entry('active:claude', 'Claude', d.activeCounts.claude, 'claude')}</section><section class="nav-group project-directory"><h2 class="nav-label">${t('Projects')}</h2><div class="project-directory-scroll">${directory(recent)}${older.length?olderToggle(older.length)+(state.olderProjects?directory(older):''):''}</div></section><section class="nav-group"><h2 class="nav-label">${t('Trash')}</h2>${entry('trash',t('Local recovery'),(d.trashEntries||[]).filter(e=>!e.restoredAt&&!e.expired).length)}${archivedProjects.length+archivedSessions?entry('archived',t('Previous archives'),archivedProjects.length+archivedSessions):''}</section>`;
    $('.project-directory-scroll').scrollTop = directoryScroll;
    $$('[data-scope]').forEach(el => el.onclick = () => navigate(el.dataset.scope));
    bindOlderProjects();
    renderCloudStatus();
}

let syncPinned = false, pendingTimer, pendingTicket = 0, transferSamples = [], sampledOperation = null;
const bytesLabel = bytes => bytes < 1024 ? `${bytes || 0} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
function positionSyncPanel(panel, anchor) {
    const rect = anchor.getBoundingClientRect(), width = Math.min(420, innerWidth - 20), top = Math.min(Math.max(rect.bottom, $('.banner').getBoundingClientRect().bottom) + 8, innerHeight - 80);
    Object.assign(panel.style, { width: width + 'px', left: Math.max(10, Math.min(rect.right - width, innerWidth - width - 10)) + 'px', top: top + 'px', maxHeight: Math.max(60, innerHeight - top - 12) + 'px' });
}
function showSyncPanel(panel, anchor) { if(panel.id==='pending-uploads'){syncPinned=false;hideSyncPanel($('#transfer-progress'));$('#sync-details').setAttribute('aria-expanded','false');}else{hideSyncPanel($('#pending-uploads'));pendingTicket++;} panel.hidden = false; panel.showPopover?.(); positionSyncPanel(panel, anchor); }
function hideSyncPanel(panel) { panel.hidePopover?.(); panel.hidden = true; }
const transferPhaseNames={'Downloading records':'Pulling changes','Uploading records':'Pushing changes','Applying downloaded changes':'Updating sessions','Updating downloaded sessions':'Updating sessions','Checking cloud directory':'Checking for changes','Reading cloud session manifests':'Checking shared history','Publishing project indexes':'Saving changes','Publishing cloud directory':'Finishing push','Download complete':'Pull complete','Preparing upload snapshot':'Preparing changes to push','Preparing shared history':'Preparing remaining sessions','Reclaiming cloud space':'Cleaning up removed sessions'};
function renderCloudStatus(){
    const d=state.data;if(!d)return;
    const offline=state.connected===false, operation=d.cloud.operation || operations.sync, busy=operation?.state==='running'||['syncing','migrating'].includes(d.cloud.phase), step=operation?.step || 'pull';
    const phase=operation?.progress?.phase;
    $('#cloud-status').textContent=t(offline?'Service disconnected':busy?(transferPhaseNames[phase] || phase || (step==='pull'?'Pulling changes':'Pushing changes')):d.cloud.needsReview&&operation?.state==='error'?'Review sync':operation?.state==='error'?'Sync failed':d.cloud.dirty?'Local changes':d.cloud.started?'Up to date':'Ready to sync');
    $('#sync-details').classList.toggle('has-error',operation?.state==='error');
    $('#sync-details').title=t('Transfer details');
    const stages=transferStages(operation), appearance={running:'running',complete:'success',failed:'error',paused:'paused',pending:''};
    $('#sync').dataset.operation=appearance[stages.pull]; $('#upload').dataset.operation=appearance[stages.push];
    for(const id of ['sync','upload']) { $('#'+id).disabled=offline||busy||!!state.syncPreparing; $('#'+id).setAttribute('aria-busy',String(busy&&(id==='sync'?step==='pull':step==='push'))); }
    const mini=$('#sync-mini'), progress=operation?.stageProgress; mini.hidden=!busy;
    if(progress?.total>0){mini.max=progress.total;mini.value=progress.completed||0;}else mini.removeAttribute('value');
    const updating=operations.update?.state==='running'||state.uiBusy==='update';$('#collect').dataset.operation=updating?'running':'';$('#collect').disabled=offline||working||updating;
    $('#collect .button-label').textContent=t(updating?'Updating…':'Update');
    $$('.actions button,button[data-compaction],[data-trash-restore],[data-trash-native]').forEach(el=>el.disabled=actionDisabled(el));
    renderTransfer();renderCountdowns();
    const ticking=!document.hidden&&!offline&&(d.update?.nextRunAt||d.cloud?.nextRunAt||busy);
    if(ticking&&!clockTimer)clockTimer=setInterval(()=>{renderCountdowns();if(!$('#transfer-progress').hidden)renderTransfer();},1000);if(!ticking&&clockTimer){clearInterval(clockTimer);clockTimer=null;}
}
function transferHtml(value) {
    const p=value?.progress, stages=transferStages(value), running=value?.state==='running', failed=value?.state==='error', paused=value?.state==='interrupted';
    const progress=value?.stageProgress, total=progress?.total, count=progress?.completed||0;
    const remaining=p?.etaSeconds;
    const eta=remaining==null?t('Estimating time…'):t('About {time} left',{time:Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0')});
    const stage=key=>`<span class="sync-step" data-step="${key}" data-state="${stages[key]}">${icon(key==='pull'?'download':'upload')}<span>${key==='pull'?'Pull':'Push'}</span>${stages[key]==='complete'?'<span class="stage-check" aria-label="'+esc(t('Complete'))+'">✓</span>':''}</span>`;
    if (!value) return `<div class="transfer-steps">${stage('pull')}<span class="stage-connector" aria-hidden="true">→</span>${stage('push')}</div><p class="dialog-copy">${t('Pull brings in cloud changes. Push pulls first, then sends your local changes.')}</p>`;
    const percent=total>0?Math.min(100,Math.floor(count/total*100)):null;
    const rate=transferSamples.at(-1)?.rate;

    const phase=paused?'Transfer paused':!running&&value?.state==='success'?(value.direction==='push'?'Push complete':'Pull complete'):transferPhaseNames[p?.phase]||p?.phase||'Ready to sync';
    const error=failed?value.error:paused?t('Transfer paused. Pull or Push when ready.'):null;
    return `<div class="transfer-steps">${stage('pull')}<span class="stage-connector" aria-hidden="true">→</span>${stage('push')}</div><div class="transfer-heading"><strong>${esc(t(phase))}</strong>${running&&!error?`<span class="transfer-eta">${eta}</span>`:''}</div>${p?.detail&&!error?`<p class="transfer-item">${esc(p.detail)}</p>`:''}${error?`<div class="transfer-error ${paused?'is-paused':''}" role="alert">${esc(error)}</div>`:`<progress ${total>0?'max="'+total+'" value="'+count+'"':value?.state==='success'?'max="1" value="1"':''}></progress><div class="transfer-footer"><span>${percent===null?(running?t('Preparing…'):t('Complete')):percent+'%'}</span><span class="transfer-speed">${running?(rate==null?t('Measuring speed…'):bytesLabel(rate)+'/s · '+t('down')):''}</span></div>`}`;
}
function renderTransfer() {
    const cloud=state.data.cloud,value=cloud.operation||operations.sync,box=$('#transfer-progress'),running=value?.state==='running';
    if(value?.id!==sampledOperation){sampledOperation=value?.id;transferSamples=[];}
    if(running&&value.network){const at=value.network.sampledAt||Date.now(),bytes=value.network.bytesReceived||0,last=transferSamples.at(-1);if(!last||at-last.at>=1000){transferSamples.push({at,bytes,rate:last?Math.max(0,(bytes-last.bytes)*1000/(at-last.at)):0});if(transferSamples.length>2)transferSamples.shift();}}
    if(!box.hidden){
        box.innerHTML=`<div class="sync-panel-heading"><strong>${t('Transfer details')}</strong><button type="button" id="close-transfer" aria-label="${esc(t('Close'))}">×</button></div>${transferHtml(value)}`;
        $('#close-transfer').onclick=()=>{syncPinned=false;hideSyncPanel(box);$('#sync-details').setAttribute('aria-expanded','false');};positionSyncPanel(box,$('#sync-details'));
    }
    if(state.syncOperation&&cloud.manualOperation?.id===state.syncOperation&&cloud.manualOperation.state!=='running'){
        const done=cloud.manualOperation;state.syncOperation=null;toast(t(done.state==='error'?'Sync failed':done.direction==='pull'?'Pull complete':'Push complete'));
        if(!$('#dialog').open&&!working)queueMicrotask(()=>refresh().catch(e=>toast(e.message)));
    }
}
async function showPendingUploads(){
    clearTimeout(pendingTimer); const box=$('#pending-uploads'),ticket=++pendingTicket;
    showSyncPanel(box,$('#push-zone'));box.innerHTML=`<strong>${t('Pending uploads')}</strong><p>${t('Reading local changes…')}</p>`;
    try{const data=await api('/synchronize/pending');if(ticket!==pendingTicket||box.hidden)return;box.innerHTML=`<strong>${t('Pending uploads')} · ${data.items.length}</strong>${data.items.length?`<ul>${data.items.map(i=>`<li><span>${esc(i.name)}</span><small>${t(i.action==='remove'?'Move to Trash':'Modified')} · ${esc(date(i.updatedAt))}</small></li>`).join('')}</ul>`:`<p>${t('No local changes waiting to upload.')}</p>`}<p class="dialog-copy">${t('Changes made during upload remain queued for the next upload.')}</p>`;positionSyncPanel(box,$('#push-zone'));}catch(e){if(ticket===pendingTicket)box.textContent=e.message;}
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

function isInactive(updatedAt) { return inactiveProject(updatedAt, state.data.preferences?.inactiveProjectDays || 30); }
function olderToggle(count) { return `<button type="button" class="older-projects-toggle" data-older-projects aria-expanded="${!!state.olderProjects}">${state.olderProjects?'▾':'▸'} ${t('Older projects')} <span>${count}</span></button>`; }
function bindOlderProjects() { $$('[data-older-projects]').forEach(el=>el.onclick=()=>{state.olderProjects=!state.olderProjects;renderNavigation();renderList();}); }
let projectObserver;
function focusProject(id, scroll = true) {
    state.projectFocus = id;
    $$('[data-scope]').forEach(el=>{const on=el.dataset.scope===id;el.classList.toggle('selected',on);if(on)el.setAttribute('aria-current','location');else el.removeAttribute('aria-current');});
    if(scroll) document.querySelector('[data-project-group="'+id+'"]')?.scrollIntoView({block:'start',behavior:'smooth'});
    const tab=$$('[data-scope]').find(el=>el.dataset.scope===id); if(tab && !scroll) tab.scrollIntoView({block:'nearest'});
}
async function navigate(scope) {
    const project = !scope.startsWith('active:') && scope !== 'archived' && scope !== 'trash';
    const focus = project ? (scope === PROJECTS ? state.projectFocus : scope) : null;
    if(project && state.scope===PROJECTS && !state.tree && !state.query){focusProject(focus);return;}
    ++requestId; opening=false;state.scope=project?PROJECTS:scope;state.projectFocus=focus;state.tree=null;state.list={items:[],sessionCount:0};state.query='';state.selected.clear();clearRange();$('#search').value='';
    render();if(scope !== 'trash')$('#session-list').innerHTML=`<p class="empty">${t('Loading project index…')}</p>`;
    try {await refresh();if(project&&focus)focusProject(focus);}catch(e){toast(e.message);}
}
function title() { if(state.scope==='trash')return t('Trash'); if(state.scope === PROJECTS) return t('Projects'); if(state.scope === INBOX) return t('Ungrouped'); return state.scope === 'active:codex' ? t('Active Codex Sessions') : state.scope === 'active:claude' ? t('Active Claude Code Sessions') : state.scope === 'archived' ? t('Archived') : currentProject()?.name || t('Projects'); }
function groups() {
    if(state.scope === PROJECTS) return projectGroups(state.list.items,state.data.projects);
    if(state.scope === INBOX && !state.query) {
        const buckets=[{id:'recent',name:t('Last 7 days'),items:[]},{id:'month',name:t('Last 30 days'),items:[]},{id:'older',name:t('Older'),items:[],collapsed:true}];
        for(const item of state.list.items){const days=(Date.now()-new Date(item.updatedAt).getTime())/86400000;buckets[days<7?0:days<30?1:2].items.push(item);}
        return buckets.filter(g=>g.items.length);
    }
    const result = new Map();
    for (const item of state.list.items) {
        const key = item.groupId || 'ungrouped';
        if (!result.has(key)) result.set(key, { name: item.groupName || t('Ungrouped'), items: [], id: item.groupId });
        result.get(key).items.push(item);
    }
    return [...result.values()];
}
function itemMeta(item) {
    if (item.kind === 'tree') return t('{count} branches', { count: item.sessions.length });
    return item.sessions[0]?.chats == null ? t('Transcript in cloud') : t('{count} chats', { count: item.sessions[0].chats });
}
function renderList() {
    if(state.scope==='trash'){renderTrash();return;}
    $('#list-title').textContent = title();
    const pending = state.list.pendingDeactivation || [],discarded=(state.data.trashNative||[]).filter(i=>i.active&&state.scope==='active:'+i.agent); $('#active-notice').hidden = !pending.length&&!discarded.length;
    $('#active-notice').innerHTML = pending.length ? `<span>${t('{count} archived sessions are still active on this device.',{count:pending.length})}</span><button id="deactivate-archived">${t('Deactivate archived sessions')}</button>` : '';
    if(discarded.length){$('#active-notice').insertAdjacentHTML('beforeend',`<span>${t('{count} discarded native copies still need cleanup.',{count:discarded.length})}</span><button id="open-trash">${t('Open Trash')}</button>`);$('#open-trash').onclick=()=>navigate('trash');}
    if(pending.length)$('#deactivate-archived').onclick=()=>run(()=>api('/manage','POST',{action:'deactivate',branchIds:pending.map(s=>s.id)}));
    $('#list-count').textContent = t('{count} sessions', { count: state.list.sessionCount || 0 });
    const selected = state.list.items.filter(i => state.selected.has(i.id));
    const organizing = !state.scope.startsWith('active:') && state.scope !== 'archived';
    $('#list-actions').innerHTML = '<button id="select-all"></button>' + (selected.length ? `<span class="selection-count">${t('{count} selected',{count:selected.length})}</span>${selected.length===1?'<button id="rename-items"></button>':''}${state.scope==='archived'?'<button id="restore-items"></button>':organizing?'<button id="move-items"></button>':'<button id="deactivate-items"></button>'}<button id="archive-items"></button>`:'');
    button('#rename-items', 'Rename', () => renameSession(selected[0]));
    button('#select-all','Select all',()=>{const items=state.scope===PROJECTS&&state.projectFocus?state.list.items.filter(i=>(i.projectId||INBOX)===state.projectFocus):state.list.items;const all=items.every(i=>state.selected.has(i.id));for(const i of items)all?state.selected.delete(i.id):state.selected.add(i.id);renderList();});
    button('#move-items','Move to project',()=>moveDialog([...state.selected]));
    button('#archive-items','Move to Trash',()=>trashDialog({itemIds:[...state.selected],view:state.scope.startsWith('active:')?state.scope:state.scope==='archived'?'archived':'in-use'},selected.length));
    button('#restore-items','Restore',()=>restore({itemIds:[...state.selected]}));
    button('#deactivate-items','Deactivate',()=>run(()=>api('/manage','POST',{action:'deactivate',itemIds:[...state.selected],agent:state.scope.slice(7)})));
    const row=i=>`<article class="session-row ${state.selected.has(i.id)?'checked':''}" data-item="${esc(i.id)}"><button class="row-open" data-open="${esc(i.id)}">${icon(i.kind)}<span class="row-text"><span class="row-title">${esc(i.name)} ${cloudMark(i)}</span><span class="row-meta">${itemMeta(i)} ${sourceTags(i)}</span></span><time class="row-date">${date(i.updatedAt)}</time></button>${`<input type="checkbox" data-select="${esc(i.id)}" aria-label="${esc(t('Select {name}',{name:i.name}))}" ${state.selected.has(i.id)?'checked':''}>`}</article>`;
    const groupHtml = g=>{const initial=foldedItems(g.items,state.data.preferences),limited=state.scope===PROJECTS&&!state.query&&initial.length<g.items.length,expanded=state.expandedProjects.has(g.id)||g.items.some(i=>state.selected.has(i.id));const shown=limited&&!expanded?initial:g.items;return `<section class="list-group project-group" data-project-group="${esc(g.id||INBOX)}"><h2>${esc(g.name==='Scheduled & background'?t(g.name):g.name)}<span>${g.items.length}</span></h2>${shown.map(row).join('')}${limited?`<button class="show-project" data-expand-project="${esc(g.id)}">${t(expanded?'Show fewer':'Show all {count}',{count:g.items.length})}</button>`:''}</section>`;};
    const allGroups = groups(), older = state.scope===PROJECTS&&!state.query ? allGroups.filter(g=>isInactive(g.updatedAt)) : [], olderIds = new Set(older.map(g=>g.id));
    $('#session-list').innerHTML = allGroups.filter(g=>!olderIds.has(g.id)).map(groupHtml).join('') + (older.length ? `<section class="older-projects">${olderToggle(older.length)}${state.olderProjects?older.map(groupHtml).join(''):''}</section>` : '') || `<p class="empty">${t(state.query?'No matching sessions':'No sessions here.')}</p>`;
    bindOlderProjects();
    $$('[data-open]').forEach(el=>el.onclick=()=>openTree(el.dataset.open));
    $$('[data-select]').forEach(el=>el.onchange=()=>{el.checked?state.selected.add(el.dataset.select):state.selected.delete(el.dataset.select);renderList();});
    $$('[data-expand-project]').forEach(el=>el.onclick=()=>{const id=el.dataset.expandProject;state.expandedProjects.has(id)?state.expandedProjects.delete(id):state.expandedProjects.add(id);renderList();});
    projectObserver?.disconnect();
    if(state.scope===PROJECTS&&!state.tree){projectObserver=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);if(visible[0])focusProject(visible[0].target.dataset.projectGroup,false);},{root:$('#session-list'),rootMargin:'0px 0px -65% 0px',threshold:0});$$('[data-project-group]').forEach(el=>projectObserver.observe(el));}
}

function renderRail() {
    $('#rail-content').innerHTML = groups().map(g => `<h2 class="rail-heading">${esc(g.name)}</h2>${g.items.map(i => `<button class="rail-row ${state.tree?.id === i.id ? 'selected' : ''}" data-rail="${esc(i.id)}" ${state.tree?.id === i.id ? 'aria-current="true"' : ''}>${icon(i.kind)}<span class="row-text"><span class="row-title">${esc(i.name)} ${cloudMark(i)}</span><span class="row-meta">${itemMeta(i)} ${sourceTags(i)}</span></span></button>`).join('')}`).join('');
    $$('[data-rail]').forEach(el => el.onclick = () => openTree(el.dataset.rail));
}
async function openTree(id) {
    const ticket = ++requestId, scope = state.scope, view = scope === 'archived' ? 'archived' : 'in-use';
    const item = state.list.items.find(i => i.id === id);
    opening = true; state.tree = null; render(); $('#main').setAttribute('aria-busy', 'true');
    const label = $(`[data-item="${id}"] .row-meta`); if (label) label.textContent = t('Loading context…');
    try {
        const tree = await api('/trees/' + encodeURIComponent(id) + '?view=' + view);
        if (ticket !== requestId || state.scope !== scope) return;
        if (tree.view !== view || tree.paths.some(p => view === 'archived' ? !p.archived && !tree.projectArchived : p.archived || tree.projectArchived)) throw new Error(t('The view changed. Please open the session again.'));
        if (!tree.paths.length) { state.tree = null; render(); return; }
        state.tree = tree;
        state.branchId = (state.query ? tree.paths.find(p => item?.matchedSessionIds?.includes(p.branchId)) : null)?.branchId || tree.paths.find(p=>p.branchId===tree.id)?.branchId || [...tree.paths].sort((a,b)=>b.nodeIds.length-a.nodeIds.length)[0].branchId;
        for (const list of [state.list.items,state.data.items]) { const cached=list.find(i=>i.id===id); if(cached)cached.cloudState='cached'; }
        state.nodeId = null; state.compactionId = null; clearRange(); state.expanded.clear(); camera.x = 0; camera.y = 0; camera.zoom = 1; camera.newView = true; render();
    } catch (e) { if (ticket === requestId) { toast(e.message); state.tree = null; render(); } }
    finally { if (ticket === requestId) { opening = false; $('#main').removeAttribute('aria-busy'); } }
}

function render() {
    translateBanner(); renderNavigation(); renderList();
    const detail = !!state.tree;
    $('#layout').classList.toggle('detail', detail); $('#list-page').hidden = detail; $('#detail-page').hidden = !detail; $('#session-rail').hidden = !detail;
    if (detail) { renderRail(); renderDetail(); }
    else { drawnTree = null; $('#branch-picker').replaceChildren(); $('#transcripts').replaceChildren(); $('#graph').replaceChildren(); $('#ribbons').replaceChildren(); }
}
function renderDetail() {
    const tree = state.tree, p = route(); if (!p) { state.tree = null; render(); return; }
    $('#session-title').textContent = tree.name;
    const tokens = p.nodeIds.reduce((sum, id) => sum + (tree.nodes.find(n => n.id === id)?.tokens?.recordedEstimate || 0), 0);
    $('#session-meta').textContent = `${p.agent === 'codex' ? 'Codex' : 'Claude'} · ≈ ${compactNumber(tokens)} tokens${p.context?.compactions.length ? ' · ' + t('{count} compactions', { count: p.context.compactions.length }) : ''}`;
    $('#detail-count').textContent = `${t('{count} branches', { count: tree.paths.length })} · ${t('{count} chats', { count: tree.chatCount })} · ${t('{count} pending', { count: tree.pendingCount })}`;
    $('#branch-picker').innerHTML = tree.paths.map(v => `<option value="${esc(v.branchId)}" ${v.branchId === p.branchId ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
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
    $('#detail-actions').innerHTML = state.chats.size ? `<span>${t('{count} selected', { count: state.chats.size })}</span>${editable && state.rangeEnd !== null && canCombine() ? '<button id="combine"></button>' : ''}${editable && state.rangeEnd !== null && dissolve ? '<button id="dissolve"></button>' : ''}<button id="clear-selection"></button>` : node ? `<button id="rename-node"></button>${editable ? '<button id="activate-node"></button>' : ''}${terminal ? `${archived ? '<button id="restore-session"></button>' : ''}<button id="archive-path"></button>` : ''}` : '';
    button('#activate-node', 'Activate', () => activateDialog(p));
    button('#combine', 'Combine', combineDialog);
    button('#dissolve', 'Dissolve', () => run(async () => { await saveOrganization('dissolve'); clearRange(); }));
    button('#clear-selection', 'Clear', () => { clearRange(); updateRangeSelection(); renderDetailActions(); renderGraph(); });
    button('#restore-session', 'Restore', () => restore({ branchIds: [p.branchId] }));
    button('#rename-node', 'Rename', renameNode);
    button('#archive-path', 'Move to Trash', archivePath);
}
function excerpt(text, expanded) {
    if (expanded || text.length < 380) return `<div class="markdown">${markdown(text)}</div>`;
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
    const shortened = paragraphs.length > 2 ? paragraphs[0].slice(0, 600) + '\n\n…\n\n' + paragraphs.at(-1).slice(-500) : text.slice(0, 210) + '\n\n…\n\n' + text.slice(-150);
    return `<div class="markdown">${markdown(shortened)}</div>`;
}
function activityEntries(entries,p) {
    return entries.map(e=>`<div class="activity-entry"><button type="button" data-record="${e.line}" data-head="${esc(p.head)}">${esc(e.label)} <span>${t(e.kind)}</span></button>${e.unreadable?`<p class="dialog-copy">${t('Encrypted reasoning · no readable summary. Original preserved.')}</p>`:''}${e.files?.length?`<div class="file-tags">${e.files.map(f=>`<code>${esc(f)}</code>`).join('')}</div>`:''}<span class="activity-cost">${e.opaque?t('Opaque or non-text; token size unknown'):'≈ '+compactNumber(e.tokens)+' tokens'}</span>${e.preview?.trim()?`<pre>${esc(e.preview)}</pre>`:''}</div>`).join('');
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
    return fidelity + `<details class="context-breakdown"><summary>${t('Recorded context')} · ${t('Tool activity')}: ≈ ${compactNumber((ledger.totals['tool-call']||0)+(ledger.totals['tool-result']||0))} tokens${p.context.lastUsage?` · ${t('Last native input')}: ${compactNumber(p.context.lastUsage.input)}`:''}</summary><div class="token-breakdown">${Object.entries(ledger.totals).filter(([,n])=>n).map(([k,n])=>`<span>${t(labels[k])}<b>≈ ${compactNumber(n)}</b></span>`).join('')}</div><p>${t('Recorded history is not the live model request. Hidden instructions, encrypted reasoning, images and compaction can prevent a complete token breakdown.')}</p>${activityHtml(ledger.entries.filter(e=>e.chatLine===null),p)}</details>`;
}
function compactionsAt(n, p) { return (p.context?.compactions || []).filter(e => n.chatIds.includes(p.messages.find(m => m.line > e.line)?.id)); }
function mutedNode(n, p) {
    const last = (p.context?.compactions || []).filter(e => e.enabled).at(-1);
    if (!last) return false;
    const chats = p.messages.filter(m => n.chatIds.includes(m.id));
    return chats.length > 0 && chats.every(m => m.line < last.line);
}
function compactionButton(e, compact = false) {
    if(!route()?.canRewriteContext || state.scope === 'archived' || !e.canDisable && e.enabled) return `<span class="context-switch">${t('Compact')} · ${t(e.enabled ? 'On' : 'Off')}</span>`;
    const locked = !route()?.canRewriteContext || state.scope === 'archived' || !e.canDisable && e.enabled;
    return `<button type="button" class="context-switch ${e.enabled ? 'enabled' : ''}" data-compaction="${esc(e.id)}" aria-pressed="${!!e.enabled}" title="${esc(t(!route()?.canRewriteContext ? 'The complete native history is unavailable. Update before changing context.' : e.canDisable ? 'Choose compacted context or recorded history for this path.' : 'Original pre-compaction history is unavailable.'))}" ${locked ? 'disabled' : ''}>${compact ? t('Compact') : t('Use compaction')}<span>${t(e.enabled ? 'On' : 'Off')}</span></button>`;
}
function bindCompactions(root) { root.querySelectorAll('[data-compaction]').forEach(el => el.onclick = () => {
    const p = route(), event = p.context.compactions.find(e => e.id === el.dataset.compaction);
    state.compactionId = event.id; state.nodeId = null; clearRange();
    run(() => api('/branches/' + p.branchId + '/compaction', 'POST', { eventId: event.id, enabled: !event.enabled, head: p.head }));
}); }
function renderTranscript() {
    activityGroups=[];
    const p = route();
    $('#transcripts').innerHTML = contextBreakdown(p) + p.nodeIds.map(id => {
        const n = state.tree.nodes.find(n => n.id === id), messages = p.messages.filter(m => n.chatIds.includes(m.id));
        return `${compactionsAt(n, p).map(e => `<div class="compaction-marker">${t('Context compacted here')}${compactionButton(e)}</div>`).join('')}<section class="transcript-segment ${mutedNode(n, p) ? 'context-muted' : ''} ${n.pending ? 'pending' : ''}" data-segment="${esc(n.id)}" style="${style(n)}"><div class="segment-caption"><button data-focus-node="${esc(n.id)}">${esc(nodeName(n))} · ${t('{count} chats', { count: messages.length })}</button><span class="token-estimate" title="${esc(tokenHint())}">${tokenLabel(n)}</span></div>${messages.map(m => `<article class="chat ${m.role} ${state.chats.has(m.id) ? 'checked' : ''}">${state.scope === 'archived' ? '' : `<input type="checkbox" data-chat="${esc(m.id)}" aria-label="${esc(t('Select chat {number}', { number: p.messages.findIndex(x => x.id === m.id) + 1 }))}" ${state.chats.has(m.id) ? 'checked' : ''}>`}<div class="bubble"><span class="speaker">${m.role === 'user' ? t('You') : p.agent === 'codex' ? 'Codex' : 'Claude'}</span>${excerpt(m.text, state.expanded.has(m.id))}${activityHtml(m.activity,p)}${m.text.length >= 380 ? `<button class="expand-chat" data-expand="${esc(m.id)}">${t(state.expanded.has(m.id) ? 'Collapse' : 'Expand')}</button>` : ''}</div></article>`).join('')}</section>`;
    }).join('') || `<p class="empty">${t('No chats yet.')}</p>`;
    const trailing = (p.context?.compactions || []).filter(e => !p.messages.some(m => m.line > e.line));
    $('#transcripts').insertAdjacentHTML('beforeend', trailing.map(e => `<div class="compaction-marker">${t('Context compacted here')}${compactionButton(e)}</div>`).join(''));
    bindCompactions($('#transcripts'));
    $('#transcripts').onclick=async event=>{
        const el=event.target.closest('[data-record]');if(!el)return;
        const branchId=p.branchId, head=el.dataset.head; let offset=0;
        modal('Original context record', `<p>${t('Loading…')}</p>`, null);
        const box=$('#dialog-content'), ticket=modalVersion;
        async function load(){
            try { const r=await api('/branches/'+branchId+'/records/'+el.dataset.record+'?head='+encodeURIComponent(head)+'&offset='+offset);
                if(ticket!==modalVersion || !box.isConnected || !$('#dialog').open)return;
                box.innerHTML=`${r.opaque?`<p class="dialog-copy">${t('Encrypted reasoning is preserved in the session; only its readable summary can be displayed.')}</p>`:''}<pre class="record-detail"></pre><div class="record-pages">${offset?'<button type="button" id="record-previous">'+t('Previous')+'</button>':''}<span>${offset+1}–${offset+r.text.length} / ${r.total}</span>${r.next!==null?'<button type="button" id="record-next">'+t('Next')+'</button>':''}</div>`;
                $('.record-detail').textContent=r.text;
                if($('#record-next'))$('#record-next').onclick=()=>{offset=r.next;load();};
                if($('#record-previous'))$('#record-previous').onclick=()=>{offset=Math.max(0,offset-r.pageSize);load();};
            }catch(e){if($('#dialog').open)$('#dialog-error').textContent=e.message;}
        } await load();
    };
    $$('[data-activity]').forEach(el=>el.addEventListener('toggle',()=>{if(el.open && !el.dataset.loaded){const group=activityGroups[Number(el.dataset.activity)];el.querySelector('.activity-body').innerHTML=activityEntries(group.entries,group.p);el.dataset.loaded='true';scheduleRibbons();}}));
    $$('#transcripts details').forEach(el=>el.addEventListener('toggle',scheduleRibbons));
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
let drawnTree = null;
function renderGraph() {
    const nodes = state.tree.nodes, p = route(), positions = new Map(), byNode = new Map(nodes.map(n=>[n.id,n]));
    let lane = 0;
    function place(n) {
        if (positions.has(n.id)) return positions.get(n.id);
        const children = n.childIds.map(id => place(byNode.get(id)));
        const x = children.length ? children.reduce((v, child) => v + child.x, 0) / children.length : lane++ * 174 + 12;
        const pos = { x, y: n.depth * 116 + 12 }; positions.set(n.id, pos); return pos;
    }
    nodes.filter(n => !n.parentIds.length).forEach(place);
    const width = Math.max(180, lane * 174), height = Math.max(160, ...nodes.map(n => n.depth * 116 + 110));
    camera.width = width; camera.height = height; camera.rootX = (positions.get(nodes.find(n => !n.parentIds.length)?.id)?.x || 0) + 74;
    if (camera.newView) { const view = $('#graph-scroll'); camera.zoom = Math.max(.02, Math.min(1, (view.clientWidth-32)/width, (view.clientHeight-32)/height)); camera.x = (view.clientWidth-width*camera.zoom)/2; camera.y = (view.clientHeight-height*camera.zoom)/2; camera.newView = false; }
    $('#graph').style.width = `${width}px`; $('#graph').style.height = `${height}px`;
    if (drawnTree !== state.tree) {
    $('#graph').innerHTML = `<svg class="graph-edges" width="${width}" height="${height}" aria-hidden="true">${state.tree.edges.map(e => { const a = positions.get(e.from), b = positions.get(e.to), n = byNode.get(e.to), color = palette[n.color][0]; return `<path d="M${a.x + 74},${a.y + 80} C${a.x + 74},${a.y + 102} ${b.x + 74},${b.y - 25} ${b.x + 74},${b.y}" fill="none" stroke="${color}" stroke-width="2" ${n.pending ? 'stroke-dasharray="4 4"' : ''}/>`; }).join('')}</svg>${nodes.map(n => { const pos = positions.get(n.id); return `<button class="graph-node ${mutedNode(n, p) ? 'context-muted' : ''} ${n.pending ? 'pending' : ''} ${n.id === state.nodeId ? 'selected' : ''} ${p.nodeIds.includes(n.id) ? '' : 'dimmed'}" data-node="${esc(n.id)}" style="${style(n)};left:${pos.x}px;top:${pos.y}px" aria-pressed="${n.id === state.nodeId}"><span class="node-tools">${toolTags(n.agents || [p.agent],true)}</span><span class="node-title">${esc(nodeName(n))}</span><span class="node-meta">${t('{count} chats', { count: n.count })} · <span title="${esc(tokenHint())}">${tokenLabel(n)}</span></span>${n.endBranchIds.some(id => state.tree.paths.find(p => p.branchId === id)?.active) ? `<span class="end-label">${t('Active')}</span>` : ''}</button>`; }).join('')}`;
        drawnTree = state.tree;
    } else {
        for (const el of $$('[data-node]')) {
            const n = byNode.get(el.dataset.node);
            el.classList.toggle('selected', n.id === state.nodeId);
            el.classList.toggle('dimmed', !p.nodeIds.includes(n.id));
            el.classList.toggle('context-muted', mutedNode(n, p));
            el.setAttribute('aria-pressed', String(n.id === state.nodeId));
        }
    }
    $$('#graph .compaction-edge').forEach(el => el.remove());
    for (const e of p.context?.compactions || []) {
        const next = p.messages.find(m => m.line > e.line), previous = [...p.messages].reverse().find(m => m.line < e.line);
        const before = nodes.find(n => n.chatIds.includes(previous?.id)), after = nodes.find(n => n.chatIds.includes(next?.id));
        if (!before) continue;
        const from = positions.get(before.id), to = after && positions.get(after.id);
        const x = (from.x + (to?.x ?? from.x)) / 2 + 74, y = to ? (from.y + 80 + to.y) / 2 : from.y + 96;
        $('#graph').insertAdjacentHTML('beforeend', `<div class="compaction-edge" style="left:${x}px;top:${y}px">${compactionButton(e, true)}</div>`);
        if (!to) { camera.height = Math.max(camera.height, y + 30); $('#graph').style.height = camera.height + 'px'; }
    }
    bindCompactions($('#graph'));
    $$('[data-node]').forEach(el => { el.onpointerdown = e => { if (e.button === 0) e.preventDefault(); }; el.onclick = () => selectNode(el.dataset.node); });
    applyCamera();
}
function selectNode(id, scrollTranscript = true) {
    const n=state.tree.nodes.find(n=>n.id===id);if(!n)return;
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
        align();requestAnimationFrame(()=>{align();scheduleRibbons();});
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
        if (a.bottom < view.top || a.top > view.bottom || b.bottom < graphView.top || b.top > graphView.bottom || b.left < graphView.left || b.right > graphView.right || b.top < graphView.top || b.bottom > graphView.bottom) return '';
        const top = Math.max(a.top, view.top) - lane.top, bottom = Math.min(a.bottom, view.bottom) - lane.top;
        const nt = Math.max(b.top, graphView.top) - lane.top, nb = Math.min(b.bottom, graphView.bottom) - lane.top;
        const left = view.right - lane.left, right = Math.max(left, b.left - lane.left), mid = (left + right) / 2;
        const n = state.tree.nodes.find(n => n.id === id);
        return `<path d="M${left} ${top} C${mid} ${top},${mid} ${nt},${right} ${nt} L${right} ${nb} C${mid} ${nb},${mid} ${bottom},${left} ${bottom} Z" fill="${mutedNode(n, route()) ? '#aeb8c1' : palette[n.color][0]}" opacity=".19"/>`;
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
async function refresh({ checkCloud = false } = {}) {
    if (opening) return;
    const id = ++requestId, scope = state.scope;
    if (scope === 'trash') {
        const [trash, status] = await Promise.all([api('/trash'), api('/status')]);
        if (id !== requestId || scope !== state.scope) return;
        Object.assign(state.data, trash, status); state.list = { items: [], sessionCount: 0 }; render(); return;
    }
    const [data, list, tree] = await Promise.all([api('/state'), api('/list?scope=' + encodeURIComponent(state.scope) + '&q=' + encodeURIComponent(state.query) + (checkCloud ? '&check=1' : '')), state.tree ? api('/trees/' + encodeURIComponent(state.tree.id) + '?view=' + (state.scope === 'archived' ? 'archived' : 'in-use')) : null]);
    if (id !== requestId || scope !== state.scope) return;
    state.data = data; state.list = list;
    state.selected = new Set([...state.selected].filter(id => list.items.some(i => i.id === id)));
    if (tree && tree.view !== (scope === 'archived' ? 'archived' : 'in-use')) return;
    if (tree) {
        state.tree = tree.paths.length ? tree : null;
        if (!state.tree) { clearRange(); render(); return; } if (!route()) state.branchId = tree.paths[0]?.branchId;
        if (!tree.nodes.some(n => n.id === state.nodeId)) state.nodeId = null;
        state.chats = new Set([...state.chats].filter(id => route()?.messages.some(m => m.id === id)));
    }
    const listTop = $('#session-list').scrollTop, scroll = $('#transcripts').scrollTop, graphTop = $('#graph-scroll').scrollTop, graphLeft = $('#graph-scroll').scrollLeft;
    render(); $('#session-list').scrollTo({top:listTop,behavior:'instant'}); $('#transcripts').scrollTo({top:scroll,behavior:'instant'}); $('#graph-scroll').scrollTo({top:graphTop,left:graphLeft,behavior:'instant'}); scheduleRibbons();
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
function restore(target) { return run(() => api('/manage', 'POST', { ...target, action: 'restore' })); }

function clearRange() { state.chats.clear(); state.rangeStart = null; state.rangeEnd = null; }
function renameSession(item) {
    const sessions = item.sessions, initial = sessions.find(s => s.name === item.name) || sessions[0];
    modal('Rename session', (sessions.length > 1 ? `<label class="field">${t('Session')}<select name="sessionId" id="rename-session-picker">${sessions.map(s => `<option value="${esc(s.id)}" ${s.id === initial.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : '') + field('Session name', 'name', initial.name), async form => {
        await api('/trees/' + encodeURIComponent(item.id) + '?view=all');
        await api('/branches/' + encodeURIComponent(form.get('sessionId') || initial.id), 'PATCH', { name: form.get('name') });
    }, 'Rename');
    const picker = $('#rename-session-picker');
    if (picker) { picker.onchange = () => { $('#dialog-content [name=name]').value = sessions.find(s => s.id === picker.value).name; }; enhanceSelect(picker); }
}
function renameNode() {
    const n = selectedNode(); if (!n) return;
    modal('Rename node', field('Node title', 'name', n.name || ''), async form => {
        await api('/trees/' + state.tree.id, 'POST', { action: 'rename', nodeId: n.id, pathId: state.branchId, version: state.tree.version, name: form.get('name') });
    }, n.pending ? 'Save node' : 'Rename');
}
function trashDialog(target,count=1){
    const days=state.data.preferences?.trashRetentionDays||30;
    modal('Move to Trash',`<p>${t('Discard {count} complete paths or trees?',{count})}</p><p class="dialog-copy">${t('Cloud copies are removed on Sync. Recovery stays only on this device for {days} days. Shared context is protected.',{days})}</p><p class="dialog-copy">${t('All devices need Session Grove 0.13 or newer after the first Trash sync.')}</p>`,async()=>{await api('/trash','POST',target);state.tree=null;state.selected.clear();clearRange();},'Move to Trash');
}
function archivePath(){const p=route(),node=selectedNode();if(!node?.endBranchIds.includes(p.branchId))return;trashDialog({branchIds:[p.branchId],nodeId:node.id,version:state.tree.version});}
function renderTrash(){
    $('#list-title').textContent=t('Trash');$('#list-actions').innerHTML='';$('#active-notice').hidden=true;
    const trashDate = new Intl.DateTimeFormat(locale()==='zh'?'zh-CN':'en-US',{dateStyle:'medium',timeStyle:'short'});
    const query=state.query.toLocaleLowerCase(),entries=(state.data.trashEntries||[]).filter(e=>!e.restoredAt&&(!query||e.names.some(n=>n.toLocaleLowerCase().includes(query)))),native=(state.data.trashNative||[]).filter(i=>!query||(i.title||i.agent).toLocaleLowerCase().includes(query));
    $('#list-count').textContent=t('Recovery copies on this device');$('#search').placeholder=t('Search discarded titles…');
    $('#session-list').innerHTML=`<p class="trash-note">${t('Trash is for discarded work. Useful history belongs in Projects.')}</p>`+entries.filter(e=>!e.restoredAt).map(e=>`<article class="trash-row"><div><strong>${esc(e.names.join(', '))}</strong><small>${t(({pending:'Waiting for Sync',removed:'Cloud removed · cleanup pending',cleaned:'Cloud space reclaimed'})[e.state]||'Waiting for Sync')} · ${e.expired?t('Recovery expired'):t('Local recovery until {date}',{date:trashDate.format(new Date(e.expiresAt))})}</small></div>${!e.expired?`<button data-trash-restore="${esc(e.id)}">${t('Restore as a new session')}</button>`:''}</article>`).join('')+(!entries.length?`<p class="empty">${t('No local recovery copies.')}</p>`:'')+(native.length?`<section class="trash-native"><h2>${t('Native copies on this device')}</h2><p>${t('Close the corresponding agent before removing native copies. Referenced prefixes and changed files are kept for review.')}</p>${native.map(i=>`<article class="trash-row"><span>${esc(i.title||i.agent)}<small>${t(i.active?'Still active in the native client':'Deactivated native copy')}</small></span><button data-trash-native="${esc(i.branchId)}">${t('Remove native copy')}</button></article>`).join('')}</section>`:'');
    $$('[data-trash-restore]').forEach(el=>el.onclick=async()=>{let target;await run(async()=>{const r=await api('/trash/restore','POST',{id:el.dataset.trashRestore});target=r.projectIds[0];state.scope=PROJECTS;state.tree=null;state.projectFocus=target;state.olderProjects=true;for(const id of r.projectIds)state.expandedProjects.add(id);state.query='';$('#search').value='';toast(t(r.background?'Restored locally. Background visibility still follows Settings.':'Restored to Projects. It is not activated.'));});if(target)focusProject(target);});
    $$('[data-trash-native]').forEach(el=>el.onclick=()=>run(async()=>{const r=await api('/trash/native','POST',{branchIds:[el.dataset.trashNative]});if(r.blocked.length)toast(r.blocked.map(b=>t(b.reason)).join('\n'));}));
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
        modal('Activate', `<p class="dialog-copy">${t('Includes this node and all preceding context. Existing suffixes are preserved.')}</p><p><strong>${t('Title in your tool')}</strong><br><span id="activation-title"></span></p>${directoryField(local?.cwd || d.cwd)}<div id="activation-budget" role="status">${t('Loading…')}</div><button type="button" id="activate-as">${t('Change to another tool')}</button>${p.active && node.endBranchIds.includes(p.branchId) ? `<button type="button" id="deactivate-session">${t('Deactivate')}</button>` : ''}`, async form => {
            if (!checked || checkedPath !== form.get('cwd')) { await estimate(); if (!checked || checked.risk) return false; }
            if (!checked.complete) return false;
            const result = await api('/node-activation/activate', 'POST', { ...selection, cwd: form.get('cwd'), contextAcknowledgement: checked.fingerprint });
            state.branchId = result.branch.id; state.nodeId = result.nodeId; clearRange();
            toast(t('Open the active continuation from your agent’s session list.'));
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
                $('#activation-budget').innerHTML = `${c.estimated == null ? '' : `<p>≈ ${compactNumber(c.estimated)} tokens${c.window || c.compactAt ? ' / ' + compactNumber(c.window || c.compactAt) : ''}</p>`}${!c.complete ? `<p class="warning">${t(c.readiness === 'node-boundary' ? 'This node does not end at a completed turn. Select a completed node.' : 'This context is incomplete or unsupported. Check Source before activating.')}</p>` : c.risk ? `<p class="warning">${t('Context may be near its limit. Confirm before activating.')}</p>` : c.unknown ? `<p class="dialog-copy">${t('No reliable context limit was found in the local configuration.')}</p>` : ''}`;
                $('#dialog-submit').disabled = !c.complete; $('#dialog-submit').textContent = t(c.risk ? 'Activate anyway' : 'Confirm activation');
            } catch (e) { if (ticket === modalVersion && turn === generation) $('#dialog-error').textContent = e.message; }
        }
        cwd.oninput = () => { checked = null; generation++; $('#dialog-submit').disabled = true; estimate(); };
        $('#activate-as').onclick = () => conversionDialog(p, selection, cwd.value);
        if ($('#deactivate-session')) $('#deactivate-session').onclick = () => run(async () => { await api('/manage', 'POST', { action: 'deactivate', branchIds: [p.branchId] }); $('#dialog').close(); });
        await estimate();
    } catch (e) { toast(e.message); }
}
const modeName = mode => ({lean:'Balanced',full:'Complete text',messages:'Messages only'})[mode];
const contextCopy = mode => t(({lean:'Keeps messages, tool calls and errors. Shortens long read-only results.',full:'Keeps messages and full tool inputs/results.',messages:'Keeps user and assistant messages. Omits tool calls and results.'})[mode]);
async function conversionDialog(p, selection = {}, initialCwd = null) {
    try {
        const d = await api('/branches/' + p.branchId), target = p.agent === 'claude' ? 'codex' : 'claude';
        let previews = {}, checkedCwd = null, generation = 0, timer;
        modal('Activate as…', `<p>${p.agent==='claude'?'Claude':'Codex'} → ${target==='claude'?'Claude':'Codex'}</p>${directoryField(initialCwd || d.cwd)}<label class="field">${t('Context mode')}<select name="mode" aria-label="${t('Context mode')}">${['lean','full','messages'].map(mode=>`<option value="${mode}">${t(modeName(mode))}</option>`).join('')}</select></label><p class="dialog-copy">${t('Creates a separate session. Thinking and attachments stay in the original.')}</p><div id="conversion-preview" role="status"></div>`, async form => {
            const mode=form.get('mode'), cwd=form.get('cwd'), preview=previews[mode];
            if(!preview || checkedCwd!==cwd){await estimate();return false;}
            const result=await api('/convert','POST',{...selection,branchId:p.branchId,target,mode,cwd,fingerprint:preview.fingerprint,contextAcknowledgement:preview.budget.fingerprint});
            state.scope='active:'+target;state.tree=await api('/trees/'+encodeURIComponent(result.branch.id));state.branchId=result.branch.id;state.nodeId=state.tree.paths.find(path=>path.branchId===result.branch.id)?.nodeIds.at(-1);camera.newView=true;clearRange();toast(t('Open the active continuation from your agent’s session list.'));
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
        modal('Source & revisions', `${d.agent==='claude'?'<p class="dialog-copy">'+t('Native title source')+': '+t(({custom:'Custom title',automatic:'Automatic title','first-prompt':'First prompt'})[d.nativeTitleSource]||'Unknown')+'</p>':''}${d.warnings.map(w => `<p class="warning">${esc(errorText(w))}</p>`).join('')}${d.lineage.map(r => `<div class="source-entry">${esc(r.source.deviceName || t('Unknown device'))} · ${date(r.createdAt)}<br>${esc(r.source.cwd || d.cwd)}<br>${esc(r.source.client || '')}</div>`).join('')}`, null);
    } catch (e) { toast(e.message); }
}
async function settings(options = {}) {
    try {
        const c = await api('/settings'), edit = options.editConnection || !c.verified, editKey = options.editKey || !c.encryptionReady;
        const mask = '••••••••••••', p = c.preferences;
        const password = (label, name, stored, disabled = false) => `<label class="field">${t(label)}<input type="password" name="${name}" autocomplete="new-password" value="${stored ? mask : ''}" ${stored ? 'data-stored="true"' : ''} ${disabled ? 'disabled' : ''}></label>`;
        modal('Settings', `<div class="settings-top"><label class="field">${t('Language')}<select id="language"><option value="en" ${locale() === 'en' ? 'selected' : ''}>English</option><option value="zh" ${locale() === 'zh' ? 'selected' : ''}>中文</option></select></label></div>
          <section class="settings-card"><div class="settings-section-heading"><h3>WebDAV</h3>${!edit ? `<span class="setting-ok">✓ ${t('Verified')}</span><button type="button" id="modify-connection">${t('Modify')}</button>` : ''}</div>
          <label class="field">${t('WebDAV URL')}<span class="url-field"><input name="url" type="text" value="${esc(c.url)}" placeholder="https://host/dav" ${!edit ? 'disabled' : ''}><span class="fixed-suffix">${esc(c.suffix)}</span></span></label>
          <div class="settings-columns"><label class="field">${t('Username')}<input name="username" autocomplete="username" value="${esc(c.username)}" ${!edit ? 'disabled' : ''}></label>${password('Password', 'password', c.hasPassword, !edit)}</div>
          ${edit ? `<button type="button" id="verify-connection" class="primary" hidden>${t('Verify connection')}</button>` : ''}</section>
          ${!edit ? `<section class="settings-card"><div class="settings-section-heading"><h3>${t('Encryption')}</h3>${!editKey ? `<span class="${c.encrypted ? 'setting-ok' : 'setting-warning'}">${c.encrypted ? '✓ ' + t('Encrypted') : '⚠ ' + t('Not encrypted')}</span><button type="button" id="modify-encryption">${t('Modify')}</button>` : ''}</div>
            ${c.needsCurrentPassphrase ? `<div class="secret-row">${password('Current passphrase', 'currentPassphrase', false)}<button type="button" id="unlock-vault" class="primary" hidden>${t('Unlock vault')}</button></div><p class="dialog-copy">${t('This cloud vault is encrypted. Enter its existing passphrase to connect. Encryption can be changed afterward.')}</p>` : `<div class="secret-row">${password('Passphrase (optional)', 'passphrase', c.hasPassphrase, !editKey)}${editKey ? `<button type="button" id="confirm-encryption" class="primary">${t(c.hasPassphrase ? 'Keep encryption' : 'Continue without encryption')}</button>` : ''}</div>
            ${editKey ? `<p class="dialog-copy">${c.encryptionReady ? t('Pause sync on other devices while changing the vault. Other devices must reconnect afterward.') + '<br>' : ''}${t('Use at least 12 characters, or leave empty for no content encryption. Other devices need the same passphrase.')}</p>` : ''}`}
            ${c.encryptionReady && !state.data.cloud.started ? `<p class="setup-hint">${t('Ready. Close Settings and click Sync to review cloud synchronization.')}</p>` : ''}
            <div id="settings-progress" role="status" hidden></div>
          </section>` : ''}
          <section class="settings-card"><h3>${t('Trash')}</h3><label class="field">${t('Local recovery days')}<input type="number" name="trashRetentionDays" min="1" max="365" value="${p.trashRetentionDays}"></label><p class="dialog-copy">${t('Applies to newly discarded sessions. Expired copies are removed automatically when Grove runs.')}</p></section><section class="settings-card"><h3>${t('Project contents')}</h3><label class="field">${t('Collapse older sessions')}<select name="projectFoldMode">${[['time','By age'],['count','By count'],['none','Show all']].map(([v,l])=>`<option value="${v}" ${p.projectFoldMode===v?'selected':''}>${t(l)}</option>`).join('')}</select></label>${p.projectFoldMode==='time'?`<label class="field">${t('Keep recent days')}<input type="number" name="projectFoldDays" min="1" max="365" value="${p.projectFoldDays}"></label>`:p.projectFoldMode==='count'?`<label class="field">${t('Visible sessions per project')}<input type="number" name="projectFoldCount" min="1" max="365" value="${p.projectFoldCount}"></label>`:''}</section><section class="settings-card"><h3>${t('Automatic updates')}</h3><div class="timer-row"><label><input type="checkbox" name="showScheduledSessions" ${p.showScheduledSessions?'checked':''}>${t('Show scheduled and background sessions')}</label></div><p class="dialog-copy">${t('Changes save immediately. Native files are never deleted.')}</p>
            <label class="field">${t('Collapse inactive projects after')}<select name="inactiveProjectDays" aria-label="${t('Collapse inactive projects after')}">${[[7,'One week'],[15,'Half a month'],[30,'One month'],[60,'Two months']].map(([days,label])=>`<option value="${days}" ${days===p.inactiveProjectDays?'selected':''}>${t(label)}</option>`).join('')}</select></label>
            ${[['localUpdate', 'Read local sessions', p.localUpdateEnabled, p.localUpdateMinutes], ['autoUpload', 'Automatically upload local changes', p.autoUploadEnabled, p.autoUploadMinutes]].map(([key,label,on,minutes]) => `<div class="timer-row"><label><input type="checkbox" name="${key}Enabled" ${on ? 'checked' : ''}>${t(label)}</label><label class="timer-interval"><input type="number" name="${key}Minutes" value="${minutes}" min="1" max="1440" ${!on ? 'disabled' : ''}><span>${t('minutes')}</span></label></div>`).join('')}
            <p class="dialog-copy">${t('Every upload reads local sessions first. No changes means no scheduled cloud request.')}</p><button type="button" id="save-timers" hidden>${t('Save preferences')}</button>
          </section>${c.recoverable && c.job?.state !== 'running' ? `<button type="button" id="recover-settings">${t('Recover settings change')}</button>` : ''}`, null);
        $('#dialog-cancel').textContent = t('Close');
        enhanceSelect($('#language'));
        $('#language').onchange = async e => { setLocale(e.target.value); render(); await settings(options); };
        const busy = async (button, fn) => { if (working) return; working = true; button.disabled = true; const original = button.textContent; button.textContent = t('Working…'); $('#dialog-error').textContent = '';
            try { await fn(); } catch(e) { $('#dialog-error').textContent = e.message; } finally { working = false; renderCloudStatus(); if (button.isConnected) { button.disabled = false; button.textContent = original; } } };
        for(const input of $$('input[data-stored]')) { input.onfocus = () => { if(input.dataset.stored) { input.value = ''; delete input.dataset.stored; } }; input.onblur = () => { if(!input.value && input.name === 'password' && c.hasPassword) { input.value = mask; input.dataset.stored = 'true'; } }; }
        const values = () => { const result = {}; for(const el of $$('#dialog-content input[name]')) if (!el.disabled && !el.dataset.stored) result[el.name] = el.value; return result; };
        if ($('#modify-connection')) $('#modify-connection').onclick = () => settings({editConnection:true});
        if ($('#modify-encryption')) $('#modify-encryption').onclick = () => settings({editKey:true});
        if ($('#verify-connection')) {
            const validate = () => { const v = values(); $('#verify-connection').hidden = !v.url?.trim() || !v.username?.trim() || !(v.password || $('[name=password]').dataset.stored); };
            $$('input[name=url],input[name=username],input[name=password]').forEach(el => el.addEventListener('input',validate)); validate();
            $('#verify-connection').onclick = e => busy(e.currentTarget, async () => { await api('/settings/verify','POST',values()); await settings(); });
        }
        async function trackJob() {
            const box = $('#settings-progress'); if(!box) return;
            box.hidden = false; const button = $('#confirm-encryption') || $('#unlock-vault'); if(button) button.hidden = true;
            $$('[name=passphrase],[name=currentPassphrase],#modify-connection,#modify-encryption').forEach(el=>el.disabled=true);
            for (;;) {
                const current = await api('/settings'), j = current.job;
                if(!$('#dialog').open || !box.isConnected) return;
                const phases = {waiting:'Waiting for current sync',preparing:'Preparing',copying:'Re-encrypting and verifying',verifying:'Checking cloud versions',cleanup:'Removing previous copies',complete:'Complete'};
                box.innerHTML = `<span>${t(phases[j?.phase] || 'Working…')}${j?.total ? ` · ${j.completed}/${j.total}` : ''}</span><progress ${j?.total ? `max="${j.total}" value="${j.completed}"` : ''}></progress>`;
                if(j?.state === 'failed') { $('#dialog-error').textContent = errorText(j.error); box.innerHTML += `<button type="button" id="retry-settings">${t('Review settings')}</button>`; $('#retry-settings').onclick=()=>settings({editKey:true}); break; }
                if(j?.state === 'complete') { await refresh(); await settings(); if(j.cleanupPending) $('#dialog-error').textContent=t('New settings are active; some previous remote copies could not be removed.'); break; }
                await new Promise(r=>setTimeout(r,500));
            }
        }
        if($('#unlock-vault')) {
            const input=$('[name=currentPassphrase]'); input.oninput=()=>$('#unlock-vault').hidden=input.value.length<12;
            $('#unlock-vault').onclick=e=>busy(e.currentTarget,async()=>{await api('/settings/confirm','POST',{currentPassphrase:input.value});await trackJob();});
        }
        if ($('#confirm-encryption')) {
            const validate = () => { const el=$('[name=passphrase]'), value=el.value; const button=$('#confirm-encryption'); button.hidden=!!value&&!el.dataset.stored&&value.length<12; button.textContent=t(el.dataset.stored?'Keep encryption':value?'Set encryption':'Continue without encryption'); };
            $('[name=passphrase]').addEventListener('input',validate); $('[name=passphrase]').addEventListener('focus',validate); validate();
            $('#confirm-encryption').onclick=e=>busy(e.currentTarget,async()=>{ await api('/settings/confirm','POST',values()); await trackJob(); });
        }
        if(c.job?.state==='running') trackJob().catch(e=>$('#dialog-error').textContent=e.message);
        if($('#recover-settings')) $('#recover-settings').onclick=e=>busy(e.currentTarget,async()=>{await api('/settings/recover','POST',{});await refresh();await settings();});
        enhanceSelect($('[name=projectFoldMode]'));
        for(const el of $$('[name=projectFoldMode],[name=projectFoldDays],[name=projectFoldCount],[name=trashRetentionDays]'))el.onchange=async()=>{try{await api('/settings/timers','POST',{[el.name]:el.name==='projectFoldMode'?el.value:Number(el.value)});state.expandedProjects.clear();await refresh();await settings(options);}catch(e){$('#dialog-error').textContent=e.message;}};
        const timers = () => ({inactiveProjectDays:Number($('[name=inactiveProjectDays]').value),showScheduledSessions:$('[name=showScheduledSessions]').checked, ...Object.fromEntries(['localUpdate','autoUpload'].flatMap(k=>[[k+'Enabled',$(`[name=${k}Enabled]`).checked],[k+'Minutes',Number($(`[name=${k}Minutes]`).value)]]))});
        const validateTimers=()=>{const v=timers();for(const k of ['localUpdate','autoUpload']) $(`[name=${k}Minutes]`).disabled=!v[k+'Enabled'];$('#save-timers').hidden=Object.entries(v).every(([key,value])=>p[key]===value)||Object.entries(v).some(([k,n])=>k.endsWith('Minutes')&&(!Number.isInteger(n)||n<1||n>1440));};
        enhanceSelect($('[name=inactiveProjectDays]'));
        for(const el of $$('[name=showScheduledSessions],[name=inactiveProjectDays]')) el.onchange=async()=>{el.disabled=true;try{await api('/settings/timers','POST',el.type==='checkbox'?{showScheduledSessions:el.checked}:{inactiveProjectDays:Number(el.value)});await refresh();await settings(options);}catch(e){$('#dialog-error').textContent=e.message;el.disabled=false;}};
        $$('.timer-row input').forEach(el=>el.addEventListener('input',validateTimers));validateTimers();
        $('#save-timers').onclick=e=>busy(e.currentTarget,async()=>{await api('/settings/timers','POST',timers());await refresh();await settings(options);});
    } catch(e) { toast(e.message); }
}
function information() {
    modal('Information', `<details><summary>${t('When can I use each action?')}</summary><ul class="action-guide"><li>${t('Update reads local sessions. Sync pulls remote changes before pushing local work, including Pending.')}</li><li>${t('Move belongs to the session list. Select items before choosing a project.')}</li><li>${t('In a transcript, select a start and end to Combine or Dissolve a continuous range.')}</li><li>${t('Select a graph node to Rename it. Naming Pending makes it a saved node.')}</li><li>${t('Activate includes the selected node and its preceding context. Only session endpoints can move to Trash.')}</li><li>${t('Archived shows only archived paths with their prefixes. Restore returns a path to its project without activating it.')}</li></ul><p class="dialog-copy">${t('Token counts are estimates. Local configuration and recorded usage inform activation warnings; unknown limits are not guessed.')}</p><p class="dialog-copy">${t('Close running agents before changing native activation. Browsing and organization remain available.')}</p></details><details><summary>${t('Sync and local copies')}</summary><p>${t('Browsing uses the saved directory. Cloud icons mean the session is not on this device. Open it once to download and keep it locally. Sync refreshes the directory and downloaded sessions; unopened sessions remain cloud-only. Local edits start an automatic Push countdown.')}</p></details><details><summary>${t('Context mode')}</summary>${['lean','full','messages'].map(m=>`<p><strong>${t(modeName(m))}</strong> — ${contextCopy(m)}</p>`).join('')}<p>${t('Counts estimate packaged text, not exact model billing or live context. Target instructions and files may add tokens.')}</p></details><details><summary>${t('Diagnostics')}</summary><p class="dialog-copy">${t('Logs contain timings, operation types and error references; no conversation text, passwords, URLs or working paths.')}</p><button type="button" id="download-diagnostics">${t('Download diagnostics')}</button></details>${(state.data.plan?.pendingRecovery||[]).map(id=>`<button type="button" data-recover="${esc(id)}">${t('Recover interrupted operation')}</button>`).join('')}${state.data.conflicts.map((c,i)=>`<div class="conflict">${t('Conflict')}: ${esc(c.local.name)}<button type="button" data-conflict="${i}" data-choice="local">${t('Keep local')}</button><button type="button" data-conflict="${i}" data-choice="remote">${t('Use remote')}</button></div>`).join('')}`,null);
    const operation=state.data.cloud.operation, metrics=operation?.network;
    $('#dialog-content').insertAdjacentHTML('beforeend', `<details id="transfer-diagnostics"><summary>${t('Transfer statistics')}</summary><p>${t('Counters describe application payloads, not billed network traffic. Upload payload includes attempted requests; record counts confirm verified transfers. Download rate includes upload verification readbacks.')}</p>${metrics?`<dl><dt>${t('Downloaded')}</dt><dd>${bytesLabel(metrics.bytesReceived||0)}</dd><dt>${t('Upload payload')}</dt><dd>${bytesLabel(metrics.bytesSent||0)}</dd><dt>${t('Requests')}</dt><dd>${metrics.requests||0}</dd><dt>${t('Elapsed')}</dt><dd>${Math.round(((operation.finishedAt||Date.now())-operation.startedAt)/1000)} s</dd></dl>`:`<p>${t('Not recorded')}</p>`}${operation?.summary?`<p>${t('Cached sessions checked')}: ${operation.summary.checked||0} · ${t('Published items')}: ${operation.summary.published||0} · ${t('Verified records')}: ${operation.summary.uploaded||0}</p>`:''}</details>`);
    $('#download-diagnostics').onclick=async()=>{try{const report=await api('/diagnostics'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='session-grove-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('#dialog-error').textContent=e.message;}};
    $$('[data-conflict]').forEach(el=>el.onclick=()=>run(async()=>{await api('/conflicts/resolve','POST',{index:Number(el.dataset.conflict),choice:el.dataset.choice});$('#dialog').close();}));
    $$('[data-recover]').forEach(el=>el.onclick=()=>run(async()=>{await api('/recover','POST',{id:el.dataset.recover});$('#dialog').close();}));
}
function about() {
    modal('About', `<div class="about"><h3>Session Grove <small>${esc(state.data.appVersion || '')}</small></h3><p>${t('Organize agent conversations by project. Keep the context, choose the branch, continue your work.')}</p><p>${t('Developed by')} Ziyi Zhang</p><div class="about-links"><a href="https://ziyi-zhang.vercel.app" target="_blank" rel="noopener noreferrer" aria-label="Ziyi Zhang website" title="Ziyi Zhang">${icon('website')}</a><a href="https://github.com/MRziyi/session-grove" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" title="GitHub">${icon('github')}</a></div></div>`,null);
}
async function sync(direction = 'pull'){
    if(!state.data.cloud.configured||!state.data.cloud.unlocked)return settings();
    if(state.syncPreparing||state.data.cloud.phase==='syncing')return;
    state.syncPreparing=direction;syncPinned=true;showSyncPanel($('#transfer-progress'),$('#sync-details'));$('#sync-details').setAttribute('aria-expanded','true');renderCloudStatus();
    try{const result=await api('/synchronize/transfer','POST',{direction});state.syncOperation=result.operationId;const next=await api('/status');state.data.cloud=next.cloud;renderCloudStatus();}
    catch(e){toast(e.message);}finally{state.syncPreparing=false;renderCloudStatus();}
}
$('#about').onclick=about;$('#information').onclick=information;$('#sync').onclick=()=>sync('pull');$('#upload').onclick=()=>sync('push');$('#settings').onclick=()=>settings();
$('#sync-details').onclick=()=>{syncPinned=!syncPinned;if(syncPinned){showSyncPanel($('#transfer-progress'),$('#sync-details'));renderTransfer();}else hideSyncPanel($('#transfer-progress'));$('#sync-details').setAttribute('aria-expanded',String(syncPinned));};
$('#sync-details').onmouseenter=()=>{showSyncPanel($('#transfer-progress'),$('#sync-details'));renderTransfer();};
$('#sync-details').onmouseleave=e=>{if(!syncPinned&&!$('#transfer-progress').contains(e.relatedTarget))setTimeout(()=>{if(!syncPinned&&!$('#transfer-progress').matches(':hover'))hideSyncPanel($('#transfer-progress'));},150);};
$('#transfer-progress').onmouseleave=()=>{if(!syncPinned)hideSyncPanel($('#transfer-progress'));};
$('#push-zone').onmouseenter=$('#push-zone').onfocusin=showPendingUploads;
$('#push-zone').onmouseleave=$('#push-zone').onfocusout=e=>{if(!$('#push-zone').contains(e.relatedTarget))pendingTimer=setTimeout(()=>{pendingTicket++;hideSyncPanel($('#pending-uploads'));},180);};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){syncPinned=false;hideSyncPanel($('#transfer-progress'));hideSyncPanel($('#pending-uploads'));$('#sync-details').setAttribute('aria-expanded','false');}});
window.addEventListener('resize',()=>{for(const [panel,anchor]of [['transfer-progress','sync-details'],['pending-uploads','push-zone']])if(!$('#'+panel).hidden)positionSyncPanel($('#'+panel),$('#'+anchor));});

function applyPanePreferences(){
    const layout=$('#layout');layout.classList.toggle('nav-collapsed',localStorage.getItem('grove-nav-collapsed')==='true');layout.classList.toggle('rail-collapsed',localStorage.getItem('grove-rail-collapsed')==='true');
    $('#toggle-navigation').textContent=layout.classList.contains('nav-collapsed')?'›':'‹';$('#toggle-rail').textContent=layout.classList.contains('rail-collapsed')?'›':'‹';for(const [id,key,label]of [['toggle-navigation','nav','projects'],['toggle-rail','rail','session list']]){const expanded=!layout.classList.contains(key+'-collapsed');$('#'+id).setAttribute('aria-expanded',String(expanded));$('#'+id).title=t((expanded?'Collapse ':'Expand ')+label);}
    const ratio=Math.max(.2,Math.min(.8,Number(localStorage.getItem('grove-pane-ratio'))||.5));$('#editor').style.setProperty('--transcript-share',ratio+'fr');$('#editor').style.setProperty('--graph-share',(1-ratio)+'fr');scheduleRibbons();
}
for(const [button,key]of [['toggle-navigation','nav'],['toggle-rail','rail']])$('#'+button).onclick=()=>{const name='grove-'+key+'-collapsed';localStorage.setItem(name,String(localStorage.getItem(name)!=='true'));applyPanePreferences();};
const divider=$('#ribbon-lane');
divider.onpointerdown=e=>{if(e.button!==0)return;divider.setPointerCapture(e.pointerId);divider.dataset.dragging='true';e.preventDefault();};
divider.onpointermove=e=>{if(!divider.dataset.dragging)return;const rect=$('#editor').getBoundingClientRect(),ratio=Math.max(.2,Math.min(.8,(e.clientX-rect.left)/rect.width));localStorage.setItem('grove-pane-ratio',String(ratio));applyPanePreferences();};
divider.onpointerup=divider.onpointercancel=()=>{delete divider.dataset.dragging;};
divider.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();localStorage.setItem('grove-pane-ratio',String((Number(localStorage.getItem('grove-pane-ratio'))||.5)+(e.key==='ArrowRight'?.05:-.05)));applyPanePreferences();};
applyPanePreferences();
$('#collect').onclick = () => run(async () => { const r = await api('/collect', 'POST', {}); if (r.errors?.length) toast(r.errors.map(e => errorText(e.message)).join('\n')); else toast(t('Refresh complete · {updates} updated · {discovered} discovered', { updates: r.updates.length, discovered: r.discovered })); }, 'update');
$('#search').oninput = e => { state.query = e.target.value; state.selected.clear(); clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh().catch(e => toast(e.message)), 180); };
$('#back').onclick = () => { state.tree = null; clearRange(); render(); };
$('#source').onclick = showSource;
$('#branch-picker').onchange = e => { state.branchId = e.target.value; clearRange(); state.nodeId = null; state.compactionId = null; renderDetail(); };
$('#transcripts').onscroll = () => scheduleRibbons();
$('#zoom-in').onclick = () => zoom(1.15); $('#zoom-out').onclick = () => zoom(1 / 1.15); $('#graph-reset').onclick = resetCamera;
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
try {
    const boot = await (await fetch('/api/bootstrap')).json(); if (boot.error) throw new Error(errorText(boot.error));
    state.token = boot.token; state.data = boot; state.roots = boot.roots; $('#demo-badge').textContent = boot.demo ? 'DEMO' : '';
    setLocale(locale()); await refresh(); watchOperations();
    document.addEventListener('visibilitychange',()=>{if(document.hidden)eventController?.abort();else api('/status').then(next=>{state.data.cloud=next.cloud;state.data.update=next.update;renderCloudStatus();}).catch(()=>{});renderCloudStatus();});renderCloudStatus();
    setInterval(async () => {
        if (document.hidden) return;
        try {
            const next = await api('/status');
            if(next.cloud.operation)showOperation('sync',next.cloud.operation);
            if(next.update.operation)showOperation('update',next.update.operation);
            const canRefresh = !working && !opening && !$('#dialog').open && !state.chats.size;
            if (next.stateVersion !== state.data.stateVersion && canRefresh) await refresh();
            else { state.data.cloud = next.cloud; state.data.update = next.update; renderCloudStatus(); }
        } catch { /* Explicit Update reports connection errors. */ }
    }, 5000);
} catch (e) { toast(e.message); }
