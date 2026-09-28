# Session Grove

[English](README.md) | **简体中文**

**以项目组织、分叉和管理 Agent 会话。**

Session Grove 是 Codex 与 Claude Code 的本机会话管理控制端。在网页中管理项目、检查点、分支、归档和显式 Active 清单；在原生 CLI / IDE 中继续对话；新增记录回到原项目。WebDAV 是可选的跨设备传输层。

当前版本：**0.4.0，实验性本机版本**。核心与适配器已有自动测试；Codex 的原生读取 / 恢复已在下表版本验证，Claude Code 尚未进行真实客户端往返验证。

## 启动

需要 **Node.js 24 或更高版本**。Node.js 是运行时，**pnpm / npm 是包管理器和脚本入口**，两者配合使用。当前没有第三方运行或开发依赖，也没有构建步骤，无需先执行 install。

从仓库目录运行，默认监听 `127.0.0.1:7421`。

### pnpm

```sh
# 隔离演示：不读取个人会话目录
pnpm run demo

# 管理本机会话：默认资料库 ~/.session-grove
pnpm start

# 自动测试
pnpm test
```

### npm

```sh
npm run demo
npm start
npm test
```

两套命令使用同一个 `package.json`，执行相同的 Node.js 程序，无需更换技术栈。示例均从 Git clone 后的仓库目录执行，项目尚未发布到 npm registry。

### 自定义参数

```sh
# pnpm：参数直接跟在脚本名后
pnpm start --data-dir /path/to/grove \
  --codex-home /path/to/.codex --claude-home /path/to/.claude

# npm：使用 -- 将参数传给脚本
npm start -- --data-dir /path/to/grove \
  --codex-home /path/to/.codex --claude-home /path/to/.claude
```

打开终端中显示的地址。演示和真实模式使用独立资料库；同一资料库只允许一个服务进程。如果只安装了 Node，也可以直接运行 `node bin/session-grove.js --demo`。

仓库以 `pnpm-lock.yaml` 作为主要依赖锁文件，目前其中没有第三方包。npm 用户可以直接运行同一套 scripts，无需为了启动或测试再生成一份锁文件。

## 使用流程

界面默认 **English**，顶部栏可以切换 **中文**，并记住选择。

1. **在原生客户端开始会话**：点击 Update 收纳更新。Current Active 分 Codex / Claude Code，统计本机实际激活的原生会话。
2. **整树归入项目**：未分类记录在 Ungrouped 下。勾选后 Move to project，可选择已有项目或当场新建。存在相同完整前缀的原生分叉折叠成一条列表项；项目计数中一棵树算一项。
3. **搜索与排序**：搜索标题和完整对话内容，结果显示对应的 session / tree。仅按项目或 Ungrouped 分段，按各段最近对话更新时间、再按段内条目时间降序排列。
4. **Transcript 与 Graph 对照**：详情页保留收窄的导航和会话列表，右侧并排展示完整路径的对话与逻辑图。点击不同图分支切换全文；自动颜色和色带连接对话与 Node。未整理内容用暖色系 Pending，与已整理节点的冷色系区分。
5. **Combine / Dissolve**：勾选连续 chats，Combine 并命名为逻辑节点；Dissolve 则让所选内容原地回到 Pending。可以拆出节点的一部分，再与相邻节点的部分内容重新合并。共享前缀的整理影响所有继承分支，Combine 不可跨分叉点，原始记录不变。
6. **在路径末端 Activate / Deactivate**：激活时指定本机工程目录；实际对话仍在原生客户端。停用保留项目历史。原生写入要求先关闭运行中的 Agent / IDE 扩展，完成后重新打开。被阻止的操作不会提前改变激活或归档状态。
7. **归档与恢复**：归档整个会话树或项目时保留历史并停用本机对应会话。已归入项目的内容恢复后回到该项目，不自动激活。未归类内容恢复时须选择项目（可新建），确保恢复后有可找到的入口，同样不自动激活。

普通会话由原生客户端发起；Grove 只通过完整轮次检查点的 Fork 创建新分支，不提供空会话创建入口。逻辑 Node 可按单条 chat 切分，和原生完整轮次是不同概念。原始工具事件与未知字段仍保留。

CLI / IDE 使用同一原生数据目录时共享激活状态；设备和客户端只作为来源信息。后台每 10 秒收纳本机变化；节点命名和项目归类不会改变列表里的对话修改时间。

节点显示包含已识别工具文本的粗略 token 估算；Context 面板单独展示原生输入统计和 compact 事件。可读摘要有保存就展示，加密压缩内容明确标为不可读，不伪造摘要或质量评分。详见 [Context and sync](docs/context-and-sync.md)。

完整术语、两页布局和操作规则见 [Interaction model](docs/interaction-model.md)。

## WebDAV 同步

在“Sync & settings / 同步与设置”中填写 WebDAV 根地址、用户名和密码，并解锁自动同步。加密口令至少 12 字符，每台设备使用同一口令。

- AES-256-GCM 认证加密，使用 scrypt 从口令和资料库盐派生密钥；先压缩再加密。
- 加密口令不落盘。WebDAV 登录配置以用户专属权限保存在本机 `webdav.json`。
- 不可变内容片段按哈希去重；先上传依赖，再发布加密版本清单。
- 拉取不会同步认证配置、原生数据库、Active 清单或自动写回原生目录。
- 同一分支在两台设备独立继续时，保留两个发展方向；名称 / 归档等元数据冲突在设置中显式选择。
- 解锁后，归入项目、整理节点、分叉、归档、恢复会触发受影响树的上传，连续操作合并等待 2 秒。原生新增对话只更新本机 Pending，不自动上传。
- 手动 Upload 可上传尚未整理的 Pending；没有改动时按钮置灰，悬停显示最近一次成功上传时间。Sync 只检查云端目录。
- 每 15 秒检查小目录；打开项目加载列表索引，打开树再取缺失或更新的图和正文。小云标识区分仅云端、已缓存、云端有更新、本地未上传。
- 全文搜索可能按需下载项目内的正文；普通列表浏览不下载。断网时已有缓存仍可读。
- 未配置、未解锁或断网时继续本地保存，显示待上传或重试；不能把仅本地保存标记成已上云。
- 未归类记录和本机 Active 选择不上传。不同设备解锁同一资料库后看到相同项目结构。
- 口令只保留在本次进程内存中，服务重启后需要重新解锁。远端历史对象不自动删除。

使用 HTTPS；HTTP 仅允许本机测试。新目录协议为 schema 4，树图沿用 schema 3；所有写入设备应升级到 0.4.0+。旧资料库可先索引、再按需下载正文，迁移后不支持新旧版本混合写入。远端在所填路径下创建 `session-grove-v1/`，不修改其他目录。首次使用可从少量会话开始。

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

跨 Agent 上下文转换、Remote SSH / 容器、打开指定 IDE 标签页不在此版本中。界面和公开 API 不提供空会话创建入口。

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

原生写入失败时尝试回滚。若进程中途退出，Settings 会显示未完成操作，并提供“恢复操作备份”。恢复前会再次保存当前文件，避免丢弃崩溃后产生的内容。操作备份目前没有自动清理机制。

服务只监听 loopback，校验 Host、Origin、Fetch Metadata 与写入访问凭证。网页不加载第三方脚本，不发送遥测。原始记录按个人资料处理；开源仓库不应包含 `.grove/`、导出的资料库或实际会话样本。

## 验证

```sh
pnpm test
# npm 用户：npm test

# 可选：真实 Codex，只操作临时目录，不带入个人认证，不提交模型请求
pnpm run test:codex
# npm 用户：npm run test:codex
```

测试覆盖分支检查点冻结、历史去重、路径迁移、更新回收、并发分歧、归档恢复、未知 schema 拒绝写入、故障恢复、API 访问限制及加密 WebDAV 往返。

浏览器验证使用独立 Chrome profile 和一份新的演示资料库：先用 `--demo --data-dir .grove/browser-test` 启动服务，再启动带 `--remote-debugging-port=9228` 的 Chrome，然后运行 `pnpm run test:browser`（可直接追加服务 URL；npm 使用 `npm run test:browser -- URL`）。它会验证两页导航、计数、全文搜索、分支切换、共享前缀编辑、Combine / Dissolve、整树归类、激活、停用和归档；截图和兼容性报告写到忽略的 `test-results/`。每次完整验收使用新的演示资料库。

## 技术栈

当前使用 Node.js 24、原生 JavaScript ES Modules、Node 内置 SQLite 和浏览器端 DOM / SVG。当前代码尚未迁移到 TypeScript。

本项目目前更需要稳定的原生格式适配和快速的界面迭代，保留 Node.js 可以复用现有实现与测试。若后续重视免装 Node 的单文件分发，Go 值得评估；若实际测量证明大量历史解析、去重或内存占用成为瓶颈，再评估 Rust 或原生工作模块。不同语言尚未做本项目的对照基准测试，不宣称哪一个最快。

当前值得优先优化的是全量扫描 / 重复解析、同步 I/O，以及主线程上的压缩和密钥派生。具体依据与评估顺序见 [Technology choices](docs/technology.md)。

## 项目结构

```text
bin/                    本地服务 CLI
src/store.js            项目、版本、去重片段与合并
src/organization.js     旧版逻辑节点与原生前缀归树
src/workspace.js        会话列表、共享路径图与可编辑 Node 整理层
src/auto-sync.js        整理触发上传、目录检查和状态
src/cloud.js            加密云目录、项目索引和按需取树
src/context.js          Token 估算和原生 compact 事件
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
