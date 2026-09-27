const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { data: null, projectId: null, branchId: null, detail: null, view: 'graph', zoom: 1, full: false, token: null };
let submitAction = null, toastTimer;
async function api(route, method = 'GET', body) {
    const r = await fetch('/api' + route, { method, headers: { 'X-Grove-Token': state.token || '', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json();
    if (!r.ok)
        throw new Error(data.error || '请求失败');
    return data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
function date(value) { return value ? new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未更新'; }
function currentProject() { return state.data.projects.find(p => p.id === state.projectId); }
function status(b) {
    const instances = state.data.instances.filter(i => i.branchId === b.id);
    if (instances.some(i => i.desired && (!i.applied || i.baseRevision !== b.head || i.missing || i.title !== b.name)))
        return ['pending', '待激活'];
    if (instances.some(i => i.desired && i.applied))
        return ['active', 'Active'];
    if (instances.some(i => !i.desired && i.applied))
        return ['pending', '待收起'];
    if (b.archived)
        return ['', '已归档'];
    if (b.conflict)
        return ['conflict', '分歧'];
    return ['', '已收纳'];
}
function modal(title, content, action, label = '保存') {
    $('#dialog-title').textContent = title;
    $('#dialog-content').innerHTML = content;
    $('#dialog-error').textContent = '';
    $('#dialog-submit').textContent = label;
    $('#dialog-submit').hidden = !action;
    $('#dialog-cancel').textContent = action ? '取消' : '关闭';
    submitAction = action;
    if (!$('#dialog').open)
        $('#dialog').showModal();
}
$('#dialog-close').onclick = $('#dialog-cancel').onclick = () => $('#dialog').close();
$('#dialog-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!submitAction)
        return;
    const button = $('#dialog-submit');
    button.disabled = true;
    $('#dialog-error').textContent = '';
    try {
        await submitAction(new FormData(e.target));
        $('#dialog').close();
        await refresh();
    }
    catch (error) {
        $('#dialog-error').textContent = error.message;
    }
    finally {
        button.disabled = false;
    }
};
const field = (label, name, value = '', placeholder = '', type = 'text') => `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${type === 'password' ? 'autocomplete="new-password"' : ''}></label>`;
const projectOptions = () => state.data.projects.map(p => `<option value="${esc(p.id)}" ${p.id === state.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
function newProject() { modal('新建项目', field('项目名称', 'name', '', '例如 Chrono') + field('描述', 'description', '', '这个项目在探索什么？'), async (form) => { const p = await api('/projects', 'POST', Object.fromEntries(form)); state.projectId = p.id; state.branchId = null; toast('项目已创建'); }, '创建项目'); }
$('#add-project').onclick = newProject;
$('#new-branch').onclick = () => {
    if (!currentProject())
        return newProject();
    modal('新建会话', `<p class="dialog-copy">会话归属于 ${esc(currentProject().name)}。创建后保存在 Grove，只有显式 Activate 才进入原生列表。</p>${field('会话名称', 'name', '', '例如 Method · 方法设计')}<label class="field"><span>首次交互使用的 Agent</span><select name="agent"><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>`, async (form) => { const b = await api('/branches', 'POST', { ...Object.fromEntries(form), projectId: state.projectId }); state.branchId = b.id; toast('新会话已保存，尚未激活'); }, '创建会话');
};
async function refresh() {
    state.data = await api('/state');
    if (!state.data.projects.some(p => p.id === state.projectId))
        state.projectId = state.data.projects[0]?.id || null;
    if (state.branchId && !state.data.branches.some(b => b.id === state.branchId))
        state.branchId = null;
    renderShell();
    renderGraph();
    if (state.branchId)
        await selectBranch(state.branchId, false);
    else
        renderDetail();
}
function renderShell() {
    const data = state.data, p = currentProject();
    $('#device-name').textContent = data.device.name;
    $('#projects').innerHTML = data.projects.map(p => `<button class="project-link ${p.id === state.projectId ? 'selected' : ''}" data-project="${esc(p.id)}"><span class="project-icon">▧</span>${esc(p.name)}<span class="count">${data.branches.filter(b => b.projectId === p.id).length}</span></button>`).join('');
    $$('[data-project]').forEach(el => el.onclick = () => { state.projectId = el.dataset.project; state.branchId = null; state.detail = null; state.zoom = 1; renderShell(); renderGraph(); renderDetail(); });
    $('#project-name').textContent = p?.name || '你的会话，从这里生长。';
    $('#project-breadcrumb').textContent = p?.name || 'Projects';
    $('#project-description').textContent = p?.description || '按项目组织上下文，把当前需要的分支带回 Agent。';
    $('#project-name').title = p ? '双击修改项目信息' : '';
    $('#project-name').ondblclick = () => { if (p)
        modal('项目信息', field('名称', 'name', p.name) + field('描述', 'description', p.description), async (form) => api('/projects/' + p.id, 'PATCH', Object.fromEntries(form))); };
    const active = data.branches.filter(b => data.instances.some(i => i.branchId === b.id && i.desired));
    $('#active-count').textContent = active.length;
    $('#active-list').innerHTML = active.length ? active.map(b => `<button class="active-item" data-active="${esc(b.id)}"><span class="online-dot"></span><span>${esc(b.name)}</span></button>`).join('') : '<p class="side-empty">选择分支并 Activate，<br>让工作台只留下当下所需。</p>';
    $$('[data-active]').forEach(el => el.onclick = () => { const b = data.branches.find(b => b.id === el.dataset.active); state.projectId = b.projectId; renderShell(); selectBranch(b.id); });
    const count = data.plan.operations.length;
    $('#pending-count').textContent = count;
    $('#pending-count').classList.toggle('nonzero', !!count);
    $('#project-stats').textContent = `${data.branches.filter(b => b.projectId === state.projectId).length} 条分支 · ${data.stats.objects} 个共享片段 · ${Math.round(data.stats.bytes / 1024)} KB`;
}
function visibleBranches() {
    const query = $('#search').value.toLowerCase(), archived = $('#show-archived').checked;
    return state.data.branches.filter(b => b.projectId === state.projectId && (archived || !b.archived) && (!query || `${b.name} ${b.group}`.toLowerCase().includes(query)));
}
function renderGraph() {
    const branches = visibleBranches(), world = $('#graph-world');
    world.style.transform = '';
    world.style.width = '';
    world.style.height = '';
    $('#zoom-label').textContent = Math.round(state.zoom * 100) + '%';
    if (!branches.length) {
        const empty = state.data.branches.some(b => b.projectId === state.projectId);
        world.innerHTML = `<div class="empty-state"><span class="empty-symbol">⑂</span><h2>${empty ? '这里暂时没有匹配的分支' : '给这个项目种下第一条会话'}</h2><p>${empty ? '调整搜索或显示归档，找回你要继续的工作。' : '收纳已有的 Codex 或 Claude Code 会话，或创建一条新的工作分支。所有上下文，都在一个项目里。'}</p>${empty ? '' : '<button class="button" id="empty-import">▣ 收纳已有会话</button>'}</div>`;
        if ($('#empty-import'))
            $('#empty-import').onclick = openInbox;
        return;
    }
    const card = b => { const [style, label] = status(b); return `<div class="card-top"><span>${b.parentId ? '⑂ BRANCH' : '◉ ROOT SESSION'}</span><span class="chip ${style}">${label}</span></div><div class="card-title">${esc(b.name)}</div><div class="card-bottom"><span>${esc(b.group || b.agent === 'claude' && 'Claude Code' || 'Codex')}</span><span>${date(b.updatedAt)}</span></div>`; };
    if (state.view === 'list')
        world.innerHTML = '<div class="branch-table">' + branches.map(b => `<button class="branch-card branch-row ${b.id === state.branchId ? 'selected' : ''} ${b.archived ? 'archived' : ''}" data-branch="${esc(b.id)}">${card(b)}</button>`).join('') + '</div>';
    else {
        const map = new Map(branches.map(b => [b.id, b])), positions = new Map(), children = key => branches.filter(b => b.parentId === key), roots = branches.filter(b => !map.has(b.parentId));
        let row = 0, maxDepth = 0;
        const layout = (b, depth) => { maxDepth = Math.max(maxDepth, depth); const kids = children(b.id); let y; if (kids.length) {
            const ys = kids.map(c => layout(c, depth + 1));
            y = (ys[0] + ys.at(-1)) / 2;
        }
        else {
            y = 45 + row * 166;
            row++;
        } positions.set(b.id, { x: 40 + depth * 295, y }); return y; };
        roots.forEach(b => layout(b, 0));
        const width = Math.max(620, (maxDepth + 1) * 295 + 45), height = Math.max(330, row * 166 + 80);
        const edges = branches.filter(b => positions.has(b.parentId)).map(b => { const a = positions.get(b.parentId), c = positions.get(b.id), x = a.x + 238, y = a.y + 60; return `<path d="M${x},${y} C${x + 32},${y} ${c.x - 32},${c.y + 60} ${c.x},${c.y + 60}" fill="none" stroke="#b6c5a6" stroke-width="1.3"/><circle cx="${c.x}" cy="${c.y + 60}" r="3" fill="#96af80"/>`; }).join('');
        world.style.width = width + 'px';
        world.style.height = height + 'px';
        world.style.transform = `scale(${state.zoom})`;
        world.innerHTML = `<svg width="${width}" height="${height}">${edges}</svg>` + branches.map(b => { const p = positions.get(b.id); return `<button class="branch-card ${b.id === state.branchId ? 'selected' : ''} ${b.archived ? 'archived' : ''}" data-branch="${esc(b.id)}" style="left:${p.x}px;top:${p.y}px">${card(b)}</button>`; }).join('');
    }
    $$('[data-branch]').forEach(el => el.onclick = () => selectBranch(el.dataset.branch).catch(e => toast(e.message)));
}
async function selectBranch(branchId, redraw = true) {
    state.branchId = branchId;
    const detail = await api('/branches/' + encodeURIComponent(branchId));
    if (state.branchId !== branchId)
        return;
    state.detail = detail;
    if (redraw)
        renderGraph();
    renderDetail();
}
function renderDetail() {
    const b = state.detail;
    if (!b || b.id !== state.branchId) {
        $('#inspector').innerHTML = '<div class="inspector-empty"><span>⑂</span><h2>每条分支，都有来处。</h2><p>选择一个节点，查看上下文、检查点和更新来源。</p></div>';
        return;
    }
    const [style, label] = status(b), active = b.instances.some(i => i.desired), end = b.checkpoints.at(-1)?.end;
    const messages = b.messages.filter(m => state.full || m.line > b.forkEnd);
    $('#inspector').innerHTML = `<div class="detail-head"><div class="eyebrow">BRANCH DETAILS <button class="icon-button" id="edit-branch" aria-label="编辑分支">⋯</button></div><h2>${esc(b.name)}</h2><div class="meta"><span class="chip ${style}">${label}</span><span>${b.messages.length} 条消息</span><span>${b.checkpoints.length} 个检查点</span></div><div class="detail-actions"><button class="button primary" id="activate-branch" ${b.archived ? 'disabled' : ''}>${active ? '✓ Active 设置' : '↗ Activate'}</button><button class="button" id="fork-branch" ${!end ? 'disabled' : ''}>⑂ 创建分支</button><button class="button" id="archive-branch">${b.archived ? '恢复' : '归档'}</button></div></div>${b.warnings.map(w => `<div class="warning detail-warning">${esc(w)}</div>`).join('')}<div class="detail-tabs"><button id="delta-tab" class="${!state.full ? 'selected' : ''}">本分支新增</button><button id="full-tab" class="${state.full ? 'selected' : ''}">完整上下文</button></div><div class="conversation">${b.parentId && !state.full ? `<div class="inherited">⑂ 继承自「${esc(state.data.branches.find(p => p.id === b.parentId)?.name || '父分支')}」的固定检查点。<br>共享前缀已折叠，可切换查看完整上下文。</div>` : ''}${messages.map((m, index) => { const next = messages[index + 1]?.line || Infinity; const cps = b.checkpoints.filter(c => c.end >= m.line && c.end < next); return `<article class="message ${m.role}"><div class="message-label"><span class="role">${m.role === 'user' ? 'YOU' : m.role === 'tool' ? 'TOOL' : b.agent === 'claude' ? 'CLAUDE' : 'CODEX'}</span><span>${m.timestamp ? date(m.timestamp) : ''}</span></div><p>${esc(m.text)}</p></article>${cps.map(c => `<div class="checkpoint"><span>${esc(c.label)}</span><button data-checkpoint="${c.end}">从这里分支 ↗</button></div>`).join('')}`; }).join('') || '<p class="dialog-copy">尚无新增消息。激活后，在原生 Agent 中继续交互。</p>'}</div><details class="provenance"><summary>来源与版本 · ${b.lineage.length} 次收纳</summary>${b.lineage.map(r => `<div class="provenance-entry"><strong>${esc(r.source.deviceName || '未知设备')} · ${esc(r.source.client || '交互入口未知')}</strong><br>${esc(r.source.cwd || '项目检查点')}<br>${date(r.createdAt)} · ${r.records} 条原生记录 · ${esc(r.source.operation || '更新')}</div>`).join('')}${b.instances.map(i => `<div class="provenance-entry"><strong>${i.applied ? '原生存储已应用' : '原生存储未应用'}</strong><br>${esc(i.cwd)}<br>${i.pending ? esc(i.pending) : ''}</div>`).join('')}</details>`;
    $('#activate-branch').onclick = () => activateDialog(b);
    $('#fork-branch').onclick = () => forkDialog(b, end);
    $$('[data-checkpoint]').forEach(el => el.onclick = () => forkDialog(b, Number(el.dataset.checkpoint)));
    $('#archive-branch').onclick = () => modal(b.archived ? '恢复分支' : '归档分支', `<p class="dialog-copy">${b.archived ? '恢复后重新显示在项目图中，不会自动 Activate。' : '历史、检查点和子分支都会保留。如果它在本机 Active 清单中，会同时标记为待收起；应用清单后原生列表才会更新。'}</p>`, async () => { await api('/branches/' + b.id, 'PATCH', { archived: !b.archived }); toast(b.archived ? '分支已恢复' : '分支已归档'); }, b.archived ? '恢复' : '归档');
    $('#edit-branch').onclick = () => modal('编辑分支', field('名称', 'name', b.name) + field('项目内分组', 'group', b.group, '例如 Literature'), async (form) => api('/branches/' + b.id, 'PATCH', Object.fromEntries(form)));
    $('#delta-tab').onclick = () => { state.full = false; renderDetail(); };
    $('#full-tab').onclick = () => { state.full = true; renderDetail(); };
}
function forkDialog(b, end) {
    modal('从检查点创建分支', `<p class="dialog-copy">继承「${esc(b.name)}」到所选检查点的上下文。后续对父分支的修改不会改变这个起点。</p>${field('新分支名称', 'name', '', '为新的工作方向命名')}<label class="field"><span>分叉位置</span><select name="end">${b.checkpoints.map(c => `<option value="${c.end}" ${c.end === end ? 'selected' : ''}>${esc(c.label)} · 原生记录 ${c.end}</option>`).join('')}</select></label><p class="dialog-copy">创建不会改变 Active 清单。</p>`, async (form) => { const created = await api('/branches/' + b.id + '/fork', 'POST', { ...Object.fromEntries(form), revisionId: b.head }); state.branchId = created.id; toast('分支已创建，共享历史已保留'); }, '创建分支');
}
function activateDialog(b) {
    const existing = b.instances.find(i => i.desired), cwd = existing?.cwd || b.cwd || '';
    modal('Activate · 选择工作目录', `<p class="dialog-copy">将这个分支加入本机 Active 清单。Session Grove 会为 ${b.agent === 'codex' ? 'Codex' : 'Claude Code'} 准备会话，CLI 与 IDE 共享同一原生存储。</p>${field('本机工程目录', 'cwd', cwd, '/Users/you/Projects/Chrono')}<p class="dialog-copy">保存后检查并应用 Active 清单。项目文件需要已经存在于目标目录。</p>${existing ? '<button type="button" class="button" id="remove-active">从 Active 清单移除</button>' : ''}`, async (form) => { await api('/branches/' + b.id + '/active', 'POST', { cwd: form.get('cwd'), desired: true }); toast('已指定 Active，请检查并应用清单'); }, '设为 Active');
    if ($('#remove-active'))
        $('#remove-active').onclick = async () => { try {
            await api('/branches/' + b.id + '/active', 'POST', { desired: false });
            $('#dialog').close();
            await refresh();
            toast('已标记待收起，请应用 Active 清单');
        }
        catch (e) {
            $('#dialog-error').textContent = e.message;
        } };
}
async function reviewActive() {
    await refresh();
    const plan = state.data.plan;
    modal('应用 Active 清单', `<p class="dialog-copy">${state.data.instances.filter(i => i.desired).length} 条会话被显式指定为 Active。${esc(plan.note)}</p>${plan.operations.map(o => `<div class="operation-card"><div><strong>${esc(o.name)}</strong><span class="chip ${o.action === 'activate' ? 'active' : 'pending'}">${o.action === 'activate' ? '激活' : '收起'}</span></div><p>${esc(o.cwd)} · ${o.agent === 'codex' ? 'Codex' : 'Claude Code'}</p></div>`).join('') || '<p class="inherited">已收纳会话的 Active 清单已应用，无待处理变更。</p>'}${plan.pendingRecovery.map(job => `<div class="warning">有未完成操作需要恢复。<button class="button" type="button" data-recover="${esc(job)}">恢复操作备份</button></div>`).join('')}<p class="dialog-copy">应用前请关闭正在运行的 Agent 及相关 IDE 扩展。操作会备份受影响的记录和索引；完成后重新打开客户端。</p>`, plan.operations.length && !plan.pendingRecovery.length ? async () => { const r = await api('/apply', 'POST', {}); toast(`已应用 ${r.applied} 项变更`); } : null, '应用到原生存储');
    $$('[data-recover]').forEach(el => el.onclick = async () => { try {
        await api('/recover', 'POST', { id: el.dataset.recover });
        await reviewActive();
    }
    catch (e) {
        $('#dialog-error').textContent = e.message;
    } });
}
$('#review-active').onclick = () => reviewActive().catch(e => toast(e.message));
async function openInbox() {
    modal('收纳已有会话', '<p class="dialog-copy">正在读取本机原生记录…</p>', null);
    try {
        const result = await api('/discover');
        modal('收纳已有会话', `<p class="dialog-copy">收纳会保留原始记录，在项目中建立独立管理关系。原生文件此时不会改变。</p><label class="field"><span>归入项目</span><select id="import-project">${projectOptions()}</select></label>${state.data.projects.length ? '' : '<p class="warning">请先创建一个项目。</p>'}<div class="import-list">${result.sessions.map(s => `<div class="import-card"><div><strong>${esc(s.title)}</strong><button type="button" data-import="${esc(s.key)}" ${s.managed || !state.data.projects.length ? 'disabled' : ''}>${s.managed ? '已收纳' : '收纳'}</button></div><p>${esc(s.cwd || '未记录工程路径')}</p><p>${s.agent === 'codex' ? 'Codex' : 'Claude Code'} · ${s.messages} 条消息 · ${date(s.updatedAt)}</p></div>`).join('') || '<p class="dialog-copy">未找到本机记录。可以创建新会话，或通过启动参数指定原生数据目录。</p>'}</div>${result.errors.length ? `<p class="warning">${esc(result.errors.map(e => e.message).join('；'))}</p>` : ''}`, null);
        $$('[data-import]').forEach(el => el.onclick = async () => { el.disabled = true; try {
            const b = await api('/import', 'POST', { key: el.dataset.import, projectId: $('#import-project').value });
            el.textContent = '已收纳';
            state.projectId = b.projectId;
            state.branchId = b.id;
            await refresh();
            toast('已收纳到项目，原生记录未改动');
        }
        catch (e) {
            el.disabled = false;
            $('#dialog-error').textContent = e.message;
        } });
    }
    catch (e) {
        $('#dialog-error').textContent = e.message;
    }
}
$('#inbox').onclick = openInbox;
$('#collect').onclick = async () => { try {
    const r = await api('/collect', 'POST', {});
    await refresh();
    toast(r.errors.length ? r.errors.map(e => e.message).join('；') : `已检查更新 · ${r.updates.length} 条会话有新内容`);
}
catch (e) {
    toast(e.message);
} };
$('#sync-settings').onclick = async () => {
    try {
        const c = await api('/webdav');
        modal('同步与设置', `<p class="dialog-copy">资料库完整保存在本机。连接你自己的 WebDAV，即可在另一台设备继续同一个项目。</p>${field('WebDAV 根地址', 'url', c.url, 'https://example.com/dav')}${field('用户名', 'username', c.username)}${field(c.hasPassword ? '密码（留空保留）' : '密码', 'password', '', '', 'password')}<p class="mini-label">ENCRYPTED SYNC</p>${field('加密口令（至少 12 字符，不保存）', 'passphrase', '', '新设备使用同一口令', 'password')}<div class="sync-buttons"><button type="button" class="button" data-sync="push">↑ 推送</button><button type="button" class="button" data-sync="pull">↓ 拉取</button><button type="button" class="button" data-sync="both">⇅ 同步</button></div><p class="dialog-copy" style="margin-top:12px">上次同步：${date(state.data.lastSync?.at)}。拉取不会自动 Activate。</p><details><summary class="dialog-copy">本机数据位置</summary><p class="dialog-copy">Codex：${esc(state.data.roots?.codex || bootRoots.codex)}<br>Claude：${esc(state.data.roots?.claude || bootRoots.claude)}</p></details>${state.data.conflicts.length ? '<p class="mini-label">待选择的元数据冲突</p>' : ''}${state.data.conflicts.map((c, index) => `<div class="conflict-card"><p>本地：${esc(c.local.name)}${c.local.archived ? ' · 归档' : ''}<br>远端：${esc(c.remote.name)}${c.remote.archived ? ' · 归档' : ''}</p><button type="button" data-resolve="${index}" data-choice="local">保留本地</button><button type="button" data-resolve="${index}" data-choice="remote">采用远端</button></div>`).join('')}`, async (form) => { const { passphrase, ...config } = Object.fromEntries(form); await api('/webdav', 'POST', config); toast('连接配置已保存'); }, '保存连接');
        $$('[data-sync]').forEach(el => el.onclick = async () => {
            const buttons = $$('[data-sync]');
            buttons.forEach(b => b.disabled = true);
            $('#dialog-submit').disabled = true;
            try {
                const values = Object.fromEntries(new FormData($('#dialog-form')));
                await api('/webdav', 'POST', { url: values.url, username: values.username, password: values.password });
                $('#dialog-error').textContent = '正在加密并同步…';
                const r = await api('/sync', 'POST', { direction: el.dataset.sync, passphrase: values.passphrase });
                $('#dialog-error').textContent = '';
                toast(`同步完成 · 拉取 ${r.pulled} 个版本 · 上传 ${r.uploaded} 个片段`);
                await refresh();
            }
            catch (e) {
                $('#dialog-error').textContent = e.message;
            }
            finally {
                buttons.forEach(b => b.disabled = false);
                $('#dialog-submit').disabled = false;
            }
        });
        $$('[data-resolve]').forEach(el => el.onclick = async () => { try {
            await api('/conflicts/resolve', 'POST', { index: Number(el.dataset.resolve), choice: el.dataset.choice });
            await refresh();
            $('#dialog').close();
            toast('已记录你的选择');
        }
        catch (e) {
            $('#dialog-error').textContent = e.message;
        } });
    }
    catch (e) {
        toast(e.message);
    }
};
$('#search').oninput = renderGraph;
$('#show-archived').onchange = renderGraph;
for (const view of ['graph', 'list'])
    $('#' + view + '-view').onclick = () => { state.view = view; for (const v of ['graph', 'list']) {
        $('#' + v + '-view').classList.toggle('selected', v === view);
        $('#' + v + '-view').setAttribute('aria-selected', String(v === view));
    } renderGraph(); };
$('#zoom-in').onclick = () => { state.zoom = Math.min(1.5, state.zoom + .1); renderGraph(); };
$('#zoom-out').onclick = () => { state.zoom = Math.max(.4, state.zoom - .1); renderGraph(); };
$('#zoom-reset').onclick = () => { state.zoom = 1; renderGraph(); $('#graph-viewport').scrollTo({ left: 0, top: 0, behavior: 'smooth' }); };
const viewport = $('#graph-viewport');
let pan = null;
viewport.addEventListener('pointerdown', e => { if (e.target.closest('button'))
    return; pan = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; viewport.setPointerCapture(e.pointerId); });
viewport.addEventListener('pointermove', e => { if (pan) {
    viewport.scrollLeft = pan.left + pan.x - e.clientX;
    viewport.scrollTop = pan.top + pan.y - e.clientY;
} });
viewport.addEventListener('pointerup', () => pan = null);
viewport.addEventListener('pointercancel', () => pan = null);
let bootRoots = {};
try {
    const boot = await(await fetch('/api/bootstrap')).json();
    if (boot.error)
        throw new Error(boot.error);
    state.token = boot.token;
    state.data = boot;
    bootRoots = boot.roots;
    $('#mode').textContent = boot.demo ? 'DEMO' : '';
    state.projectId = boot.projects[0]?.id || null;
    state.branchId = boot.branches.find(b => b.projectId === state.projectId && !b.archived)?.id || null;
    renderShell();
    renderGraph();
    if (state.branchId)
        await selectBranch(state.branchId);
}
catch (e) {
    toast(e.message);
}
