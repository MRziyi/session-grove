import { markdown } from './markdown.js';
import { enhanceSelect } from './select.js';
import { t, locale, setLocale, errorText } from './i18n.js';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
    website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18Z"/>',
    github: '<path d="M9 19c-4 1-4-2-5-2m10 5v-3.9a3.4 3.4 0 0 0-1-2.7c3.3-.4 6.7-1.6 6.7-7.3a5.7 5.7 0 0 0-1.5-4c.1-1 .1-2.1-.5-3.1 0 0-1.2-.4-4 1.5a13.4 13.4 0 0 0-7 0C4.9.6 3.7 1 3.7 1c-.6 1-.6 2.1-.5 3.1a5.7 5.7 0 0 0-1.5 4c0 5.7 3.4 6.9 6.7 7.3a3.4 3.4 0 0 0-1 2.7V22"/>',
    upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6"/>',
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
const state = { data: null, token: '', roots: {}, scope: 'active:codex', list: { items: [] }, query: '', selected: new Set(), tree: null, branchId: null, nodeId: null, compactionId: null, chats: new Set(), rangeStart: null, rangeEnd: null, expanded: new Set() };
let submitAction, toastTimer, searchTimer, requestId = 0, working = false, opening = false;
const camera = { x: 0, y: 0, zoom: 1, width: 0, height: 0, rootX: 0, newView: true };
const compactNumber = n => new Intl.NumberFormat(locale() === 'zh' ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const tokenLabel = n => t('≈ {count} tokens', { count: compactNumber(n.tokens?.recordedEstimate ?? n.tokens?.estimate ?? 0) });
const tokenHint = () => t('Rough estimate of recorded message and tool text. Excludes hidden instructions, encrypted content and images; not live context usage.');
const cloudMark = item => item.projectId ? `<span class="cloud-mark ${item.cloudState || 'local'}" title="${esc(t(({ cloud: 'Stored in cloud · download on open', update: 'Cloud update available', cached: 'Cached locally · cloud synced', local: 'Local changes · not uploaded yet' })[item.cloudState || 'local']))}">${icon('cloud')}</span>` : '';
const date = value => value ? new Date(value).toLocaleString(locale() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('Never');
const currentProject = () => state.data.projects.find(p => p.id === state.scope);
const route = () => state.tree?.paths.find(p => p.branchId === state.branchId);
const selectedNode = () => state.tree?.nodes.find(n => n.id === state.nodeId);
const nodeName = n => n.name || `${t('Pending')} ${state.tree.nodes.filter(v => v.pending).findIndex(v => v.id === n.id) + 1}`;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 6000); }
async function api(path, method = 'GET', body) {
    const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Grove-Token': state.token }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json();
    if (!r.ok) throw new Error(errorText(data.error) + (data.requestId ? ` [${data.requestId}]` : ''));
    return data;
}
function modal(title, html, action, label = 'Save') {
    $('#dialog-title').textContent = t(title); $('#dialog-content').innerHTML = html; $('#dialog-error').textContent = '';
    $('#dialog-submit').textContent = t(label); $('#dialog-submit').hidden = !action; $('#dialog-submit').disabled = false;
    $('#dialog-cancel').textContent = t(action ? 'Cancel' : 'Close'); submitAction = action;
    if (!$('#dialog').open) $('#dialog').showModal();
}
const field = (label, name, value = '', type = 'text') => `<label class="field">${t(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${type === 'text' ? 'maxlength="200"' : ''}></label>`;
$('#dialog-close').onclick = $('#dialog-cancel').onclick = () => $('#dialog').close();
$('#dialog-form').onsubmit = async e => {
    e.preventDefault(); if (!submitAction || working) return;
    working = true; $('#dialog-submit').disabled = true;
    try { const complete = await submitAction(new FormData(e.target)); if (complete === false) return; $('#dialog').close(); await refresh(); }
    catch (e) { $('#dialog-error').textContent = e.message; }
    finally { working = false; $('#dialog-submit').disabled = false; }
};
async function run(fn) {
    if (working) return; working = true;
    try { await fn(); await refresh(); } catch (e) { toast(e.message); } finally { working = false; }
}
function button(id, label, fn) { const el = $(id); if (el) { el.textContent = t(label); el.onclick = fn; } }
function translateBanner() {
    for (const [id, glyph, label] of [['sync', 'sync', 'Sync'], ['collect', 'refresh', 'Update'], ['settings', 'settings', 'Settings']]) {
        const el = $('#' + id); el.innerHTML = `${icon(glyph)}<span class="button-label">${t(label)}</span>`; el.title = t(label); el.setAttribute('aria-label', t(label));
    }
    $('#about').textContent = t('About'); $('#information').title = t('Information'); $('#information').setAttribute('aria-label', t('Information'));
    $('#search-icon').innerHTML = icon('search'); $('#search').placeholder = t('Search title or content…'); $('#search').setAttribute('aria-label', t('Search title or content…'));
    $('#back').innerHTML = icon('back'); $('#back').title = t('Back to list'); $('#back').setAttribute('aria-label', t('Back to list'));
    $('#source').textContent = t('Source'); $('#source').title = t('Source & revisions'); $('#source').setAttribute('aria-label', t('Source & revisions'));
    $('#transcripts-title').textContent = t('Transcripts'); $('#graph-title').textContent = t('Graph'); $('#graph-reset').textContent = t('Reset view'); $('#zoom-in').title = t('Zoom in'); $('#zoom-out').title = t('Zoom out');
}
function renderNavigation() {
    const d = state.data;
    const entry = (scope, name, count, css = '') => `<button class="nav-entry ${css} ${state.scope === scope ? 'selected' : ''}" data-scope="${esc(scope)}" ${state.scope === scope ? 'aria-current="page"' : ''}><span class="nav-name">${esc(name)}${!scope.startsWith('active:') && scope !== 'archived' ? `<span class="cloud-mark" title="${t('Project sync')}">${icon('cloud')}</span>` : ''}</span><span class="count">${count}</span></button>`;
    const projects = d.projects.filter(p => !p.archived && (d.items.some(i => i.projectId === p.id && !i.archived) || p.count > 0));
    const archivedProjects = d.projects.filter(p => p.archived && (d.items.some(i => i.projectId === p.id) || p.index));
    const archivedSessions = d.items.filter(i => !archivedProjects.some(p => p.id === i.projectId)).reduce((n, i) => n + i.sessions.filter(s => s.archived).length, 0);
    $('#navigation').innerHTML = `<section class="nav-group"><h2 class="nav-label">${t('Current Active')}</h2>${entry('active:codex', 'Codex', d.activeCounts.codex, 'codex')}${entry('active:claude', 'Claude Code', d.activeCounts.claude, 'claude')}</section><section class="nav-group"><h2 class="nav-label">${t('Projects')}</h2>${projects.map(p => entry(p.id, p.name, Math.max(p.count || 0, d.items.filter(i => i.projectId === p.id && !i.archived).length))).join('') || `<p class="nav-empty">${t('No projects yet')}</p>`}</section><section class="nav-group"><h2 class="nav-label">${t('Archived')}</h2>${entry('archived', t('Archived items'), archivedProjects.length + archivedSessions)}</section>`;
    $$('[data-scope]').forEach(el => el.onclick = () => navigate(el.dataset.scope));
    const phase = d.cloud.phase, labels = { unconfigured: '', migrating: 'Updating settings…', locked: 'Sync locked', queued: 'Upload queued', syncing: 'Syncing…', synced: 'Synced', retrying: 'Retrying', local: 'Local changes' };
    $('#cloud-status').textContent = t(labels[phase] || ''); $('#cloud-status').title = d.cloud.error ? errorText(d.cloud.error) : '';
    const cloudTime = [d.cloud.lastUpload, d.cloud.lastCheck].filter(Boolean).sort().at(-1);
    $('#sync').querySelector('.sync-time')?.remove();
    if (cloudTime) { const time = document.createElement('time'); time.className = 'sync-time'; time.dateTime = cloudTime; time.textContent = new Date(cloudTime).toLocaleTimeString(locale() === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false }); $('#sync').append(time); }
    $('#sync').disabled = ['syncing','migrating'].includes(d.cloud.phase);
    $('#sync').title = t('Last upload: {time}', { time: date(d.cloud.lastUpload) }) + '\n' + t('Last cloud check: {time}', { time: date(d.cloud.lastCheck) });

}
async function navigate(scope) {
    ++requestId; opening = false; state.scope = scope; state.tree = null; state.list = { items: [], sessionCount: 0 }; state.query = ''; state.selected.clear(); clearRange(); $('#search').value = '';
    render(); $('#list-title').textContent = title(); $('#session-list').innerHTML = `<p class="empty">${t('Loading project index…')}</p>`;
    try { await refresh({ checkCloud: true }); } catch (e) { toast(e.message); state.list = { items: [] }; render(); }
}
function title() { return state.scope === 'active:codex' ? t('Active Codex Sessions') : state.scope === 'active:claude' ? t('Active Claude Code Sessions') : state.scope === 'archived' ? t('Archived') : currentProject()?.name || t('Projects'); }
function groups() {
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
    $('#list-title').textContent = title();
    $('#list-count').textContent = t('{count} sessions', { count: state.list.sessionCount || 0 });
    const selected = state.list.items.filter(i => state.selected.has(i.id)), ungrouped = selected.length && selected.every(i => !i.projectId);
    const mode = selected.length ? !!selected[0].projectId : null;
    $('#list-actions').innerHTML = selected.length
        ? `<span class="selection-count">${t('{count} selected', { count: selected.length })}</span>${state.scope === 'archived' ? '' : ungrouped || currentProject() ? '<button id="move-items"></button>' : '<button id="deactivate-items"></button>'}`
        : '';
    button('#move-items', 'Move to project', () => moveDialog([...state.selected]));
    button('#deactivate-items', 'Deactivate', () => run(() => api('/manage', 'POST', { action: 'deactivate', itemIds: [...state.selected], agent: state.scope.slice(7) })));
    $('#session-list').innerHTML = groups().map(g => `<section class="list-group">${!currentProject() ? `<h2>${esc(g.name)}${state.scope === 'archived' && state.data.projects.find(p => p.id === g.id)?.archived ? `<button class="restore-project" data-project="${esc(g.id)}">${t('Restore project')}</button>` : ''}</h2>` : ''}${g.items.map(i => `<article class="session-row ${state.selected.has(i.id) ? 'checked' : ''}" data-item="${esc(i.id)}"><button class="row-open" data-open="${esc(i.id)}">${icon(i.kind)}<span class="row-text"><span class="row-title">${esc(i.name)} ${cloudMark(i)}</span><span class="row-meta">${itemMeta(i)}</span></span><time class="row-date" datetime="${esc(i.updatedAt)}">${date(i.updatedAt)}</time></button>${state.scope === 'archived' ? '' : `<input type="checkbox" data-select="${esc(i.id)}" aria-label="${esc(t('Select {name}', { name: i.name }))}" ${state.selected.has(i.id) ? 'checked' : ''} ${mode !== null && mode !== !!i.projectId && state.scope !== 'archived' ? 'disabled' : ''}>`}</article>`).join('')}</section>`).join('') || `<p class="empty">${t(state.query ? 'No matching sessions' : state.scope.startsWith('active:') ? 'Start a conversation in your agent, then click Update.' : 'No sessions here.')}</p>`;
    $$('[data-open]').forEach(el => el.onclick = () => openTree(el.dataset.open));
    $$('[data-select]').forEach(el => el.onchange = () => { el.checked ? state.selected.add(el.dataset.select) : state.selected.delete(el.dataset.select); renderList(); });
    $$('.restore-project').forEach(el => el.onclick = () => run(() => api('/manage', 'POST', { action: 'restore', projectId: el.dataset.project })));
}
function renderRail() {
    $('#session-rail').innerHTML = groups().map(g => `<h2 class="rail-heading">${esc(g.name)}</h2>${g.items.map(i => `<button class="rail-row ${state.tree?.id === i.id ? 'selected' : ''}" data-rail="${esc(i.id)}" ${state.tree?.id === i.id ? 'aria-current="true"' : ''}>${icon(i.kind)}<span class="row-text"><span class="row-title">${esc(i.name)} ${cloudMark(i)}</span><span class="row-meta">${itemMeta(i)}</span></span></button>`).join('')}`).join('');
    $$('[data-rail]').forEach(el => el.onclick = () => openTree(el.dataset.rail));
}
async function openTree(id) {
    const ticket = ++requestId, scope = state.scope, view = scope === 'archived' ? 'archived' : 'in-use';
    const item = state.list.items.find(i => i.id === id);
    opening = true; state.tree = null; render(); $('#main').setAttribute('aria-busy', 'true');
    const label = $(`[data-item="${id}"] .row-meta`); if (label) label.textContent = t('Loading context…');
    try {
        const tree = await api('/trees/' + encodeURIComponent(id) + '?view=' + view + '&check=1');
        if (ticket !== requestId || state.scope !== scope) return;
        if (tree.view !== view || tree.paths.some(p => view === 'archived' ? !p.archived && !tree.projectArchived : p.archived || tree.projectArchived)) throw new Error(t('The view changed. Please open the session again.'));
        if (!tree.paths.length) { state.tree = null; render(); return; }
        state.tree = tree;
        state.branchId = [...(item?.matchedSessionIds || []), ...(item?.visibleSessionIds || [])].find(id => tree.paths.some(p => p.branchId === id)) || tree.paths[0].branchId;
        state.nodeId = null; state.compactionId = null; clearRange(); state.expanded.clear(); camera.x = 0; camera.y = 0; camera.zoom = 1; camera.newView = true; render();
    } catch (e) { if (ticket === requestId) { toast(e.message); state.tree = null; render(); } }
    finally { if (ticket === requestId) { opening = false; $('#main').removeAttribute('aria-busy'); } }
}

function render() {
    translateBanner(); renderNavigation(); renderList();
    const detail = !!state.tree;
    $('#layout').classList.toggle('detail', detail); $('#list-page').hidden = detail; $('#detail-page').hidden = !detail; $('#session-rail').hidden = !detail;
    if (detail) { renderRail(); renderDetail(); }
    else { $('#branch-picker').replaceChildren(); $('#transcripts').replaceChildren(); $('#graph').replaceChildren(); $('#ribbons').replaceChildren(); }
}
function renderDetail() {
    const tree = state.tree, p = route(); if (!p) { state.tree = null; render(); return; }
    $('#session-title').textContent = tree.name;
    const tokens = p.nodeIds.reduce((sum, id) => sum + (tree.nodes.find(n => n.id === id)?.tokens?.recordedEstimate || 0), 0);
    $('#session-meta').textContent = `${p.agent === 'codex' ? 'Codex' : 'Claude Code'} · ≈ ${compactNumber(tokens)} tokens${p.context?.compactions.length ? ' · ' + t('{count} compactions', { count: p.context.compactions.length }) : ''}`;
    $('#detail-count').textContent = `${t('{count} branches', { count: tree.paths.length })} · ${t('{count} chats', { count: tree.chatCount })} · ${t('{count} pending', { count: tree.pendingCount })}`;
    $('#branch-picker').innerHTML = tree.paths.map(v => `<option value="${esc(v.branchId)}" ${v.branchId === p.branchId ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    enhanceSelect($('#branch-picker'));
    renderDetailActions(); renderTranscript(); renderGraph(); scheduleRibbons();
}
function forkCheckpoint() {
    const p = route(), n = selectedNode(); if (!p || !n) return null;
    const last = p.messages.filter(m => n.chatIds.includes(m.id)).at(-1);
    const next = p.messages[p.messages.findIndex(m => m.id === last?.id) + 1];
    return p.checkpoints.find(c => c.end >= last?.line && (!next || c.end < next.line));
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
    $('#detail-actions').innerHTML = state.chats.size ? `<span>${t('{count} selected', { count: state.chats.size })}</span>${editable && state.rangeEnd !== null && canCombine() ? '<button id="combine"></button>' : ''}${editable && state.rangeEnd !== null && dissolve ? '<button id="dissolve"></button>' : ''}<button id="clear-selection"></button>` : node ? `${editable ? '<button id="rename-node"></button>' : ''}${terminal ? archived ? '<button id="restore-session"></button>' : `${(p.active && state.tree.projectId) || (!p.active && p.canActivate) ? '<button id="toggle-active"></button>' : ''}<button id="archive-path"></button>` : ''}${editable && forkCheckpoint() ? '<button id="fork"></button>' : ''}` : '';
    if (!state.chats.size && editable && p.active && p.contextPending && p.canRewriteContext) $('#detail-actions').innerHTML = '<button id="apply-context"></button>' + $('#detail-actions').innerHTML;
    button('#apply-context', 'Apply context', () => activateDialog(p, 'Apply context'));
    button('#combine', 'Combine', combineDialog);
    button('#dissolve', 'Dissolve', () => run(async () => { await saveOrganization('dissolve'); clearRange(); }));
    button('#clear-selection', 'Clear', () => { clearRange(); renderDetail(); });
    button('#toggle-active', p.active ? 'Deactivate' : 'Activate', () => p.active ? run(() => api('/manage', 'POST', { action: 'deactivate', branchIds: [p.branchId] })) : activateDialog(p));
    button('#restore-session', 'Restore', () => restore({ branchIds: [p.branchId] }));
    button('#fork', 'Fork', forkDialog);
    button('#rename-node', 'Rename', renameNode);
    button('#archive-path', 'Archive', archivePath);
}
function excerpt(text, expanded) {
    if (expanded || text.length < 380) return `<div class="markdown">${markdown(text)}</div>`;
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
    const shortened = paragraphs.length > 2 ? paragraphs[0].slice(0, 600) + '\n\n…\n\n' + paragraphs.at(-1).slice(-500) : text.slice(0, 210) + '\n\n…\n\n' + text.slice(-150);
    return `<div class="markdown">${markdown(shortened)}</div>`;
}
function activityHtml(entries, p) {
    if(!entries?.length) return '';
    return `<details class="activity"><summary>${t('Recorded activity')} · ${entries.length} · ≈ ${compactNumber(entries.reduce((n,e)=>n+e.tokens,0))} tokens</summary>${entries.map(e=>`<div class="activity-entry"><button type="button" data-record="${e.line}" data-head="${esc(p.head)}">${esc(e.label)} <span>${t(e.kind)}</span></button>${e.files?.length?`<div class="file-tags">${e.files.map(f=>`<code>${esc(f)}</code>`).join('')}</div>`:''}<span class="activity-cost">${e.opaque?t('Opaque or non-text; token size unknown'):'≈ '+compactNumber(e.tokens)+' tokens'}</span>${e.preview?`<pre>${esc(e.preview)}</pre>`:''}</div>`).join('')}</details>`;
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
    const p = route();
    $('#transcripts').innerHTML = contextBreakdown(p) + p.nodeIds.map(id => {
        const n = state.tree.nodes.find(n => n.id === id), messages = p.messages.filter(m => n.chatIds.includes(m.id));
        return `${compactionsAt(n, p).map(e => `<div class="compaction-marker">${t('Context compacted here')}${compactionButton(e)}</div>`).join('')}<section class="transcript-segment ${mutedNode(n, p) ? 'context-muted' : ''} ${n.pending ? 'pending' : ''}" data-segment="${esc(n.id)}" style="${style(n)}"><div class="segment-caption"><button data-focus-node="${esc(n.id)}">${esc(nodeName(n))} · ${t('{count} chats', { count: messages.length })}</button><span class="token-estimate" title="${esc(tokenHint())}">${tokenLabel(n)}</span></div>${messages.map(m => `<article class="chat ${m.role} ${state.chats.has(m.id) ? 'checked' : ''}">${state.scope === 'archived' ? '' : `<input type="checkbox" data-chat="${esc(m.id)}" aria-label="${esc(t('Select chat {number}', { number: p.messages.findIndex(x => x.id === m.id) + 1 }))}" ${state.chats.has(m.id) ? 'checked' : ''}>`}<div class="bubble"><span class="speaker">${m.role === 'user' ? t('You') : p.agent === 'codex' ? 'Codex' : 'Claude Code'}</span>${excerpt(m.text, state.expanded.has(m.id))}${activityHtml(m.activity,p)}${m.text.length >= 380 ? `<button class="expand-chat" data-expand="${esc(m.id)}">${t(state.expanded.has(m.id) ? 'Collapse' : 'Expand')}</button>` : ''}</div></article>`).join('')}</section>`;
    }).join('') || `<p class="empty">${t('No chats yet.')}</p>`;
    const trailing = (p.context?.compactions || []).filter(e => !p.messages.some(m => m.line > e.line));
    $('#transcripts').insertAdjacentHTML('beforeend', trailing.map(e => `<div class="compaction-marker">${t('Context compacted here')}${compactionButton(e)}</div>`).join(''));
    bindCompactions($('#transcripts'));
    $$('[data-record]').forEach(el=>el.onclick=async()=>{try{const r=await api('/branches/'+p.branchId+'/records/'+el.dataset.record+'?head='+encodeURIComponent(el.dataset.head));const payload=r.value?.payload||{}, content=payload.output??payload.arguments??payload.input; modal('Original context record', (content===undefined?'': '<pre class="record-detail">'+esc(typeof content==='string'?content:JSON.stringify(content,null,2))+'</pre>')+'<details '+(content===undefined?'open':'')+'><summary>'+t('Original context record')+'</summary><pre class="record-detail">'+esc(JSON.stringify(r.value,null,2))+'</pre></details>',null);}catch(e){toast(e.message);}});
    $$('#transcripts details').forEach(el=>el.addEventListener('toggle',scheduleRibbons));
    $('#range-hint').hidden = state.scope === 'archived';
    $('#range-hint').textContent = state.rangeStart === null ? t('Select a start, then an end.') : state.rangeEnd === null ? t('Start: {number} · select the end', { number: state.rangeStart + 1 }) : t('Selected chats {start}–{end}', { start: Math.min(state.rangeStart, state.rangeEnd) + 1, end: Math.max(state.rangeStart, state.rangeEnd) + 1 });
    $$('[data-chat]').forEach(el => el.onclick = e => {
        e.preventDefault();
        const index = p.messages.findIndex(m => m.id === el.dataset.chat);
        if (state.rangeStart === null || state.rangeEnd !== null && !e.shiftKey) { state.rangeStart = index; state.rangeEnd = null; }
        else state.rangeEnd = index;
        const end = state.rangeEnd ?? state.rangeStart;
        state.chats = new Set(p.messages.slice(Math.min(state.rangeStart, end), Math.max(state.rangeStart, end) + 1).map(m => m.id));
        state.nodeId = null; state.compactionId = null;
        const top = $('#transcripts').scrollTop; renderTranscript(); $('#transcripts').scrollTop = top; renderDetailActions(); renderGraph();
    });
    $$('[data-expand]').forEach(el => el.onclick = () => { const top = $('#transcripts').scrollTop; state.expanded.has(el.dataset.expand) ? state.expanded.delete(el.dataset.expand) : state.expanded.add(el.dataset.expand); renderTranscript(); $('#transcripts').scrollTop = top; scheduleRibbons(); });
    $$('[data-focus-node]').forEach(el => el.onclick = () => selectNode(el.dataset.focusNode, false));
}
function renderGraph() {
    const nodes = state.tree.nodes, p = route(), positions = new Map();
    let lane = 0;
    function place(n) {
        if (positions.has(n.id)) return positions.get(n.id);
        const children = n.childIds.map(id => place(nodes.find(n => n.id === id)));
        const x = children.length ? children.reduce((v, child) => v + child.x, 0) / children.length : lane++ * 174 + 12;
        const pos = { x, y: n.depth * 116 + 12 }; positions.set(n.id, pos); return pos;
    }
    nodes.filter(n => !n.parentIds.length).forEach(place);
    const width = Math.max(180, lane * 174), height = Math.max(160, ...nodes.map(n => n.depth * 116 + 110));
    camera.width = width; camera.height = height; camera.rootX = (positions.get(nodes.find(n => !n.parentIds.length)?.id)?.x || 0) + 74;
    if (camera.newView) { camera.x = $('#graph-scroll').clientWidth / 2 - camera.rootX; camera.y = 8; camera.newView = false; }
    $('#graph').style.width = `${width}px`; $('#graph').style.height = `${height}px`;
    $('#graph').innerHTML = `<svg class="graph-edges" width="${width}" height="${height}" aria-hidden="true">${state.tree.edges.map(e => { const a = positions.get(e.from), b = positions.get(e.to), n = nodes.find(n => n.id === e.to), color = palette[n.color][0]; return `<path d="M${a.x + 74},${a.y + 80} C${a.x + 74},${a.y + 102} ${b.x + 74},${b.y - 25} ${b.x + 74},${b.y}" fill="none" stroke="${color}" stroke-width="2" ${n.pending ? 'stroke-dasharray="4 4"' : ''}/>`; }).join('')}</svg>${nodes.map(n => { const pos = positions.get(n.id); return `<button class="graph-node ${mutedNode(n, p) ? 'context-muted' : ''} ${n.pending ? 'pending' : ''} ${n.id === state.nodeId ? 'selected' : ''} ${p.nodeIds.includes(n.id) ? '' : 'dimmed'}" data-node="${esc(n.id)}" style="${style(n)};left:${pos.x}px;top:${pos.y}px" aria-pressed="${n.id === state.nodeId}"><span class="node-title">${esc(nodeName(n))}</span><span class="node-meta">${t('{count} chats', { count: n.count })} · <span title="${esc(tokenHint())}">${tokenLabel(n)}</span></span>${n.endBranchIds.some(id => state.tree.paths.find(p => p.branchId === id)?.active) ? `<span class="end-label">${t('Active')}</span>` : ''}</button>`; }).join('')}`;
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
    $$('[data-node]').forEach(el => el.onclick = () => selectNode(el.dataset.node));
    applyCamera();
}
function selectNode(id, scrollTranscript = true) {
    const n = state.tree.nodes.find(n => n.id === id);
    if (!n.branchIds.includes(state.branchId)) { state.branchId = n.branchIds.find(id => !state.tree.paths.find(p => p.branchId === id).archived) || n.branchIds[0]; state.chats.clear(); }
    clearRange(); state.compactionId = null; state.nodeId = id;
    const top = $('#transcripts').scrollTop; renderDetail();
    if (scrollTranscript) $(`[data-segment="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else { $('#transcripts').scrollTop = top; revealNode(id); }
    scheduleRibbons();
}
let ribbonFrame = 0;
function scheduleRibbons() { if (!ribbonFrame) ribbonFrame = requestAnimationFrame(() => { ribbonFrame = 0; drawRibbons(); }); }
function drawRibbons() {
    if (!state.tree || $('#ribbon-lane').offsetWidth === 0) return;
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
    view.style.backgroundSize = `${18 * camera.zoom}px ${18 * camera.zoom}px`;
    view.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
    $('#zoom-label').textContent = Math.round(camera.zoom * 100) + '%';
    $('#zoom-out').disabled = camera.zoom <= .35; $('#zoom-in').disabled = camera.zoom >= 1.75;
    scheduleRibbons();
}
function zoom(delta, x, y) {
    const rect = $('#graph-scroll').getBoundingClientRect(), cx = x ?? rect.width / 2, cy = y ?? rect.height / 2;
    const next = Math.max(.35, Math.min(1.75, camera.zoom * delta)), ratio = next / camera.zoom;
    camera.x = cx - (cx - camera.x) * ratio; camera.y = cy - (cy - camera.y) * ratio; camera.zoom = next; applyCamera();
}
function resetCamera() {
    const view = $('#graph-scroll'); camera.zoom = 1; camera.x = view.clientWidth / 2 - camera.rootX; camera.y = 8; applyCamera();
}
function revealNode(id) {
    const el = $(`[data-node="${id}"]`); if (!el) return;
    const view = $('#graph-scroll').getBoundingClientRect(), rect = el.getBoundingClientRect();
    if (rect.left < view.left || rect.right > view.right) camera.x += view.left + (view.width - rect.width) / 2 - rect.left;
    if (rect.top < view.top || rect.bottom > view.bottom) camera.y += view.top + (view.height - rect.height) / 2 - rect.top;
    applyCamera();
}
async function refresh({ checkCloud = false } = {}) {
    if (opening) return;
    const id = ++requestId, scope = state.scope;
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
    const scroll = $('#transcripts').scrollTop, graphTop = $('#graph-scroll').scrollTop, graphLeft = $('#graph-scroll').scrollLeft;
    render(); $('#transcripts').scrollTop = scroll; $('#graph-scroll').scrollTop = graphTop; $('#graph-scroll').scrollLeft = graphLeft; scheduleRibbons();
}
function moveDialog(itemIds, restoreTarget = null) {
    const projects = state.data.projects.filter(p => !p.archived && (p.count > 0 || state.data.items.some(i => i.projectId === p.id)));
    modal(restoreTarget ? 'Restore to project' : 'Move to project', `<label class="field">${t('Destination project')}<select name="projectId" id="destination">${projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="new">${t('New project…')}</option></select></label><div id="new-project-field" ${projects.length ? 'hidden' : ''}>${field('Project name', 'projectName')}</div>`, async form => {
        const projectId = form.get('projectId');
        if (restoreTarget) await api('/manage', 'POST', { ...restoreTarget, action: 'restore', ...(projectId === 'new' ? { projectName: form.get('projectName') } : { destinationProjectId: projectId }) });
        else await api('/move', 'POST', { itemIds, ...(projectId === 'new' ? { projectName: form.get('projectName') } : { projectId }) });
        state.selected.clear(); toast(t(restoreTarget ? 'Restored to project' : 'Moved to project'));
    }, restoreTarget ? 'Restore' : 'Move');
    $('#destination').onchange = e => $('#new-project-field').hidden = e.target.value !== 'new';
    enhanceSelect($('#destination'));
}
function restore(target) {
    const ungrouped = state.data.items.some(i => !i.projectId && (target.itemIds?.includes(i.id) || i.sessionIds.some(id => target.branchIds?.includes(id))));
    if (ungrouped) return moveDialog([], target);
    return run(() => api('/manage', 'POST', { ...target, action: 'restore' }));
}
function clearRange() { state.chats.clear(); state.rangeStart = null; state.rangeEnd = null; }
function renameNode() {
    const n = selectedNode(); if (!n) return;
    modal('Rename node', field('Node title', 'name', n.name || ''), async form => {
        await api('/trees/' + state.tree.id, 'POST', { action: 'rename', nodeId: n.id, pathId: state.branchId, version: state.tree.version, name: form.get('name') });
    }, n.pending ? 'Save node' : 'Rename');
}
function archivePath() {
    const p = route(), node = selectedNode();
    if (!node?.endBranchIds.includes(p.branchId)) return;
    modal('Archive session', `<p>${esc(p.name)}</p><p class="dialog-copy">${t('Archive this complete path, including its shared prefix. Other in-use paths stay visible.')}</p>`, async () => {
        await api('/manage', 'POST', { action: 'archive', branchIds: [p.branchId], nodeId: node.id, version: state.tree.version }); state.nodeId = null;
    }, 'Archive');
}
async function activateDialog(p, actionLabel = 'Activate') {
    try {
        const d = await api('/branches/' + p.branchId), local = state.data.instances.filter(i => i.branchId === p.branchId).find(i => i.applied) || state.data.instances.filter(i => i.branchId === p.branchId).at(-1);
        let checkedPath = null, checked = null;
        modal(actionLabel, `${field('Working directory', 'cwd', local?.cwd || d.cwd)}<p class="dialog-copy">${t('Source')}: ${esc(d.lineage[0]?.source.deviceName || '')}<br>${esc(d.cwd)}</p><div id="activation-budget" role="status"></div>`, async form => {
            const cwd = form.get('cwd');
            if (!checked || checkedPath !== cwd) { checked = await api('/activation-check', 'POST', { branchId: p.branchId, cwd }); checkedPath = cwd; showBudget(checked); if (checked.risk) return false; }
            await api('/manage', 'POST', { action: 'activate', branchIds: [p.branchId], cwd, contextAcknowledgement: checked.fingerprint });
            toast(t('Open the active continuation from your agent’s session list.'));
        }, actionLabel);
        function showBudget(c) {
            if(c.fidelity === 'unsupported-history-mode') { $('#activation-budget').innerHTML = `<p class="warning">${t('The complete native history is unavailable. Update before changing context.')}</p>`; $('#dialog-submit').hidden = true; return; }
            $('#dialog-submit').hidden = !c.complete;
            $('#activation-budget').innerHTML = c.risk ? `<p class="warning">${t('Context may be near its limit: about {used} tokens, planning limit {limit}.', { used: compactNumber(c.estimated), limit: compactNumber(c.window || c.compactAt) })}<br>${esc(c.source || '')}</p>` : c.basis === 'incomplete-after-compaction' ? `<p class="dialog-copy">${t('The compacted context size is not recorded. The native agent will manage its context window.')}</p>` : c.unknown ? `<p class="dialog-copy">${t('No reliable context limit was found in the local configuration.')}</p>` : `<p class="dialog-copy">≈ ${compactNumber(c.estimated)} / ${compactNumber(c.window || c.compactAt)} tokens · ${esc(c.source || '')}</p>`;
            $('#dialog-submit').textContent = t(c.risk ? 'Activate anyway' : actionLabel);
        }
        checkedPath = local?.cwd || d.cwd; checked = await api('/activation-check', 'POST', { branchId: p.branchId, cwd: checkedPath }); showBudget(checked);
        $('[name=cwd]').oninput = () => { checked = null; $('#activation-budget').textContent = ''; $('#dialog-submit').textContent = t('Check & activate'); };
    } catch (e) { toast(e.message); }
}
function saveOrganization(action, name) { return api('/trees/' + state.tree.id, 'POST', { version: state.tree.version, pathId: state.branchId, chatIds: [...state.chats], action, name }); }
function combineDialog() {
    const p = route(), positions = p.messages.map((m, i) => state.chats.has(m.id) ? i : -1).filter(i => i >= 0);
    if (positions.at(-1) - positions[0] + 1 !== positions.length) return toast(t('Combine requires consecutive chats.'));
    modal('Combine', field('Node title', 'name'), async form => { await saveOrganization('combine', form.get('name')); clearRange(); }, 'Combine');
}
function forkDialog() {
    const p = route(), checkpoint = forkCheckpoint();
    if (!checkpoint) return toast(t('Fork at a node ending with a completed turn.'));
    modal('Create a branch', field('Branch name', 'name'), async form => {
        const b = await api('/branches/' + p.branchId + '/fork', 'POST', { name: form.get('name'), end: checkpoint.end, revisionId: p.head });
        state.branchId = b.id; clearRange(); toast(t('Branch created'));
    }, 'Create branch');
}
async function showSource() {
    try {
        const d = await api('/branches/' + state.branchId);
        modal('Source & revisions', `${d.warnings.map(w => `<p class="warning">${esc(errorText(w))}</p>`).join('')}${d.lineage.map(r => `<div class="source-entry">${esc(r.source.deviceName || t('Unknown device'))} · ${date(r.createdAt)}<br>${esc(r.source.cwd || d.cwd)}<br>${esc(r.source.client || '')}</div>`).join('')}`, null);
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
            ${c.needsCurrentPassphrase ? password('Current passphrase', 'currentPassphrase', false) : ''}
            <div class="secret-row">${password('Passphrase (optional)', 'passphrase', c.hasPassphrase, !editKey)}${editKey ? `<button type="button" id="confirm-encryption" class="primary">${t(c.hasPassphrase ? 'Keep encryption' : 'Continue without encryption')}</button>` : ''}</div>
            ${editKey ? `<p class="dialog-copy">${c.encryptionReady ? t('Pause sync on other devices while changing the vault. Other devices must reconnect afterward.') + '<br>' : ''}${t('Use at least 12 characters, or leave empty for no content encryption. Other devices need the same passphrase.')}</p>` : ''}
            <div id="settings-progress" role="status" hidden></div>
          </section>` : ''}
          <section class="settings-card"><h3>${t('Automatic updates')}</h3>
            ${[['localUpdate', 'Read local sessions', p.localUpdateEnabled, p.localUpdateMinutes], ['autoUpload', 'Upload changed projects', p.autoUploadEnabled, p.autoUploadMinutes]].map(([key,label,on,minutes]) => `<div class="timer-row"><label><input type="checkbox" name="${key}Enabled" ${on ? 'checked' : ''}>${t(label)}</label><label class="timer-interval"><input type="number" name="${key}Minutes" value="${minutes}" min="1" max="1440" ${!on ? 'disabled' : ''}><span>${t('minutes')}</span></label></div>`).join('')}
            <p class="dialog-copy">${t('Every upload reads local sessions first. No changes means no scheduled cloud request.')}</p><button type="button" id="save-timers" hidden>${t('Save intervals')}</button>
          </section>${c.recoverable && c.job?.state !== 'running' ? `<button type="button" id="recover-settings">${t('Recover settings change')}</button>` : ''}`, null);
        $('#dialog-cancel').textContent = t('Close');
        enhanceSelect($('#language'));
        $('#language').onchange = async e => { setLocale(e.target.value); render(); await settings(options); };
        const busy = async (button, fn) => { if (working) return; working = true; button.disabled = true; const original = button.textContent; button.textContent = t('Working…'); $('#dialog-error').textContent = '';
            try { await fn(); } catch(e) { $('#dialog-error').textContent = e.message; } finally { working = false; if (button.isConnected) { button.disabled = false; button.textContent = original; } } };
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
            box.hidden = false; const button = $('#confirm-encryption'); if(button) button.hidden = true;
            $$('[name=passphrase],[name=currentPassphrase],#modify-connection,#modify-encryption').forEach(el=>el.disabled=true);
            for (;;) {
                const current = await api('/settings'), j = current.job;
                if(!$('#dialog').open || !box.isConnected) return;
                const phases = {preparing:'Preparing',copying:'Re-encrypting and verifying',verifying:'Checking cloud versions',cleanup:'Removing previous copies',complete:'Complete'};
                box.innerHTML = `<span>${t(phases[j?.phase] || 'Working…')}${j?.total ? ` · ${j.completed}/${j.total}` : ''}</span><progress ${j?.total ? `max="${j.total}" value="${j.completed}"` : ''}></progress>`;
                if(j?.state === 'failed') { $('#dialog-error').textContent = errorText(j.error); box.innerHTML += `<button type="button" id="retry-settings">${t('Review settings')}</button>`; $('#retry-settings').onclick=()=>settings({editKey:true}); break; }
                if(j?.state === 'complete') { await refresh(); await settings(); if(j.cleanupPending) $('#dialog-error').textContent=t('New settings are active; some previous remote copies could not be removed.'); break; }
                await new Promise(r=>setTimeout(r,500));
            }
        }
        if ($('#confirm-encryption')) {
            const validate = () => { const el=$('[name=passphrase]'), value=el.value; const button=$('#confirm-encryption'); button.hidden=!!value&&!el.dataset.stored&&value.length<12; button.textContent=t(el.dataset.stored?'Keep encryption':value?'Set encryption':'Continue without encryption'); };
            $('[name=passphrase]').addEventListener('input',validate); $('[name=passphrase]').addEventListener('focus',validate); validate();
            $('#confirm-encryption').onclick=e=>busy(e.currentTarget,async()=>{ await api('/settings/confirm','POST',values()); await trackJob(); });
        }
        if(c.job?.state==='running') trackJob().catch(e=>$('#dialog-error').textContent=e.message);
        if($('#recover-settings')) $('#recover-settings').onclick=e=>busy(e.currentTarget,async()=>{await api('/settings/recover','POST',{});await refresh();await settings();});
        const timers = () => Object.fromEntries(['localUpdate','autoUpload'].flatMap(k=>[[k+'Enabled',$(`[name=${k}Enabled]`).checked],[k+'Minutes',Number($(`[name=${k}Minutes]`).value)]]));
        const validateTimers=()=>{const v=timers();for(const k of ['localUpdate','autoUpload']) $(`[name=${k}Minutes]`).disabled=!v[k+'Enabled'];$('#save-timers').hidden=JSON.stringify(v)===JSON.stringify(p)||Object.entries(v).some(([k,n])=>k.endsWith('Minutes')&&(!Number.isInteger(n)||n<1||n>1440));};
        $$('.timer-row input').forEach(el=>el.addEventListener('input',validateTimers));validateTimers();
        $('#save-timers').onclick=e=>busy(e.currentTarget,async()=>{await api('/settings/timers','POST',timers());await refresh();await settings(options);});
    } catch(e) { toast(e.message); }
}
function information() {
    modal('Information', `<h3>${t('When can I use each action?')}</h3><ul class="action-guide"><li>${t('Update reads local agent sessions. Sync publishes local changes, including Pending, and checks the cloud directory.')}</li><li>${t('Move belongs to the session list. Select items before choosing a project.')}</li><li>${t('In a transcript, select a start and end to Combine or Dissolve a continuous range.')}</li><li>${t('Select a graph node to Rename it. Naming Pending makes it a saved node.')}</li><li>${t('Fork appears only at a completed turn. Activate, Deactivate and Archive belong to a complete session endpoint.')}</li><li>${t('Archived shows only archived paths with their prefixes. Restore returns a path to its project without activating it.')}</li></ul><p class="dialog-copy">${t('Token counts are estimates. Local configuration and recorded usage inform activation warnings; unknown limits are not guessed.')}</p><p class="dialog-copy">${t('Close running agents before changing native activation. Browsing and organization remain available.')}</p><h3>${t('Diagnostics')}</h3><p class="dialog-copy">${t('Logs contain timings, operation types and error references; no conversation text, passwords, URLs or working paths.')}</p><button type="button" id="download-diagnostics">${t('Download diagnostics')}</button>${(state.data.plan?.pendingRecovery||[]).map(id=>`<button type="button" data-recover="${esc(id)}">${t('Recover interrupted operation')}</button>`).join('')}${state.data.conflicts.map((c,i)=>`<div class="conflict">${t('Conflict')}: ${esc(c.local.name)}<button type="button" data-conflict="${i}" data-choice="local">${t('Keep local')}</button><button type="button" data-conflict="${i}" data-choice="remote">${t('Use remote')}</button></div>`).join('')}`,null);
    $('#download-diagnostics').onclick=async()=>{try{const report=await api('/diagnostics'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='session-grove-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('#dialog-error').textContent=e.message;}};
    $$('[data-conflict]').forEach(el=>el.onclick=()=>run(async()=>{await api('/conflicts/resolve','POST',{index:Number(el.dataset.conflict),choice:el.dataset.choice});$('#dialog').close();}));
    $$('[data-recover]').forEach(el=>el.onclick=()=>run(async()=>{await api('/recover','POST',{id:el.dataset.recover});$('#dialog').close();}));
}
function about() {
    modal('About', `<div class="about"><h3>Session Grove <small>0.7.1</small></h3><p>${t('Organize agent conversations by project. Keep the context, choose the branch, continue your work.')}</p><p>${t('Developed by')} Ziyi Zhang</p><div class="about-links"><a href="https://ziyi-zhang.vercel.app" target="_blank" rel="noopener noreferrer" aria-label="Ziyi Zhang website" title="Ziyi Zhang">${icon('website')}</a><a href="https://github.com/MRziyi/session-grove" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" title="GitHub">${icon('github')}</a></div></div>`,null);
}
async function sync(direction) {
    if (!state.data.cloud.configured || !state.data.cloud.unlocked) return settings();
    return run(async () => { await api('/sync', 'POST', { direction }); toast(t('Sync complete')); });
}
$('#about').onclick = about; $('#information').onclick = information;
$('#sync').onclick = () => sync('both'); $('#settings').onclick = () => settings();
$('#collect').onclick = () => run(async () => { const r = await api('/collect', 'POST', {}); if (r.errors?.length) toast(r.errors.map(e => errorText(e.message)).join('\n')); else toast(t('Refresh complete · {updates} updated · {discovered} discovered', { updates: r.updates.length, discovered: r.discovered })); });
$('#search').oninput = e => { state.query = e.target.value; state.selected.clear(); clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh().catch(e => toast(e.message)), 180); };
$('#back').onclick = () => { state.tree = null; clearRange(); render(); };
$('#source').onclick = showSource;
$('#branch-picker').onchange = e => { state.branchId = e.target.value; clearRange(); state.nodeId = null; state.compactionId = null; renderDetail(); };
$('#transcripts').onscroll = () => scheduleRibbons();
$('#zoom-in').onclick = () => zoom(1.15); $('#zoom-out').onclick = () => zoom(1 / 1.15); $('#graph-reset').onclick = resetCamera;
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
window.addEventListener('focus', () => { if (!state.data || working || opening) return; api('/cloud/check', 'POST', {}).then(() => refresh()).catch(() => {}); });
window.addEventListener('resize', () => scheduleRibbons());
try {
    const boot = await (await fetch('/api/bootstrap')).json(); if (boot.error) throw new Error(errorText(boot.error));
    state.token = boot.token; state.data = boot; state.roots = boot.roots; $('#demo-badge').textContent = boot.demo ? 'DEMO' : '';
    setLocale(locale()); await refresh();
    let fingerprint = JSON.stringify([state.data.branches, state.data.projects, state.data.instances, state.data.items]);
    setInterval(async () => {
        if (document.hidden || working || opening || $('#dialog').open || state.chats.size) return;
        try {
            const next = await api('/state'), value = JSON.stringify([next.branches, next.projects, next.instances, next.items]);
            if (value !== fingerprint) { fingerprint = value; await refresh(); }
            else { state.data.cloud = next.cloud; renderNavigation(); }
        } catch { /* Explicit Update reports connection errors. */ }
    }, 5000);
} catch (e) { toast(e.message); }
