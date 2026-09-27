let language = localStorage.getItem('grove-language') === 'zh' ? 'zh' : 'en';
const dictionary = {
    'Local Active': '本机 Active', 'Cloud projects': '云端项目', 'All local sessions': '本机会话总览', 'Language': '语言', 'items': '项', 'segments': '个片段',
    'Projects': '项目', 'New project': '新建项目', 'New session': '新会话', 'Refresh': '更新',
    'Active set': 'Active 清单', 'Sync & settings': '同步与设置', 'Local first. Yours to keep.': '本地优先，由你掌握。',
    'Your current working set': '当前正在使用的会话', 'Unfiled sessions stay on this device. Move a session or a whole tree into a project to sync it.': '未归类的会话只保留在本机。将单条会话或整棵树移入项目后自动同步。',
    'PROJECT COLLECTION': '项目资料库', 'LOCAL WORKSPACE': '本机工作区', 'Search sessions…': '查找会话…', 'Show archived': '显示归档',
    'A place for every line of thought.': '让每条思路都有归处。', 'Your active sessions will appear here automatically.': '本机正在使用的会话会自动出现在这里。',
    'Create a session or move local work into this project.': '创建会话，或将本机的工作移入这个项目。',
    'No matching sessions': '没有匹配的会话', 'Try another search or show archived items.': '试试其他搜索词，或显示归档内容。',
    'Ungrouped': '未分组', 'Unfiled': '未归类', 'Session': '单条会话', 'Branch tree': '分支树', 'branches': '条分支',
    'messages': '条消息', 'Pending': '待整理', 'Committed': '已提交', 'New direction': '新的工作方向', 'Shared context': '共同上下文',
    'Open tree': '进入分支图', 'Open session': '打开会话', 'Move to project': '移入项目', 'Move / group': '移动 / 分组',
    'Back to collection': '返回项目列表', 'Tree': '分支图', 'Timeline': '逻辑节点', 'Fit': '适应', 'Context inheritance': '上下文继承',
    'Select a logical node': '选择一个逻辑节点', 'A node is a named piece of work. New conversation stays in Pending until you organize it.': '一个节点代表一段命名的工作。新增对话会保留在 Pending，直到你整理它。',
    'NODE DETAILS': '节点详情', 'Full context': '完整上下文', 'This node': '当前节点', 'Commit a range': '归类为节点',
    'Fork': '分叉', 'Archive session': '归档会话', 'Restore session': '恢复会话', 'Rename session': '重命名会话',
    'Activate': '激活', 'Active settings': 'Active 设置', 'Active': '已激活', 'Waiting to activate': '待激活', 'Waiting to hide': '待收起',
    'Activate latest context': '激活最新上下文', 'Activate continues the latest context of this session, including Pending. To continue from an earlier node, fork from its checkpoint first.': '激活会继续此会话的最新上下文，包含 Pending。若要从较早节点继续，请先从该节点的检查点分叉。',
    'Archived': '已归档', 'Stored': '已保存', 'Conflict': '分歧', 'You': '你', 'Tool': '工具', 'Source & revisions': '来源与版本',
    'Unknown device': '未知设备', 'Unknown interface': '交互入口未知', 'Project checkpoint': '项目检查点',
    'No new messages yet. Activate this direction to continue in your agent.': '还没有新增消息。激活这个方向，在原生 Agent 中继续。',
    'Inherited context is collapsed. Switch to Full context to inspect it.': '继承的上下文已折叠。切换到“完整上下文”可查看。',
    'Commit Pending': '整理 Pending', 'Name this piece of work': '为这段工作命名', 'For example: Finished the introduction': '例如：完成 Introduction 初稿',
    'Commit through': '归类到', 'First {count} messages · turn {turn}': '前 {count} 条消息 · 第 {turn} 轮',
    '{count} messages will remain in Pending.': '剩余 {count} 条消息继续保留在 Pending。',
    'Ranges end at complete turns, keeping tool calls and results together. The native conversation is not changed.': '按完整轮次切分，保持工具调用与结果完整；不会修改原生对话。',
    'Commit node': '提交节点', 'Node committed': '逻辑节点已提交', 'Waiting for a complete turn before this range can be committed.': '等待完整轮次结束后才能提交这段记录。',
    'Create a branch': '创建分支', 'Branch name': '分支名称', 'Fork at': '分叉位置', 'Turn {turn} · record {end}': '第 {turn} 轮 · 原生记录 {end}',
    'The checkpoint is fixed. Creating a branch does not change the Active set.': '检查点固定保存。创建分支不会改变 Active 清单。',
    'Create branch': '创建分支', 'Branch created': '分支已创建', 'Session name': '会话名称', 'Agent': 'Agent',
    'This session starts in the selected collection. Activate it explicitly when you are ready.': '会话将在当前列表中创建，准备好后再显式激活。',
    'Create session': '创建会话', 'Session created': '会话已创建', 'Name': '名称', 'Description': '描述', 'Project created': '项目已创建',
    'Save': '保存', 'Cancel': '取消', 'Close': '关闭', 'Destination project': '目标项目', 'Group (optional)': '分组（可选）',
    'For example: Miscellaneous': '例如：杂项', 'This moves the entire item, including every branch and logical node. Upload is queued automatically.': '整个条目及其所有分支、逻辑节点一起移动，并自动排队上传。',
    'Move': '移动', 'Moved to project': '已移入项目', 'Create a project first.': '请先创建一个项目。',
    'Working directory': '工程目录', 'Choose an existing local project folder. Saving only updates the desired set; review and apply it next.': '选择本机已存在的工程目录。保存仅修改期望清单，之后检查并应用。',
    'Remove from Active': '移出 Active', 'Set Active': '设为 Active', 'Active set updated': 'Active 清单已更新',
    'Apply Active set': '应用 Active 清单', 'Only observed / imported sessions are managed. Close running agents and IDE extensions before applying.': '只管理已发现或已收纳的会话。应用前请关闭运行中的 Agent 和 IDE 扩展。',
    'Hide': '收起', 'No changes to apply.': '没有待应用的变更。', 'Apply to native storage': '应用到原生存储', 'Changes applied': '变更已应用',
    'Recover interrupted operation': '恢复未完成的操作', 'Archive': '归档', 'Restore': '恢复',
    'History and child branches are retained. Archiving also queues removal from this device’s Active set.': '历史和子分支都会保留。归档也会将本机实例标记为待收起。',
    'Restoring does not automatically activate the session.': '恢复不会自动激活会话。', 'Session updated': '会话已更新',
    'Project details': '项目信息', 'Settings': '设置', 'WebDAV URL': 'WebDAV 地址', 'Username': '用户名',
    'Password': '密码', 'Password (blank keeps existing)': '密码（留空保留）', 'Encryption passphrase': '加密口令',
    'At least 12 characters; same on every device': '至少 12 字符，每台设备使用相同口令',
    'Unlock automatic project sync': '解锁项目自动同步', 'Sync now': '立即同步', 'Lock sync': '锁定同步', 'Save connection': '保存连接',
    'Filed projects sync automatically while this service is unlocked. Local unfiled sessions and Active selections never upload. The passphrase stays in memory only.': '本次服务解锁后，已归类项目自动同步。本机未归类会话和 Active 选择不会上传。加密口令只保留在内存中。',
    'Connection saved': '连接已保存', 'Sync complete': '同步完成', 'Never': '从未', 'Last sync': '上次同步',
    'Configure sync': '配置同步', 'Unlock sync': '解锁同步', 'Upload queued': '待上传', 'Syncing…': '同步中…', 'Synced': '已同步', 'Retrying': '等待重试',
    'METADATA CONFLICTS': '元数据冲突', 'Keep local': '保留本地', 'Use remote': '采用远端', 'Local': '本地', 'Remote': '远端',
    'Choice saved': '已保存选择', 'Native data locations': '原生数据位置', 'Refresh complete · {updates} updated · {discovered} discovered': '更新完成 · {updates} 条有新内容 · 新发现 {discovered} 条',
    'Refresh the page and try again.': '请刷新页面后重试。', 'Operation failed. Check the current session state and try again.': '操作失败，请检查会话状态后重试。',
    'Pending changed. Refresh before committing.': 'Pending 已更新，请刷新后再提交。', 'This range was already organized. Refresh before committing.': '该范围已被整理，请刷新后再提交。',
    'Choose a complete turn boundary.': '请选择完整轮次边界。', 'Choose a destination project.': '请选择目标项目。',
    'Encryption passphrase needs at least 12 characters.': '加密口令至少需要 12 字符。', 'Configure WebDAV and unlock project sync first.': '请先配置 WebDAV 并解锁项目同步。',
    'Native history available on this device': '本机原生历史', 'Browse history': '浏览历史', 'Import': '收纳', 'Imported': '已收纳', 'No native sessions found.': '没有发现原生会话。',
    'Imported into project': '已收纳到项目', 'Saved locally': '已保存到本机', 'Project work is queued for sync': '项目工作已排队同步',
    'New project name': '新项目名称', 'SESSION GROVE': 'SESSION GROVE', 'Scope': '范围', 'Collection': '项目列表'
};
export function t(key, values = {}) {
    let result = language === 'zh' ? dictionary[key] || key : key;
    for (const [name, value] of Object.entries(values))
        result = result.replaceAll(`{${name}}`, String(value));
    return result;
}
export const locale = () => language;
export function setLocale(value) { language = value === 'zh' ? 'zh' : 'en'; localStorage.setItem('grove-language', language); document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; }
const errors = {
    '请先关闭 Codex / Claude 的运行会话及对应 IDE 扩展，再应用 Active 清单。资料库浏览与分支不受影响。': 'Close running Codex / Claude sessions and their IDE extensions before applying the Active set.',
    '目标必须是本机存在的绝对工程目录': 'Choose an existing absolute working-directory path.',
    '同步进行中，请稍后操作': 'Project sync is in progress. Please try again shortly.',
    '请先恢复归档分支': 'Restore this archived session first.',
    '解密或完整性校验失败，请检查加密口令': 'Decryption failed. Check the encryption passphrase.',
    '此会话包含外部附件引用。当前版本可浏览和分支，完整附件迁移尚未支持。': 'This session references external attachments. Full attachment migration is not supported yet.',
    '此会话含伴随目录，当前版本尚未完整收纳；拒绝移除或改写原生记录': 'This session has auxiliary files that have not been captured. Native changes are blocked.',
    '存在未完成操作，请先恢复备份': 'Recover the interrupted native operation before applying changes.',
    '只能从已完成的轮次创建分支': 'Choose a completed turn to fork.',
    '本地访问凭证无效，请刷新页面': 'Refresh the page to renew its local access token.'
};
export function errorText(message) {
    if (language === 'zh')
        return dictionary[message] || message;
    if (errors[message])
        return errors[message];
    if (/[\u4e00-\u9fff]/.test(message))
        return 'Operation failed. ' + (message.includes('不能为空') ? 'Enter a name within the field length limit.' : 'Check the session compatibility and current native process state.');
    return message;
}
