# Session Grove

**以项目组织、分叉和管理 Agent 会话。**

Session Grove 是 Codex 与 Claude Code 的本机会话管理控制端。在网页中管理项目、检查点、分支、归档和显式 Active 清单；在原生 CLI / IDE 中继续对话；新增记录回到原项目。WebDAV 是可选的跨设备传输层。

当前版本：**0.1.0，实验性本机版本**。核心与适配器已有自动测试；Codex 的原生读取 / 恢复已在下表版本验证，Claude Code 尚未进行真实客户端往返验证。

## 启动

只需要 **Node.js 24 或更高版本**。无 npm 依赖、无需构建，默认监听 `127.0.0.1:7421`。

```sh
# 隔离演示：内置 Chrono 项目，不读取个人会话目录
node bin/session-grove.js --demo

# 管理本机会话：默认资料库 ~/.session-grove
node bin/session-grove.js

# 自定义数据位置
node bin/session-grove.js --data-dir /path/to/grove \
  --codex-home /path/to/.codex --claude-home /path/to/.claude
```

打开终端中显示的地址。演示和真实模式使用独立资料库；同一资料库只允许一个服务进程。

若有 npm，也可使用 `npm start`、`npm run demo`、`npm test`。直接运行 Node 的命令与之等价。

## 使用流程

1. **新建项目**，如 Chrono。项目身份独立于磁盘路径。
2. **收纳已有会话**：扫描原生目录，选择会话归入项目。此步骤只读取原生数据。
3. 在分支详情选择一个**已完成检查点**，创建新的工作分支。共享历史在资料库中去重，父分支后续变化不改变子分支起点。
4. 点击 **Activate**，填写本机工程目录。此时只是修改期望清单。
5. 打开 **Active 清单**，查看待激活 / 待收起的记录。关闭正在运行的 Agent 及 IDE 扩展后，点击“应用到原生存储”。
6. 重新打开原生客户端，继续会话。后台每 10 秒检查已收纳实例；也可点击“收纳更新”。
7. 回到 Grove 创建下一条分支或归档。归档保留历史，取消本机 Active 的操作进入待应用清单。

CLI 与 IDE 若使用相同的 Agent 数据目录，共享同一个激活实例。Session Grove 不按客户端复制项目。来源记录保留设备、路径和收纳版本；无法判断具体交互入口时显示未知。

**纳管范围**：Active 清单只控制已经收纳的原生会话。未收纳的会话不会被隐藏。要让整个原生日常列表对应清单，需要先将希望接管的记录收纳到项目，再应用清单。

点击项目标题两次可修改项目信息；分支详情右上角可修改分支名称和分组。图支持平移、缩放、搜索、归档筛选和列表视图。分组不会改变真实继承关系。

## WebDAV 同步

在“同步与设置”中填写 WebDAV 根地址、用户名和密码。为同步选择至少 12 字符的独立加密口令，在每台设备上使用同一口令。

- AES-256-GCM 认证加密，使用 scrypt 从口令和资料库盐派生密钥；先压缩再加密。
- 加密口令不落盘。WebDAV 登录配置以用户专属权限保存在本机 `webdav.json`。
- 不可变内容片段按哈希去重；先上传依赖，再发布加密版本清单。
- 拉取不会同步认证配置、原生数据库、Active 清单或自动写回原生目录。
- 同一分支在两台设备独立继续时，保留两个发展方向；名称 / 归档等元数据冲突在设置中显式选择。
- 推送、拉取、双向同步均为手动触发；传输失败可重试。远端历史对象不自动删除。

使用 HTTPS；HTTP 仅允许本机测试。远端在所填路径下创建 `session-grove-v1/`，不修改其他目录。首次使用可从少量会话开始。

## 兼容性与当前边界

| 能力 | 当前状态 |
| --- | --- |
| 项目、分支、检查点、共享片段、归档、来源记录 | 已实现并测试 |
| Codex legacy JSONL 与 `state_5.sqlite` | 已实现；未知必填字段拒绝写回 |
| Codex 0.155.0-alpha.16.3 | 用真实 App Server 验证 list / read / resume / deactivate / reactivate；没有提交模型 turn |
| Codex VS Code 面板刷新 | 通过底层存储适配；未做扩展面板的自动化验收，需要重新打开 / 重载 |
| Claude 项目 JSONL、路径编码、history 索引 | 文件适配与往返测试通过；本机未安装 Claude，真实客户端验证尚未完成 |
| 本机原生写入 | 冷写入；检测到任何 Codex / Claude 进程时拒绝应用 |
| WebDAV | 本地协议服务测试通过；尚未逐项验证 Nextcloud、Synology 等供应商 |

当前不会迁移工程代码、账号认证、插件和后台进程。外部附件引用、非 legacy Codex 历史格式和超长 Claude 项目路径会阻止激活，不以不完整恢复冒充成功。嵌入在原始记录中的内容保留；subagent 伴随目录和其他外部资源尚不支持打包。

路径映射只处理已知结构化字段。历史消息和工具输出保留原样。旧路径仍可能出现在历史正文中，目标工程应已有对应文件，必要时在原生对话中说明新目录。

跨 Agent 上下文转换、Remote SSH / 容器、打开指定 IDE 标签页、持续双向自动同步不在此版本中。新建空会话可物化，但不同原生客户端可能只在第一条消息后显示它。

## 数据与恢复

```text
~/.session-grove/
  device.json            本机身份
  grove.sqlite           项目 / 分支 / 不可变版本 / 去重原始片段
  webdav.json            本机同步连接配置
  operations/            原生写入操作日志与修改前备份
  parked/                已取消激活的原生记录
  recovery-snapshots/    手动故障恢复前额外保留的当前数据
```

资料库保留原始 JSONL 行，包括未知字段。搜索展示模型并非唯一恢复来源。更新回收比较精确物化基线，避免将自身导出再次作为新增历史。

原生写入失败时尝试回滚。若进程中途退出，Active 清单会显示未完成操作，并提供“恢复操作备份”。恢复前会再次保存当前文件，避免丢弃崩溃后产生的内容。操作备份目前没有自动清理机制。

服务只监听 loopback，校验 Host、Origin、Fetch Metadata 与写入访问凭证。网页不加载第三方脚本，不发送遥测。原始记录按个人资料处理；开源仓库不应包含 `.grove/`、导出的资料库或实际会话样本。

## 验证

```sh
node --test test/*.test.js

# 可选：真实 Codex，只操作临时目录，不带入个人认证，不提交模型请求
node scripts/codex-smoke.js
```

测试覆盖分支检查点冻结、历史去重、路径迁移、更新回收、并发分歧、归档恢复、未知 schema 拒绝写入、故障恢复、API 访问限制及加密 WebDAV 往返。

浏览器验证使用独立 Chrome profile，先运行演示服务与带 `--remote-debugging-port=9228` 的 Chrome，然后运行 `node scripts/browser-smoke.js`。它会在演示库中创建测试分支；截图和兼容性报告写到忽略的 `test-results/`。

## 项目结构

```text
bin/                    本地服务 CLI
src/store.js            项目、版本、去重片段与合并
src/transcript.js       原生事件读取、检查点、物化
src/native.js           原生发现、收纳、Active 应用与恢复
src/sync.js             加密 WebDAV 对象与版本传输
src/server.js           同源本地 HTTP API
web/                    项目图与会话管理界面
test/                   独立临时目录测试
scripts/                浏览器与原生 Codex 兼容性验证
docs/                   实现说明与待完善项
```

## 参考与许可

设计参考 [codex-session-sync](https://github.com/shonngithub/codex-session-sync)、[claude-sync](https://github.com/tawanorg/claude-sync) 和 [Chronicle](https://github.com/geekmuse/chronicle)。借鉴了原生多存储协调、路径映射和按需物化的思路；项目图、显式 Active 集合和控制端由 Session Grove 独立维护。

原生格式参考 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 与 [Claude Code 会话文档](https://code.claude.com/docs/en/sessions)。

[MIT License](LICENSE)
