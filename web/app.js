import { t, locale, setLocale, errorText } from './i18n.js';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { data: null, scope: 'local', itemId: null, branchId: null, nodeId: null, detail: null, full: false, zoom: 1, token: null, roots: {} };
let submitAction, toastTimer, refreshing = false;
const date = value => value ? new Date(value).toLocaleString(locale() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('Never');
const project = () => state.data.projects.find(p => p.id === state.scope);
const collection = () => state.scope === 'local' ? state.data.localItems : state.data.projectItems[state.scope] || [];
const currentItem = () => collection().find(i => i.id === state.itemId);
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4200); }
async function api(route, method = 'GET', body) {
    const response = await fetch('/api' + route, { method, headers: { 'X-Grove-Token': state.token || '', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok)
        throw new Error(errorText(data.error || 'Operation failed. Check the current session state and try again.'));
    return data;
}
function translateStatic() {
    setLocale(locale());
    $('#language').value = locale();
    $$('[data-t]').forEach(el => el.textContent = t(el.dataset.t));
    $$('[data-placeholder]').forEach(el => el.placeholder = t(el.dataset.placeholder));
}
function modal(title, content, action, label = 'Save') {
    $('#dialog-title').textContent = t(title);
    $('#dialog-content').innerHTML = content;
    $('#dialog-error').textContent = '';
    $('#dialog-submit').textContent = t(label);
    $('#dialog-submit').hidden = !action;
    $('#dialog-submit').disabled = false;
    $('#dialog-cancel').textContent = t(action ? 'Cancel' : 'Close');
    submitAction = action;
    if (!$('#dialog').open)
        $('#dialog').showModal();
}
$('#dialog-close').onclick = $('#dialog-cancel').onclick = () => $('#dialog').close();
$('#dialog-form').onsubmit = async (event) => {
    event.preventDefault();
    if (!submitAction)
        return;
    $('#dialog-submit').disabled = true;
    $('#dialog-error').textContent = '';
    try {
        await submitAction(new FormData(event.target));
        $('#dialog').close();
        await refresh();
    }
    catch (e) {
        $('#dialog-error').textContent = errorText(e.message);
    }
    finally {
        $('#dialog-submit').disabled = false;
    }
};
function field(label, name, value = '', placeholder = '', type = 'text') {
    return `<label class="field"><span>${esc(t(label))}</span><input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(t(placeholder))}" ${type === 'password' ? 'autocomplete="new-password"' : ''}></label>`;
}
const projectOptions = selected => state.data.projects.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
function newProject() {
    modal('New project', field('Name', 'name', '', 'New project name') + field('Description', 'description'), async (form) => {
        const p = await api('/projects', 'POST', Object.fromEntries(form));
        state.scope = p.id;
        state.itemId = null;
        state.detail = null;
        toast(t('Project created'));
    }, 'New project');
}
$('#add-project').onclick = newProject;
$('#new-branch').onclick = () => modal('New session', `<p class="dialog-copy">${t('This session starts in the selected collection. Activate it explicitly when you are ready.')}</p>${field('Session name', 'name')}<label class="field"><span>${t('Agent')}</span><select name="agent"><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>`, async (form) => {
    const b = await api('/branches', 'POST', { ...Object.fromEntries(form), projectId: state.scope === 'local' ? null : state.scope });
    state.itemId = b.id;
    state.branchId = b.id;
    state.nodeId = `empty-${b.id}`;
    toast(t('Session created'));
}, 'Create session');
function navigate(scope, itemId = null) {
    state.scope = scope;
    state.itemId = itemId;
    state.branchId = null;
    state.nodeId = null;
    state.detail = null;
    state.zoom = 1;
    $('#search').value = '';
    renderShell();
    renderWorkspace();
    if (itemId)
        openItem(itemId).catch(e => toast(e.message));
}
$('#local-home').onclick = () => navigate('local');
$('#collection-back').onclick = () => navigate(state.scope);
$('#breadcrumb-home').onclick = () => navigate(state.scope);
$('#language').onchange = () => { setLocale($('#language').value); translateStatic(); renderShell(); renderWorkspace(); renderDetail(); };
async function refresh() {
    if (refreshing)
        return;
    refreshing = true;
    try {
        state.data = await api('/state');
        if (state.scope !== 'local' && !project())
            state.scope = 'local';
        // A newly created unfiled session is visible until explicitly activated or filed.
        if (state.itemId && !currentItem()) {
            const b = state.data.branches.find(b => b.id === state.itemId);
            if (!b || b.projectId) {
                state.itemId = null;
                state.detail = null;
            }
        }
        renderShell();
        renderWorkspace();
        if (state.branchId && state.itemId)
            await selectNode(state.branchId, state.nodeId, false);
        else
            renderDetail();
    }
    finally {
        refreshing = false;
    }
}
function cloudLabel() {
    const cloud = state.data.cloud, label = t(({ unconfigured: 'Configure sync', locked: 'Unlock sync', queued: 'Upload queued', syncing: 'Syncing…', synced: 'Synced', retrying: 'Retrying' })[cloud.phase]);
    return cloud.queued && state.data.projects.length && ['unconfigured', 'locked'].includes(cloud.phase) ? `${t('Upload queued')} · ${label}` : label;
}
function renderShell() {
    const p = project(), item = currentItem();
    $('#device-name').textContent = state.data.device.name;
    $('#active-count').textContent = state.data.instances.filter(i => i.desired || i.applied).length;
    $('#local-home').classList.toggle('selected', state.scope === 'local' && !state.itemId);
    $('#active-list').innerHTML = state.data.localItems.map(i => `<button class="active-item ${state.scope === 'local' && i.id === state.itemId ? 'selected' : ''}" data-local="${esc(i.id)}"><span>${i.kind === 'tree' ? '⑂' : '•'}</span><span>${esc(i.name === 'Shared context' ? t(i.name) : i.name)}</span><small>${i.kind === 'tree' ? i.activeCount : ''}</small></button>`).join('') || `<p class="side-empty">${t('Your active sessions will appear here automatically.')}</p>`;
    $$('[data-local]').forEach(el => el.onclick = () => navigate('local', el.dataset.local));
    $('#projects').innerHTML = state.data.projects.map(p => `<button class="project-link ${p.id === state.scope ? 'selected' : ''}" data-project="${esc(p.id)}"><span class="project-icon">▧</span>${esc(p.name)}<span class="count">${(state.data.projectItems[p.id] || []).length}</span></button>`).join('');
    $$('[data-project]').forEach(el => el.onclick = () => navigate(el.dataset.project));
    $('#cloud-state').textContent = cloudLabel();
    $('#cloud-state').title = state.data.cloud.error || '';
    $('#cloud-state').onclick = settings;
    $('#scope-label').textContent = t(state.scope === 'local' ? 'LOCAL WORKSPACE' : 'PROJECT COLLECTION');
    $('#project-name').textContent = item ? (item.name === 'Shared context' ? t(item.name) : item.name) : p?.name || t('Your current working set');
    $('#project-description').textContent = item ? `${t(item.kind === 'tree' ? 'Branch tree' : 'Session')} · ${item.branchIds.length} ${t('branches')}` : p?.description || t('Unfiled sessions stay on this device. Move a session or a whole tree into a project to sync it.');
    $('#project-name').ondblclick = () => { if (p && !item)
        modal('Project details', field('Name', 'name', p.name) + field('Description', 'description', p.description), async (f) => api('/projects/' + p.id, 'PATCH', Object.fromEntries(f))); };
    $('#breadcrumb-home').textContent = p?.name || t('Local Active');
    $('#breadcrumb-tail').textContent = item ? `/ ${t(item.kind === 'tree' ? 'Tree' : 'Session')}` : '';
    $('#collection-back').hidden = !state.itemId;
    $('#view-label').textContent = state.itemId ? t(item?.kind === 'tree' ? 'Tree' : 'Timeline') : t('Collection');
    $('#move-item').hidden = !state.itemId;
    $('#move-item').onclick = () => moveDialog(state.itemId);
    const pending = state.data.plan.operations.length;
    $('#pending-count').textContent = pending;
    $('#pending-count').classList.toggle('nonzero', !!pending);
    $('#project-stats').textContent = `${collection().length} ${t('items')} · ${state.data.stats.objects} ${t('segments')} · ${Math.round(state.data.stats.bytes / 1024)} KB`;
    $('#capture-state').textContent = state.scope === 'local' ? t('Saved locally') : cloudLabel();
}
function renderWorkspace() {
    const world = $('#graph-world');
    world.style.transform = '';
    world.style.width = '';
    world.style.height = '';
    $('#graph-footer').hidden = true;
    $('#inspector').hidden = !state.itemId;
    $('#graph-panel').classList.toggle('collection-mode', !state.itemId);
    if (!state.itemId) {
        renderCollection();
        return;
    }
    const item = currentItem() || { id: state.itemId, branchIds: [state.itemId], kind: 'session' };
    const vertices = graphNodes(item);
    if (item.kind === 'session') {
        world.innerHTML = `<div class="node-timeline">${vertices.map(v => nodeCard(v, false)).join('')}</div>`;
    }
    else {
        $('#graph-footer').hidden = false;
        const positions = new Map(), children = key => vertices.filter(v => v.parent === key), roots = vertices.filter(v => !vertices.some(p => p.id === v.parent));
        let row = 0, maxDepth = 0;
        const layout = (v, depth) => { maxDepth = Math.max(maxDepth, depth); const kids = children(v.id); const ys = kids.map(c => layout(c, depth + 1)); const y = ys.length ? (ys[0] + ys.at(-1)) / 2 : 40 + row++ * 169; positions.set(v.id, { x: 36 + depth * 285, y }); return y; };
        roots.forEach(v => layout(v, 0));
        const width = Math.max(580, (maxDepth + 1) * 285 + 35), height = Math.max(340, row * 169 + 85);
        world.style.width = width + 'px';
        world.style.height = height + 'px';
        world.style.transform = `scale(${state.zoom})`;
        const edges = vertices.filter(v => positions.has(v.parent)).map(v => { const p = positions.get(v.parent), c = positions.get(v.id), x = p.x + 238, y = p.y + 60; return `<path d="M${x},${y} C${x + 24},${y} ${c.x - 24},${c.y + 60} ${c.x},${c.y + 60}" fill="none" stroke="#b0c19d" stroke-width="1.3" ${v.pending ? 'stroke-dasharray="4 4"' : ''}/>`; }).join('');
        world.innerHTML = `<svg width="${width}" height="${height}">${edges}</svg>` + vertices.map(v => nodeCard(v, true, positions.get(v.id))).join('');
    }
    $$('[data-node]').forEach(el => el.onclick = () => selectNode(el.dataset.branch, el.dataset.node).catch(e => toast(e.message)));
    $('#zoom-label').textContent = Math.round(state.zoom * 100) + '%';
}
function renderCollection() {
    const query = $('#search').value.toLowerCase();
    const items = collection().filter(i => ($('#show-archived').checked || !i.archived) && (!query || `${i.name} ${i.group}`.toLowerCase().includes(query)));
    const world = $('#graph-world');
    if (!items.length) {
        world.innerHTML = `<div class="empty-state"><span class="empty-symbol">⑂</span><h2>${t(query ? 'No matching sessions' : 'A place for every line of thought.')}</h2><p>${t(query ? 'Try another search or show archived items.' : state.scope === 'local' ? 'Your active sessions will appear here automatically.' : 'Create a session or move local work into this project.')}</p><button class="button" id="browse-history">${t('Browse history')}</button></div>`;
        $('#browse-history').onclick = browseHistory;
        return;
    }
    const groups = [...new Set(items.map(i => i.group || ''))];
    world.innerHTML = `<div class="collection-list">${groups.map(group => `<section class="item-group"><h2>${esc(group || t('Ungrouped'))}<span>${items.filter(i => i.group === group).length}</span></h2>${items.filter(i => i.group === group).map(i => {
        const pending = i.branchIds.reduce((sum, key) => sum + (state.data.summaries[key]?.pendingCount || 0), 0);
        return `<article class="collection-item"><button class="item-open" data-open-item="${esc(i.id)}"><span class="item-symbol ${i.kind}">${i.kind === 'tree' ? '⑂' : '≡'}</span><span class="item-text"><strong>${esc(i.name === 'Shared context' ? t(i.name) : i.name)}</strong><small>${t(i.kind === 'tree' ? 'Branch tree' : 'Session')}${i.kind === 'tree' ? ` · ${i.branchIds.length} ${t('branches')}` : ''} · ${date(i.updatedAt)}</small></span><span class="item-badges">${pending ? `<span class="chip pending">${pending} ${t('Pending')}</span>` : ''}${i.projectId && state.scope === 'local' ? `<span class="chip">${esc(state.data.projects.find(p => p.id === i.projectId)?.name)}</span>` : ''}${!i.projectId ? `<span class="chip">${t('Unfiled')}</span>` : ''}</span><span>↗</span></button><button class="item-move" data-move-item="${esc(i.id)}">${t(i.projectId ? 'Move / group' : 'Move to project')}</button></article>`;
    }).join('')}</section>`).join('')}</div>`;
    $$('[data-open-item]').forEach(el => el.onclick = () => openItem(el.dataset.openItem).catch(e => toast(e.message)));
    $$('[data-move-item]').forEach(el => el.onclick = () => moveDialog(el.dataset.moveItem));
}
function graphNodes(item) {
    const vertices = [], byBranch = new Map();
    const visible = new Set(item.branchIds.filter(key => $('#show-archived').checked || !state.data.branches.find(b => b.id === key)?.archived));
    for (const key of [...visible]) {
        let b = state.data.branches.find(b => b.id === key);
        while (b?.parentId && item.branchIds.includes(b.parentId)) {
            visible.add(b.parentId);
            b = state.data.branches.find(p => p.id === b.parentId);
        }
    }
    for (const branchId of item.branchIds) {
        if (!visible.has(branchId))
            continue;
        const b = state.data.branches.find(b => b.id === branchId);
        if (!b)
            continue;
        const summary = state.data.summaries[b.id] || {};
        const nodes = state.data.nodes.filter(n => n.branchId === b.id && summary.nodeIds?.includes(n.id)).sort((a, b) => a.end - b.end).map(n => ({ ...n, branch: b, pending: false }));
        if (summary.pendingCount)
            nodes.push({ id: `pending-${b.id}`, branchId: b.id, branch: b, name: 'Pending', pending: true, count: summary.pendingCount, start: summary.pendingStart, end: summary.pendingEnd });
        if (!nodes.length)
            nodes.push({ id: `empty-${b.id}`, branchId: b.id, branch: b, name: b.name, empty: true, start: b.forkEnd || 0, end: b.forkEnd || 0 });
        for (let i = 1; i < nodes.length; i++)
            nodes[i].parent = nodes[i - 1].id;
        nodes.at(-1).tip = true;
        byBranch.set(b.id, nodes);
        vertices.push(...nodes);
    }
    for (const [branchId, nodes] of byBranch) {
        const b = nodes[0].branch, parentNodes = byBranch.get(b.parentId);
        if (parentNodes)
            nodes[0].parent = (parentNodes.find(n => n.end >= (b.forkParentEnd ?? b.forkEnd)) || parentNodes.at(-1)).id;
    }
    return vertices;
}
function nodeCard(v, absolute, position = {}) {
    const branch = v.branch, active = v.tip && state.data.instances.some(i => i.branchId === branch.id && i.desired);
    const name = v.pending ? t('Pending') : v.name === 'Shared context' ? t(v.name) : v.name;
    const query = $('#search').value.toLowerCase(), dim = query && !`${name} ${branch.name}`.toLowerCase().includes(query);
    return `<button class="branch-card logical-node ${absolute ? '' : 'timeline-card'} ${branch.archived ? 'archived' : ''} ${dim ? 'search-miss' : ''} ${v.pending ? 'pending-node' : ''} ${v.id === state.nodeId ? 'selected' : ''}" data-node="${esc(v.id)}" data-branch="${esc(branch.id)}" ${absolute ? `style="left:${position.x}px;top:${position.y}px"` : ''}><div class="card-top"><span>${t(v.pending ? 'Pending' : v.empty ? 'New direction' : 'Committed')}</span>${active ? `<span class="chip active">${t('Active')}</span>` : ''}</div><div class="card-title">${esc(name)}</div><div class="card-bottom"><span>${esc(branch.name)}</span><span>${v.pending ? `${v.count} ${t('messages')}` : v.createdAt ? date(v.createdAt) : ''}</span></div></button>`;
}
async function openItem(itemId) {
    state.itemId = itemId;
    state.zoom = 1;
    state.full = false;
    const item = currentItem(), vertices = graphNodes(item || { branchIds: [itemId] });
    const selected = vertices.find(v => v.pending && state.data.instances.some(i => i.branchId === v.branchId && i.applied)) || vertices.find(v => v.pending) || vertices[0];
    renderShell();
    renderWorkspace();
    if (selected)
        await selectNode(selected.branchId, selected.id);
}
async function selectNode(branchId, nodeId, redraw = true) {
    state.branchId = branchId;
    state.nodeId = nodeId;
    const detail = await api('/branches/' + encodeURIComponent(branchId));
    if (state.branchId !== branchId)
        return;
    state.detail = detail;
    if (!nodeId || (nodeId.startsWith('pending-') && !detail.pending.count) || (!nodeId.startsWith('pending-') && !nodeId.startsWith('empty-') && !detail.nodes.some(n => n.id === nodeId)))
        state.nodeId = detail.pending.count ? `pending-${branchId}` : detail.nodes.at(-1)?.id || `empty-${branchId}`;
    if (redraw)
        renderWorkspace();
    renderDetail();
}
function renderDetail() {
    const b = state.detail;
    if (!state.itemId || !b || b.id !== state.branchId) {
        $('#inspector').innerHTML = `<div class="inspector-empty"><span>⑂</span><h2>${t('Select a logical node')}</h2><p>${t('A node is a named piece of work. New conversation stays in Pending until you organize it.')}</p></div>`;
        return;
    }
    const pending = state.nodeId?.startsWith('pending-'), node = pending ? b.pending : b.nodes.find(n => n.id === state.nodeId);
    const start = node?.start ?? b.forkEnd ?? 0, end = node?.end ?? b.records;
    const messages = state.full ? b.messages.filter(m => m.line <= end) : b.messages.filter(m => m.line > start && m.line <= end);
    const selectedName = pending ? t('Pending') : node?.name || b.name;
    const active = b.instances.some(i => i.desired), checkpoints = b.checkpoints.filter(c => c.end <= end);
    $('#inspector').innerHTML = `<div class="detail-head"><div class="eyebrow">${t('NODE DETAILS')}<button class="icon-button" id="edit-branch" aria-label="${t('Rename session')}">⋯</button></div><h2>${esc(selectedName)}</h2><div class="meta"><span class="chip ${pending ? 'pending' : ''}">${t(pending ? 'Pending' : 'Committed')}</span><span>${messages.filter(m => m.role !== 'tool').length} ${t('messages')}</span></div>${pending ? `<button class="button commit-button" id="commit-pending" ${!b.pending.checkpoints.length ? 'disabled' : ''}>✓ ${t('Commit a range')}</button>` : ''}<div class="detail-actions"><button class="button primary" id="activate-branch" ${b.archived ? 'disabled' : ''}>${t(active ? 'Active settings' : 'Activate latest context')}</button><button class="button" id="fork-branch" ${!checkpoints.length ? 'disabled' : ''}>⑂ ${t('Fork')}</button><button class="button" id="archive-branch">${t(b.archived ? 'Restore session' : 'Archive session')}</button></div></div><div class="detail-tabs"><button id="node-tab" class="${!state.full ? 'selected' : ''}">${t('This node')}</button><button id="full-tab" class="${state.full ? 'selected' : ''}">${t('Full context')}</button></div><div class="conversation">${start && !state.full ? `<div class="inherited">${t('Inherited context is collapsed. Switch to Full context to inspect it.')}</div>` : ''}${messages.map(m => `<article class="message ${m.role}"><div class="message-label"><span class="role">${m.role === 'user' ? t('You') : m.role === 'tool' ? t('Tool') : b.agent === 'claude' ? 'CLAUDE' : 'CODEX'}</span><span>${date(m.timestamp)}</span></div><p>${esc(m.text)}</p></article>`).join('') || `<p class="dialog-copy">${t('No new messages yet. Activate this direction to continue in your agent.')}</p>`}</div><details class="provenance"><summary>${t('Source & revisions')} · ${b.lineage.length}</summary>${b.lineage.map(r => `<div class="provenance-entry"><strong>${esc(r.source.deviceName || t('Unknown device'))} · ${esc(r.source.client === 'unknown' || !r.source.client ? t('Unknown interface') : r.source.client)}</strong><br>${esc(r.source.cwd || t('Project checkpoint'))}<br>${date(r.createdAt)}</div>`).join('')}${b.warnings.map(w => `<p class="warning">${esc(errorText(w))}</p>`).join('')}</details>`;
    if ($('#commit-pending'))
        $('#commit-pending').onclick = () => commitDialog(b);
    $('#activate-branch').onclick = () => activateDialog(b);
    $('#fork-branch').onclick = () => forkDialog(b, checkpoints);
    $('#edit-branch').onclick = () => modal('Rename session', field('Name', 'name', b.name), async (form) => api('/branches/' + b.id, 'PATCH', Object.fromEntries(form)));
    $('#archive-branch').onclick = () => modal(b.archived ? 'Restore session' : 'Archive session', `<p class="dialog-copy">${t(b.archived ? 'Restoring does not automatically activate the session.' : 'History and child branches are retained. Archiving also queues removal from this device’s Active set.')}</p>`, async () => { await api('/branches/' + b.id, 'PATCH', { archived: !b.archived }); toast(t('Session updated')); }, b.archived ? 'Restore' : 'Archive');
    $('#node-tab').onclick = () => { state.full = false; renderDetail(); };
    $('#full-tab').onclick = () => { state.full = true; renderDetail(); };
}
function commitDialog(b) {
    const checkpoints = b.pending.checkpoints;
    modal('Commit Pending', `<p class="dialog-copy">${t('Ranges end at complete turns, keeping tool calls and results together. The native conversation is not changed.')}</p>${field('Name this piece of work', 'name', '', 'For example: Finished the introduction')}<label class="field"><span>${t('Commit through')}</span><select name="end" id="commit-end">${checkpoints.map((c, index) => `<option value="${c.end}">${t('First {count} messages · turn {turn}', { count: c.messages, turn: index + 1 })}</option>`).join('')}</select></label><p class="pending-remainder" id="pending-remainder"></p><div id="range-preview" class="range-preview"></div>`, async (form) => {
        await api('/branches/' + b.id + '/commit', 'POST', { name: form.get('name'), end: Number(form.get('end')), revisionId: b.head, expectedStart: b.pending.start });
        state.nodeId = `pending-${b.id}`;
        toast(t('Node committed'));
    }, 'Commit node');
    const preview = () => { const c = checkpoints.find(c => c.end === Number($('#commit-end').value)); $('#pending-remainder').textContent = t('{count} messages will remain in Pending.', { count: b.pending.count - c.messages }); $('#range-preview').innerHTML = b.pending.messages.filter(m => m.line <= c.end).map(m => `<p><strong>${m.role === 'user' ? t('You') : b.agent === 'claude' ? 'Claude' : 'Codex'}</strong> ${esc(m.text.slice(0, 180))}</p>`).join(''); };
    $('#commit-end').onchange = preview;
    preview();
}
function forkDialog(b, checkpoints) {
    modal('Create a branch', `<p class="dialog-copy">${t('The checkpoint is fixed. Creating a branch does not change the Active set.')}</p>${field('Branch name', 'name')}<label class="field"><span>${t('Fork at')}</span><select name="end">${checkpoints.map((c, index) => `<option value="${c.end}" ${index === checkpoints.length - 1 ? 'selected' : ''}>${t('Turn {turn} · record {end}', { turn: index + 1, end: c.end })}</option>`).join('')}</select></label>`, async (form) => {
        const b2 = await api('/branches/' + b.id + '/fork', 'POST', { ...Object.fromEntries(form), revisionId: b.head });
        state.branchId = b2.id;
        state.nodeId = `empty-${b2.id}`;
        toast(t('Branch created'));
    }, 'Create branch');
}
function moveDialog(branchId) {
    if (!state.data.projects.length) {
        toast(t('Create a project first.'));
        return newProject();
    }
    const item = collection().find(i => i.id === branchId);
    modal('Move to project', `<p class="dialog-copy">${t('This moves the entire item, including every branch and logical node. Upload is queued automatically.')}</p><label class="field"><span>${t('Destination project')}</span><select name="projectId">${projectOptions(item?.projectId || project()?.id)}</select></label>${field('Group (optional)', 'group', item?.group || '', 'For example: Miscellaneous')}`, async (form) => {
        const destination = form.get('projectId');
        await api('/branches/' + branchId + '/move', 'POST', Object.fromEntries(form));
        state.scope = destination;
        state.itemId = null;
        state.branchId = null;
        state.detail = null;
        toast(t('Moved to project'));
    }, 'Move');
}
function activateDialog(b) {
    const active = b.instances.find(i => i.desired);
    modal('Activate', `<p class="dialog-copy">${t('Choose an existing local project folder. Saving only updates the desired set; review and apply it next.')}</p><p class="dialog-copy">${t('Activate continues the latest context of this session, including Pending. To continue from an earlier node, fork from its checkpoint first.')}</p>${field('Working directory', 'cwd', active?.cwd || b.cwd || '', '/Users/you/Projects/Chrono')}${active ? `<button type="button" class="button" id="remove-active">${t('Remove from Active')}</button>` : ''}`, async (form) => { await api('/branches/' + b.id + '/active', 'POST', { cwd: form.get('cwd'), desired: true }); toast(t('Active set updated')); }, 'Set Active');
    if ($('#remove-active'))
        $('#remove-active').onclick = async () => { try {
            await api('/branches/' + b.id + '/active', 'POST', { desired: false });
            $('#dialog').close();
            await refresh();
            toast(t('Active set updated'));
        }
        catch (e) {
            $('#dialog-error').textContent = e.message;
        } };
}
async function reviewActive() {
    await refresh();
    const plan = state.data.plan;
    modal('Apply Active set', `<p class="dialog-copy">${t('Only observed / imported sessions are managed. Close running agents and IDE extensions before applying.')}</p>${plan.operations.map(o => `<div class="operation-card"><div><strong>${esc(o.name)}</strong><span class="chip">${t(o.action === 'activate' ? 'Activate' : 'Hide')}</span></div><p>${esc(o.cwd)} · ${esc(o.agent)}</p></div>`).join('') || `<p class="inherited">${t('No changes to apply.')}</p>`}${plan.pendingRecovery.map(key => `<button class="button" type="button" data-recover="${esc(key)}">${t('Recover interrupted operation')}</button>`).join('')}`, plan.operations.length && !plan.pendingRecovery.length ? async () => { await api('/apply', 'POST', {}); toast(t('Changes applied')); } : null, 'Apply to native storage');
    $$('[data-recover]').forEach(el => el.onclick = async () => { try {
        await api('/recover', 'POST', { id: el.dataset.recover });
        await reviewActive();
    }
    catch (e) {
        $('#dialog-error').textContent = e.message;
    } });
}
$('#review-active').onclick = () => reviewActive().catch(e => toast(e.message));
$('#collect').onclick = async () => { try {
    const r = await api('/collect', 'POST', {});
    await refresh();
    toast(r.errors.length ? errorText(r.errors[0].message) : t('Refresh complete · {updates} updated · {discovered} discovered', { updates: r.updates.length, discovered: r.discovered }));
}
catch (e) {
    toast(e.message);
} };
async function browseHistory() {
    try {
        const result = await api('/discover');
        modal('Native history available on this device', `<label class="field"><span>${t('Destination project')}</span><select id="import-project"><option value="">${t('Unfiled')}</option>${projectOptions(state.scope)}</select></label><div class="import-list">${result.sessions.map(s => `<div class="import-card"><div><strong>${esc(s.title)}</strong><button type="button" data-import="${esc(s.key)}" ${s.managed ? 'disabled' : ''}>${t(s.managed ? 'Imported' : 'Import')}</button></div><p>${esc(s.cwd)} · ${s.messages} ${t('messages')}</p></div>`).join('') || `<p class="dialog-copy">${t('No native sessions found.')}</p>`}</div>`, null);
        $$('[data-import]').forEach(el => el.onclick = async () => { try {
            await api('/import', 'POST', { key: el.dataset.import, projectId: $('#import-project').value || null });
            el.disabled = true;
            el.textContent = t('Imported');
            await refresh();
        }
        catch (e) {
            $('#dialog-error').textContent = e.message;
        } });
    }
    catch (e) {
        toast(e.message);
    }
}
async function settings() {
    try {
        const c = await api('/webdav');
        modal('Sync & settings', `<p class="dialog-copy">${t('Filed projects sync automatically while this service is unlocked. Local unfiled sessions and Active selections never upload. The passphrase stays in memory only.')}</p>${field('WebDAV URL', 'url', c.url, 'https://example.com/dav')}${field('Username', 'username', c.username)}${field(c.hasPassword ? 'Password (blank keeps existing)' : 'Password', 'password', '', '', 'password')}${field('Encryption passphrase', 'passphrase', '', 'At least 12 characters; same on every device', 'password')}<div class="sync-buttons"><button type="button" class="button" id="unlock-sync">${t(state.data.cloud.unlocked ? 'Sync now' : 'Unlock automatic project sync')}</button>${state.data.cloud.unlocked ? `<button type="button" class="button" id="lock-sync">${t('Lock sync')}</button>` : ''}</div><p class="dialog-copy">${t('Last sync')}: ${date(state.data.cloud.lastSuccess)}</p><details><summary class="dialog-copy">${t('Native data locations')}</summary><p class="dialog-copy">Codex: ${esc(state.roots.codex)}<br>Claude: ${esc(state.roots.claude)}</p><button type="button" class="button" id="browse-history">${t('Browse history')}</button></details>${state.data.conflicts.length ? `<p class="mini-label">${t('METADATA CONFLICTS')}</p>` : ''}${state.data.conflicts.map((c, index) => `<div class="conflict-card"><p>${t('Local')}: ${esc(c.local.name)}<br>${t('Remote')}: ${esc(c.remote.name)}</p><button type="button" data-resolve="${index}" data-choice="local">${t('Keep local')}</button><button type="button" data-resolve="${index}" data-choice="remote">${t('Use remote')}</button></div>`).join('')}`, async (form) => { const { passphrase, ...config } = Object.fromEntries(form); await api('/webdav', 'POST', config); toast(t('Connection saved')); }, 'Save connection');
        $('#browse-history').onclick = browseHistory;
        $('#unlock-sync').onclick = async () => {
            $('#unlock-sync').disabled = true;
            $('#dialog-submit').disabled = true;
            try {
                const values = Object.fromEntries(new FormData($('#dialog-form')));
                await api('/webdav', 'POST', { url: values.url, username: values.username, password: values.password });
                $('#dialog-error').textContent = t('Syncing…');
                await api('/sync', 'POST', { passphrase: values.passphrase, direction: 'both' });
                $('#dialog').close();
                await refresh();
                toast(t('Sync complete'));
            }
            catch (e) {
                $('#dialog-error').textContent = e.message;
            }
            finally {
                if ($('#unlock-sync'))
                    $('#unlock-sync').disabled = false;
                $('#dialog-submit').disabled = false;
            }
        };
        if ($('#lock-sync'))
            $('#lock-sync').onclick = async () => { await api('/sync/lock', 'POST', {}); $('#dialog').close(); await refresh(); };
        $$('[data-resolve]').forEach(el => el.onclick = async () => { try {
            await api('/conflicts/resolve', 'POST', { index: Number(el.dataset.resolve), choice: el.dataset.choice });
            $('#dialog').close();
            await refresh();
            toast(t('Choice saved'));
        }
        catch (e) {
            $('#dialog-error').textContent = e.message;
        } });
    }
    catch (e) {
        toast(e.message);
    }
}
$('#sync-settings').onclick = settings;
$('#search').oninput = renderWorkspace;
$('#show-archived').onchange = renderWorkspace;
$('#zoom-in').onclick = () => { state.zoom = Math.min(1.5, state.zoom + .1); renderWorkspace(); };
$('#zoom-out').onclick = () => { state.zoom = Math.max(.4, state.zoom - .1); renderWorkspace(); };
$('#zoom-reset').onclick = () => { state.zoom = 1; renderWorkspace(); $('#graph-viewport').scrollTo({ left: 0, top: 0, behavior: 'smooth' }); };
const viewport = $('#graph-viewport');
let pan;
viewport.addEventListener('pointerdown', e => { if (e.target.closest('button') || !state.itemId)
    return; pan = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; viewport.setPointerCapture(e.pointerId); });
viewport.addEventListener('pointermove', e => { if (pan) {
    viewport.scrollLeft = pan.left + pan.x - e.clientX;
    viewport.scrollTop = pan.top + pan.y - e.clientY;
} });
viewport.addEventListener('pointerup', () => pan = null);
viewport.addEventListener('pointercancel', () => pan = null);
try {
    const boot = await (await fetch('/api/bootstrap')).json();
    if (boot.error)
        throw new Error(errorText(boot.error));
    state.token = boot.token;
    state.data = boot;
    state.roots = boot.roots;
    $('#mode').textContent = boot.demo ? 'DEMO' : '';
    translateStatic();
    renderShell();
    renderWorkspace();
    renderDetail();
    let signature = JSON.stringify(boot.branches) + JSON.stringify(boot.nodes) + JSON.stringify(boot.instances);
    setInterval(async () => {
        if ($('#dialog').open || refreshing)
            return;
        try {
            const next = await api('/state'), nextSignature = JSON.stringify(next.branches) + JSON.stringify(next.nodes) + JSON.stringify(next.instances);
            if (nextSignature !== signature) {
                signature = nextSignature;
                await refresh();
            }
            else {
                state.data.cloud = next.cloud;
                renderShell();
            }
        }
        catch { /* Manual refresh reports persistent errors. */ }
    }, 5000);
}
catch (e) {
    toast(e.message);
}
