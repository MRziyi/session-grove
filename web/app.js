import { t, locale, setLocale, errorText } from './i18n.js';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
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
    'pending-0': ['#cf9955', '#fff2dc'], 'pending-1': ['#c78575', '#fcebe4'], 'pending-2': ['#b587ab', '#f7eaf4'], 'pending-3': ['#b59a50', '#faf2d6']
};
const style = n => { const [tone, tint] = palette[n.color]; return `--tone:${tone};--tint:${tint}`; };
const state = { data: null, token: '', roots: {}, scope: 'active:codex', list: { items: [] }, query: '', selected: new Set(), tree: null, branchId: null, nodeId: null, chats: new Set(), expanded: new Set() };
let submitAction, toastTimer, searchTimer, requestId = 0, working = false;
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
    if (!r.ok) throw new Error(errorText(data.error));
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
    try { await submitAction(new FormData(e.target)); $('#dialog').close(); await refresh(); }
    catch (e) { $('#dialog-error').textContent = e.message; }
    finally { working = false; $('#dialog-submit').disabled = false; }
};
async function run(fn) {
    if (working) return; working = true;
    try { await fn(); await refresh(); } catch (e) { toast(e.message); } finally { working = false; }
}
function button(id, label, fn) { const el = $(id); if (el) { el.textContent = t(label); el.onclick = fn; } }
function translateBanner() {
    for (const [id, glyph, label] of [['upload', 'upload', 'Upload'], ['sync', 'sync', 'Sync'], ['collect', 'refresh', 'Update'], ['settings', 'settings', 'Settings']]) {
        const el = $('#' + id); el.innerHTML = `${icon(glyph)}<span class="button-label">${t(label)}</span>`; el.title = t(label); el.setAttribute('aria-label', t(label));
    }
    $('#language').textContent = locale() === 'en' ? '中文' : 'EN';
    $('#search-icon').innerHTML = icon('search'); $('#search').placeholder = t('Search title or content…'); $('#search').setAttribute('aria-label', t('Search title or content…'));
    $('#back').innerHTML = icon('back'); $('#back').title = t('Back to list'); $('#back').setAttribute('aria-label', t('Back to list'));
    $('#source').innerHTML = icon('source'); $('#source').title = t('Source & revisions'); $('#source').setAttribute('aria-label', t('Source & revisions'));
    $('#context-info').textContent = t('Context');
    $('#transcripts-title').textContent = t('Transcripts'); $('#graph-title').textContent = t('Graph'); $('#graph-hint').textContent = '';
}
function renderNavigation() {
    const d = state.data;
    const entry = (scope, name, count, css = '') => `<button class="nav-entry ${css} ${state.scope === scope ? 'selected' : ''}" data-scope="${esc(scope)}" ${state.scope === scope ? 'aria-current="page"' : ''}><span class="nav-name">${esc(name)}${!scope.startsWith('active:') && scope !== 'archived' ? `<span class="cloud-mark" title="${t('Project sync')}">${icon('cloud')}</span>` : ''}</span><span class="count">${count}</span></button>`;
    const projects = d.projects.filter(p => !p.archived && (d.items.some(i => i.projectId === p.id && !i.archived) || p.count > 0));
    const archivedProjects = d.projects.filter(p => p.archived && (d.items.some(i => i.projectId === p.id) || p.index));
    const archivedSessions = d.items.filter(i => !archivedProjects.some(p => p.id === i.projectId)).reduce((n, i) => n + i.sessions.filter(s => s.archived).length, 0);
    $('#navigation').innerHTML = `<section class="nav-group"><h2 class="nav-label">${t('Current Active')}</h2>${entry('active:codex', 'Codex', d.activeCounts.codex, 'codex')}${entry('active:claude', 'Claude Code', d.activeCounts.claude, 'claude')}</section><section class="nav-group"><h2 class="nav-label">${t('Projects')}</h2>${projects.map(p => entry(p.id, p.name, Math.max(p.count || 0, d.items.filter(i => i.projectId === p.id && !i.archived).length))).join('') || `<p class="nav-empty">${t('No projects yet')}</p>`}</section><section class="nav-group"><h2 class="nav-label">${t('Archived')}</h2>${entry('archived', t('Archived'), archivedProjects.length + archivedSessions)}</section>`;
    $$('[data-scope]').forEach(el => el.onclick = () => navigate(el.dataset.scope));
    const phase = d.cloud.phase, labels = { unconfigured: '', locked: 'Sync locked', queued: 'Upload queued', syncing: 'Syncing…', synced: 'Synced', retrying: 'Retrying', local: 'Local changes' };
    $('#cloud-status').textContent = t(labels[phase] || ''); $('#cloud-status').title = d.cloud.error ? errorText(d.cloud.error) : '';
    $('#upload').disabled = !d.cloud.dirty || d.cloud.phase === 'syncing';
    $('#upload').title = t('Last upload: {time}', { time: date(d.cloud.lastUpload) }) + (d.cloud.dirty ? '\n' + t('Upload includes unorganized Pending.') : '\n' + t('No local changes to upload.'));
    $('#upload').classList.toggle('has-changes', !!d.cloud.dirty);
    $('#sync').title = t('Last cloud check: {time}', { time: date(d.cloud.lastCheck) });
}
async function navigate(scope) {
    state.scope = scope; state.tree = null; state.query = ''; state.selected.clear(); state.chats.clear(); $('#search').value = '';
    renderNavigation(); $('#list-title').textContent = title(); $('#session-list').innerHTML = `<p class="empty">${t('Loading project index…')}</p>`;
    try { await refresh(); } catch (e) { toast(e.message); state.list = { items: [] }; render(); }
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
        ? `<span class="selection-count">${t('{count} selected', { count: selected.length })}</span>${state.scope === 'archived' ? '<button id="restore-items"></button>' : ungrouped ? '<button id="move-items"></button><button id="archive-items"></button>' : state.scope.startsWith('active:') ? '<button id="deactivate-items"></button>' : '<button id="archive-items"></button>'}`
        : '';
    if (currentProject() && selected.length === state.list.items.length && selected.length && !state.query) $('#list-actions').innerHTML += '<button id="archive-project"></button>';
    button('#move-items', 'Move to project', () => moveDialog([...state.selected]));
    button('#archive-items', 'Archive', () => archiveDialog({ itemIds: [...state.selected] }));
    button('#restore-items', 'Restore', () => restore({ itemIds: [...state.selected] }));
    button('#deactivate-items', 'Deactivate', () => run(() => api('/manage', 'POST', { action: 'deactivate', itemIds: [...state.selected], agent: state.scope.slice(7) })));
    button('#archive-project', 'Archive project', () => archiveDialog({ projectId: currentProject().id }));
    $('#session-list').innerHTML = groups().map(g => `<section class="list-group">${!currentProject() ? `<h2>${esc(g.name)}${state.scope === 'archived' && state.data.projects.find(p => p.id === g.id)?.archived ? `<button class="restore-project" data-project="${esc(g.id)}">${t('Restore project')}</button>` : ''}</h2>` : ''}${g.items.map(i => `<article class="session-row ${state.selected.has(i.id) ? 'checked' : ''}" data-item="${esc(i.id)}"><button class="row-open" data-open="${esc(i.id)}">${icon(i.kind)}<span class="row-text"><span class="row-title">${esc(i.name)} ${cloudMark(i)}</span><span class="row-meta">${itemMeta(i)}</span></span><time class="row-date" datetime="${esc(i.updatedAt)}">${date(i.updatedAt)}</time></button><input type="checkbox" data-select="${esc(i.id)}" aria-label="${esc(t('Select {name}', { name: i.name }))}" ${state.selected.has(i.id) ? 'checked' : ''} ${mode !== null && mode !== !!i.projectId && state.scope !== 'archived' ? 'disabled' : ''}></article>`).join('')}</section>`).join('') || `<p class="empty">${t(state.query ? 'No matching sessions' : state.scope.startsWith('active:') ? 'Start a conversation in your agent, then click Update.' : 'No sessions here.')}</p>`;
    $$('[data-open]').forEach(el => el.onclick = () => openTree(el.dataset.open));
    $$('[data-select]').forEach(el => el.onchange = () => { el.checked ? state.selected.add(el.dataset.select) : state.selected.delete(el.dataset.select); renderList(); });
    $$('.restore-project').forEach(el => el.onclick = () => run(() => api('/manage', 'POST', { action: 'restore', projectId: el.dataset.project })));
}
function renderRail() {
    $('#session-rail').innerHTML = groups().map(g => `<h2 class="rail-heading">${esc(g.name)}</h2>${g.items.map(i => `<button class="rail-row ${state.tree?.id === i.id ? 'selected' : ''}" data-rail="${esc(i.id)}" ${state.tree?.id === i.id ? 'aria-current="true"' : ''}>${icon(i.kind)}<span class="row-text"><span class="row-title">${esc(i.name)} ${cloudMark(i)}</span><span class="row-meta">${itemMeta(i)}</span></span></button>`).join('')}`).join('');
    $$('[data-rail]').forEach(el => el.onclick = () => openTree(el.dataset.rail));
}
async function openTree(id) {
    $('#main').setAttribute('aria-busy', 'true');
    const label = $(`[data-item="${id}"] .row-meta`); if (label) label.textContent = t('Loading context…');
    try {
        const tree = await api('/trees/' + encodeURIComponent(id)), item = state.list.items.find(i => i.id === id);
        state.tree = tree;
        state.branchId = item?.matchedSessionIds?.find(id => tree.paths.some(p => p.branchId === id)) || item?.visibleSessionIds?.[0] || tree.paths.find(p => !p.archived)?.branchId || tree.paths[0]?.branchId;
        state.nodeId = null;
        state.chats.clear(); state.expanded.clear(); render();
    } catch (e) { toast(e.message); renderList(); }
    finally { $('#main').removeAttribute('aria-busy'); }
}
function render() {
    translateBanner(); renderNavigation(); renderList();
    const detail = !!state.tree;
    $('#layout').classList.toggle('detail', detail); $('#list-page').hidden = detail; $('#detail-page').hidden = !detail; $('#session-rail').hidden = !detail;
    if (detail) { renderRail(); renderDetail(); }
}
function renderDetail() {
    const tree = state.tree, p = route(); if (!p) return;
    $('#session-title').textContent = tree.name;
    $('#detail-count').textContent = `${t('{count} branches', { count: tree.paths.length })} · ${t('{count} chats', { count: tree.chatCount })} · ${t('{count} pending', { count: tree.pendingCount })}`;
    $('#branch-picker').innerHTML = tree.paths.map(v => `<option value="${esc(v.branchId)}" ${v.branchId === p.branchId ? 'selected' : ''}>${esc(v.name)}${v.archived ? ' · ' + t('Archived') : ''}</option>`).join('');
    renderDetailActions(); renderTranscript(); renderGraph(); requestAnimationFrame(drawRibbons);
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
        return end >= positions[0] && end < positions.at(-1) && (n.childIds.length > 1 || n.endBranchIds.length);
    });
}
function renderDetailActions() {
    const p = route(), node = selectedNode(), terminal = node?.endBranchIds.includes(p.branchId);
    const archived = p.archived || state.data.projects.find(v => v.id === state.tree.projectId)?.archived;
    const dissolve = state.tree.nodes.some(n => !n.pending && n.chatIds.some(id => state.chats.has(id)));
    $('#detail-actions').innerHTML = state.chats.size ? `<span>${t('{count} selected', { count: state.chats.size })}</span>${canCombine() ? '<button id="combine"></button>' : ''}${dissolve ? '<button id="dissolve"></button>' : ''}<button id="clear-selection"></button>` : node ? `${terminal ? p.active ? '<button id="toggle-active"></button>' : archived ? '<button id="restore-session"></button>' : '<button id="toggle-active"></button>' : ''}${!archived && forkCheckpoint() ? '<button id="fork"></button>' : ''}` : '';
    button('#combine', 'Combine', combineDialog);
    button('#dissolve', 'Dissolve', () => run(async () => { await saveOrganization('dissolve'); state.chats.clear(); }));
    button('#clear-selection', 'Clear', () => { state.chats.clear(); renderDetail(); });
    button('#toggle-active', p.active ? 'Deactivate' : 'Activate', () => p.active ? run(() => api('/manage', 'POST', { action: 'deactivate', branchIds: [p.branchId] })) : activateDialog(p));
    button('#restore-session', 'Restore', () => restore({ branchIds: [p.branchId] }));
    button('#fork', 'Fork', forkDialog);
}
function excerpt(text, expanded) {
    if (expanded || text.length < 380) return esc(text);
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
    if (paragraphs.length > 2) return esc(paragraphs[0].slice(0, 600)) + '\n\n…\n\n' + esc(paragraphs.at(-1).slice(-500));
    return esc(text.slice(0, 210)) + '\n…\n' + esc(text.slice(-150));
}
function renderTranscript() {
    const p = route();
    $('#transcripts').innerHTML = p.nodeIds.map(id => {
        const n = state.tree.nodes.find(n => n.id === id), messages = p.messages.filter(m => n.chatIds.includes(m.id));
        return `${n.afterCompaction ? `<div class="compaction-marker">${t('Context compacted here')} <button data-context>${t('Inspect')}</button></div>` : ''}<section class="transcript-segment ${n.pending ? 'pending' : ''}" data-segment="${esc(n.id)}" style="${style(n)}"><div class="segment-caption"><input type="checkbox" data-select-node="${esc(n.id)}" aria-label="${esc(t('Select {name}', { name: nodeName(n) }))}" ${messages.every(m => state.chats.has(m.id)) ? 'checked' : ''}><button data-focus-node="${esc(n.id)}">${esc(nodeName(n))} · ${t('{count} chats', { count: messages.length })}</button><span class="token-estimate" title="${esc(tokenHint())}">${tokenLabel(n)}</span></div>${messages.map(m => `<article class="chat ${m.role} ${state.chats.has(m.id) ? 'checked' : ''}"><input type="checkbox" data-chat="${esc(m.id)}" aria-label="${esc(t('Select chat {number}', { number: p.messages.findIndex(x => x.id === m.id) + 1 }))}" ${state.chats.has(m.id) ? 'checked' : ''}><div class="bubble"><span class="speaker">${m.role === 'user' ? t('You') : p.agent === 'codex' ? 'Codex' : 'Claude Code'}</span>${excerpt(m.text, state.expanded.has(m.id))}${m.text.length >= 380 ? `<button class="expand-chat" data-expand="${esc(m.id)}">${t(state.expanded.has(m.id) ? 'Collapse' : 'Expand')}</button>` : ''}</div></article>`).join('')}</section>`;
    }).join('') || `<p class="empty">${t('No chats yet.')}</p>`;
    $$('[data-context]').forEach(el => el.onclick = showContext);
    $$('[data-chat]').forEach(el => el.onchange = () => {
        el.checked ? state.chats.add(el.dataset.chat) : state.chats.delete(el.dataset.chat);
        el.closest('.chat').classList.toggle('checked', el.checked); renderDetailActions();
        $$('[data-select-node]').forEach(check => { const n = state.tree.nodes.find(n => n.id === check.dataset.selectNode); const count = n.chatIds.filter(id => state.chats.has(id)).length; check.checked = count === n.count; check.indeterminate = count > 0 && count < n.count; });
    });
    $$('[data-select-node]').forEach(el => el.onchange = () => { const top = $('#transcripts').scrollTop; const n = state.tree.nodes.find(n => n.id === el.dataset.selectNode); n.chatIds.forEach(id => el.checked ? state.chats.add(id) : state.chats.delete(id)); renderTranscript(); $('#transcripts').scrollTop = top; renderDetailActions(); });
    $$('[data-expand]').forEach(el => el.onclick = () => { const top = $('#transcripts').scrollTop; state.expanded.has(el.dataset.expand) ? state.expanded.delete(el.dataset.expand) : state.expanded.add(el.dataset.expand); renderTranscript(); $('#transcripts').scrollTop = top; requestAnimationFrame(drawRibbons); });
    $$('[data-focus-node]').forEach(el => el.onclick = () => selectNode(el.dataset.focusNode, false));
}
function renderGraph() {
    const nodes = state.tree.nodes, p = route(), positions = new Map();
    let lane = 0;
    function place(n) {
        if (positions.has(n.id)) return positions.get(n.id);
        const children = n.childIds.map(id => place(nodes.find(n => n.id === id)));
        const x = children.length ? children.reduce((v, child) => v + child.x, 0) / children.length : lane++ * 200 + 12;
        const pos = { x, y: n.depth * 150 + 12 }; positions.set(n.id, pos); return pos;
    }
    nodes.filter(n => !n.parentIds.length).forEach(place);
    const width = Math.max(180, lane * 200), height = Math.max(160, ...nodes.map(n => n.depth * 150 + 145));
    $('#graph').style.width = `${width}px`; $('#graph').style.height = `${height}px`;
    $('#graph').innerHTML = `<svg class="graph-edges" width="${width}" height="${height}" aria-hidden="true">${state.tree.edges.map(e => { const a = positions.get(e.from), b = positions.get(e.to), n = nodes.find(n => n.id === e.to), color = palette[n.color][0]; return `<path d="M${a.x + 86},${a.y + 112} C${a.x + 86},${a.y + 132} ${b.x + 86},${b.y - 25} ${b.x + 86},${b.y}" fill="none" stroke="${color}" stroke-width="2" ${n.pending ? 'stroke-dasharray="4 4"' : ''}/>`; }).join('')}</svg>${nodes.map(n => { const pos = positions.get(n.id); return `<button class="graph-node ${n.pending ? 'pending' : ''} ${n.id === state.nodeId ? 'selected' : ''} ${p.nodeIds.includes(n.id) ? '' : 'dimmed'}" data-node="${esc(n.id)}" style="${style(n)};left:${pos.x}px;top:${pos.y}px" aria-pressed="${n.id === state.nodeId}"><span class="node-title">${esc(nodeName(n))}</span><span class="node-meta">${t('{count} chats', { count: n.count })} · <span title="${esc(tokenHint())}">${tokenLabel(n)}</span></span>${n.afterCompaction ? `<span class="compaction-label">${t('After compaction')}</span>` : ''}${n.endBranchIds.some(id => state.tree.paths.find(p => p.branchId === id)?.active) ? `<span class="end-label">${t('Active')}</span>` : ''}</button>`; }).join('')}`;
    $$('[data-node]').forEach(el => el.onclick = () => selectNode(el.dataset.node));
}
function selectNode(id, scrollTranscript = true) {
    const n = state.tree.nodes.find(n => n.id === id);
    if (!n.branchIds.includes(state.branchId)) { state.branchId = n.branchIds.find(id => !state.tree.paths.find(p => p.branchId === id).archived) || n.branchIds[0]; state.chats.clear(); }
    state.nodeId = id;
    const top = $('#transcripts').scrollTop; renderDetail();
    if (scrollTranscript) $(`[data-segment="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else { $('#transcripts').scrollTop = top; $(`[data-node="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
    requestAnimationFrame(drawRibbons);
}
function drawRibbons() {
    if (!state.tree || $('#ribbon-lane').offsetWidth === 0) return;
    const lane = $('#editor').getBoundingClientRect(), view = $('#transcripts').getBoundingClientRect(), graphView = $('#graph-scroll').getBoundingClientRect();
    $('#ribbons').setAttribute('viewBox', `0 0 ${lane.width} ${lane.height}`);
    $('#ribbons').innerHTML = route().nodeIds.map(id => {
        const segment = $(`[data-segment="${id}"]`), node = $(`[data-node="${id}"]`); if (!segment || !node) return '';
        const a = segment.getBoundingClientRect(), b = node.getBoundingClientRect();
        if (a.bottom < view.top || a.top > view.bottom || b.bottom < graphView.top || b.top > graphView.bottom || b.right < graphView.left || b.left > graphView.right) return '';
        const top = Math.max(a.top, view.top) - lane.top, bottom = Math.min(a.bottom, view.bottom) - lane.top;
        const nt = Math.max(b.top, graphView.top) - lane.top, nb = Math.min(b.bottom, graphView.bottom) - lane.top;
        const left = view.right - lane.left, right = Math.max(left, b.left - lane.left), mid = (left + right) / 2;
        const n = state.tree.nodes.find(n => n.id === id);
        return `<path d="M${left} ${top} C${mid} ${top},${mid} ${nt},${right} ${nt} L${right} ${nb} C${mid} ${nb},${mid} ${bottom},${left} ${bottom} Z" fill="${palette[n.color][0]}" opacity=".19"/>`;
    }).join('');
}
async function refresh() {
    const id = ++requestId;
    const [data, list, tree] = await Promise.all([api('/state'), api('/list?scope=' + encodeURIComponent(state.scope) + '&q=' + encodeURIComponent(state.query)), state.tree ? api('/trees/' + encodeURIComponent(state.tree.id)) : null]);
    if (id !== requestId) return;
    state.data = data; state.list = list;
    state.selected = new Set([...state.selected].filter(id => list.items.some(i => i.id === id)));
    if (tree) {
        state.tree = tree; if (!route()) state.branchId = tree.paths[0]?.branchId;
        if (!tree.nodes.some(n => n.id === state.nodeId)) state.nodeId = null;
        state.chats = new Set([...state.chats].filter(id => route()?.messages.some(m => m.id === id)));
    }
    const scroll = $('#transcripts').scrollTop, graphTop = $('#graph-scroll').scrollTop, graphLeft = $('#graph-scroll').scrollLeft;
    render(); $('#transcripts').scrollTop = scroll; $('#graph-scroll').scrollTop = graphTop; $('#graph-scroll').scrollLeft = graphLeft; requestAnimationFrame(drawRibbons);
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
}
function restore(target) {
    const ungrouped = state.data.items.some(i => !i.projectId && (target.itemIds?.includes(i.id) || i.sessionIds.some(id => target.branchIds?.includes(id))));
    if (ungrouped) return moveDialog([], target);
    return run(() => api('/manage', 'POST', { ...target, action: 'restore' }));
}
function archiveDialog(target) {
    const items = state.data.items.filter(i => target.projectId ? i.projectId === target.projectId : target.itemIds?.includes(i.id));
    modal(target.projectId ? 'Archive project' : 'Archive', `<p>${t('{count} sessions', { count: items.reduce((n, i) => n + i.sessionIds.length, 0) })}</p><p class="dialog-copy">${items.map(i => esc(i.name)).join('<br>')}</p><p class="dialog-copy">${t('Keep the history in Archived and deactivate these sessions on this device. Restore does not automatically activate them.')}</p>`, async () => { await api('/manage', 'POST', { ...target, action: 'archive' }); state.selected.clear(); }, 'Archive');
}
async function activateDialog(p) {
    try {
        const d = await api('/branches/' + p.branchId), local = state.data.instances.find(i => i.branchId === p.branchId);
        modal('Activate', `${field('Working directory', 'cwd', local?.cwd || d.cwd)}<p class="dialog-copy">${t('Source')}: ${esc(d.lineage[0]?.source.deviceName || '')}<br>${esc(d.cwd)}</p>`, async form => { await api('/manage', 'POST', { action: 'activate', branchIds: [p.branchId], cwd: form.get('cwd') }); }, 'Activate');
    } catch (e) { toast(e.message); }
}
function saveOrganization(action, name) { return api('/trees/' + state.tree.id, 'POST', { version: state.tree.version, pathId: state.branchId, chatIds: [...state.chats], action, name }); }
function combineDialog() {
    const p = route(), positions = p.messages.map((m, i) => state.chats.has(m.id) ? i : -1).filter(i => i >= 0);
    if (positions.at(-1) - positions[0] + 1 !== positions.length) return toast(t('Combine requires consecutive chats.'));
    modal('Combine', field('Node title', 'name'), async form => { await saveOrganization('combine', form.get('name')); state.chats.clear(); }, 'Combine');
}
function forkDialog() {
    const p = route(), checkpoint = forkCheckpoint();
    if (!checkpoint) return toast(t('Fork at a node ending with a completed turn.'));
    modal('Create a branch', field('Branch name', 'name'), async form => {
        const b = await api('/branches/' + p.branchId + '/fork', 'POST', { name: form.get('name'), end: checkpoint.end, revisionId: p.head });
        state.branchId = b.id; state.chats.clear(); toast(t('Branch created'));
    }, 'Create branch');
}
function showContext() {
    const p = route(), c = p.context, usage = c?.lastUsage, events = c?.compactions || [];
    modal('Context', `<p class="dialog-copy">${t('Full history is preserved. After compaction, earlier chats are history, not necessarily the model’s current context.')}</p><div class="context-metrics"><div>${t('Recorded path text')}<strong>≈ ${compactNumber(p.messages.reduce((n, m) => n + Math.ceil([...m.text].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? .25 : 1.5), 0)) + (m.toolTokens || 0), 0))}</strong></div><div>${t('Latest reported input')}<strong>${usage && c.usageAfterCompaction ? compactNumber(usage.input) : t('Unknown')}</strong></div><div>${t('Reported context limit')}<strong>${usage?.window ? compactNumber(usage.window) : t('Unknown')}</strong></div></div><p class="dialog-copy">${tokenHint()}<br>${t('Reported input is the last recorded request, not a live meter or cumulative billing total.')} ${usage?.at ? date(usage.at) : ''}</p>${events.length ? events.map((e, i) => `<section class="compaction-card"><h3>${t('Compaction')} ${i + 1} <small>${date(e.at)}</small></h3><p>${e.before != null ? compactNumber(e.before) : '—'} → ${e.after != null ? compactNumber(e.after) : '—'} ${t('reported input tokens')}</p>${e.summary ? `<details open><summary>${t('Readable summary')}</summary><pre>${esc(e.summary)}</pre></details>` : `<p class="dialog-copy">${t(e.opaque ? 'The native record contains an encrypted compaction payload. Its summary cannot be read or quality-scored here.' : 'No readable summary was saved in this record.')}</p>`}${e.retained?.length ? `<details><summary>${t('Retained readable messages')} (${e.retained.length})</summary>${e.retained.map(m => `<pre>${esc(m.text)}</pre>`).join('')}</details>` : ''}</section>`).join('') : `<p class="dialog-copy">${t('No compaction event recorded.')}</p>`}`, null);
}
async function showSource() {
    try {
        const d = await api('/branches/' + state.branchId);
        modal('Source & revisions', `${d.warnings.map(w => `<p class="warning">${esc(errorText(w))}</p>`).join('')}${d.lineage.map(r => `<div class="source-entry">${esc(r.source.deviceName || t('Unknown device'))} · ${date(r.createdAt)}<br>${esc(r.source.cwd || d.cwd)}<br>${esc(r.source.client || '')}</div>`).join('')}`, null);
    } catch (e) { toast(e.message); }
}
async function settings(direction = null) {
    try {
        const c = await api('/webdav');
        modal('Sync & settings', `${field('WebDAV URL', 'url', c.url, 'url')}${field('Username', 'username', c.username)}${field(c.hasPassword ? 'Password (blank keeps existing)' : 'Password', 'password', '', 'password')}${field('Encryption passphrase', 'passphrase', '', 'password')}<p class="dialog-copy">${t('Organization changes upload automatically while unlocked. New Pending stays local until you organize it or click Upload. The passphrase stays in memory only.')}</p><div class="sync-buttons"><button type="button" id="unlock-sync">${t(state.data.cloud.unlocked ? 'Sync now' : 'Unlock sync')}</button>${state.data.cloud.unlocked ? `<button type="button" id="lock-sync">${t('Lock sync')}</button>` : ''}</div><details><summary>${t('Native data locations')}</summary><p class="dialog-copy">Codex: ${esc(state.roots.codex)}<br>Claude Code: ${esc(state.roots.claude)}</p></details>${(state.data.plan?.pendingRecovery || []).map(id => `<p class="warning">${t('Recover interrupted operation')}<button type="button" data-recover="${esc(id)}">${t('Restore')}</button></p>`).join('')}${state.data.conflicts.map((c, i) => `<div class="conflict">${t('Conflict')}: ${esc(c.local.name)}<br><button type="button" data-conflict="${i}" data-choice="local">${t('Keep local')}</button><button type="button" data-conflict="${i}" data-choice="remote">${t('Use remote')}</button></div>`).join('')}`, async form => { await api('/webdav', 'POST', Object.fromEntries([...form].filter(([k]) => k !== 'passphrase'))); }, 'Save connection');
        $('#unlock-sync').onclick = async () => {
            $('#unlock-sync').disabled = true;
            try {
                const values = Object.fromEntries(new FormData($('#dialog-form'))); await api('/webdav', 'POST', { url: values.url, username: values.username, password: values.password });
                $('#dialog-error').textContent = t('Syncing…'); await api('/sync', 'POST', { passphrase: values.passphrase, direction: direction || 'both' }); $('#dialog').close(); await refresh(); toast(t('Sync complete'));
            } catch (e) { $('#dialog-error').textContent = e.message; } finally { if ($('#unlock-sync')) $('#unlock-sync').disabled = false; }
        };
        if ($('#lock-sync')) $('#lock-sync').onclick = () => run(async () => { await api('/sync/lock', 'POST', {}); $('#dialog').close(); });
        $$('[data-conflict]').forEach(el => el.onclick = () => run(async () => { await api('/conflicts/resolve', 'POST', { index: Number(el.dataset.conflict), choice: el.dataset.choice }); $('#dialog').close(); }));
        $$('[data-recover]').forEach(el => el.onclick = () => run(async () => { await api('/recover', 'POST', { id: el.dataset.recover }); $('#dialog').close(); }));
    } catch (e) { toast(e.message); }
}
async function sync(direction) {
    if (!state.data.cloud.configured || !state.data.cloud.unlocked) return settings(direction);
    return run(async () => { await api('/sync', 'POST', { direction }); toast(t('Sync complete')); });
}
$('#upload').onclick = () => sync('push'); $('#sync').onclick = () => sync('pull'); $('#settings').onclick = () => settings();
$('#collect').onclick = () => run(async () => { const r = await api('/collect', 'POST', {}); if (r.errors?.length) toast(r.errors.map(e => errorText(e.message)).join('\n')); else toast(t('Refresh complete · {updates} updated · {discovered} discovered', { updates: r.updates.length, discovered: r.discovered })); });
$('#language').onclick = () => { setLocale(locale() === 'en' ? 'zh' : 'en'); render(); };
$('#search').oninput = e => { state.query = e.target.value; state.selected.clear(); clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh().catch(e => toast(e.message)), 180); };
$('#back').onclick = () => { state.tree = null; state.chats.clear(); render(); };
$('#source').onclick = showSource; $('#context-info').onclick = showContext;
$('#branch-picker').onchange = e => { state.branchId = e.target.value; state.chats.clear(); state.nodeId = null; renderDetail(); };
$('#transcripts').onscroll = $('#graph-scroll').onscroll = () => requestAnimationFrame(drawRibbons);
window.addEventListener('resize', () => requestAnimationFrame(drawRibbons));
try {
    const boot = await (await fetch('/api/bootstrap')).json(); if (boot.error) throw new Error(errorText(boot.error));
    state.token = boot.token; state.data = boot; state.roots = boot.roots; $('#demo-badge').textContent = boot.demo ? 'DEMO' : '';
    setLocale(locale()); await refresh();
    let fingerprint = JSON.stringify([state.data.branches, state.data.projects, state.data.instances, state.data.items]);
    setInterval(async () => {
        if (working || $('#dialog').open || state.chats.size) return;
        try {
            const next = await api('/state'), value = JSON.stringify([next.branches, next.projects, next.instances, next.items]);
            if (value !== fingerprint) { fingerprint = value; await refresh(); }
            else { state.data.cloud = next.cloud; renderNavigation(); }
        } catch { /* Explicit Update reports connection errors. */ }
    }, 5000);
} catch (e) { toast(e.message); }
