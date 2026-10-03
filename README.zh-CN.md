# Session Grove

[English](README.md) · **简体中文**

**留住上下文，探索不同方向，随时回到有价值的工作。**

Session Grove 是面向 **Claude Code 和 Codex** 的本地会话管理工具，支持 Windows 和 macOS。把分散的 AI 对话收进项目，看清思路如何分叉，再从你真正需要的上下文继续。

适合已经长出许多分支的研究、写作和软件项目。

![项目中的原始对话、命名节点和当前激活路径](docs/images/workspace.png)

*对话与分支图并排显示。点击一个节点，就能找到它背后的上下文。*

## 当工作不止一个方向

你花了一段时间建立背景，尝试两个方案，完善其中一个，然后又想回到之前的思路。聊天列表里留下许多相似的名字，而真正重要的是它们之间的关系。

| 想做的事 | Grove 如何帮助你 |
| --- | --- |
| 把同一件事收在一起 | 一个 Project 可以同时包含 Claude 和 Codex 会话；有共同历史的对话折叠为一棵树。 |
| 找回有用的思路 | 搜索资料库、阅读原始对话，并为连续的工作片段命名。 |
| 尝试另一个方向 | Activate 所选节点，从对应上下文创建续接，保留已有分支。 |
| 决定带上多少历史 | 预览上下文和 token 估算，选择已记录的压缩结果，或可恢复的压缩前历史。 |
| 换一个工具继续 | Activate as 将所选前缀转为 Claude Code 或 Codex 可读取的会话，可选三种文本保留范围。 |
| 换一台电脑接着做 | 从私有 Git 仓库 Pull 资料库，再把会话激活到本机工作目录。 |

你仍在熟悉的 Agent 中对话，在 Grove 里整理、比较和找回工作。

## 跟着项目走的资料库

用项目收纳持续推进的工作。日常问题先留在 **Ungrouped**，有需要时再归类。工具和设备标记显示对话来源，Active 表示本机客户端中可继续的会话。

![项目列表中的共享分支树、Claude 与 Codex 会话和未分类收纳箱](docs/images/library.png)

新对话会留在 **Pending**。选中一段，命名为“项目背景”“比较方案”或“原型反馈”。这些名称组织历史，不会改写原始对话。双击项目名、会话名或节点标题即可原位编辑；勾选保存，点击外部或按 Esc 取消。

## 从有价值的节点继续

选中节点并点击 **Activate**，即可预览上下文估算、目标目录，以及它在原生工具中显示的名称。在同一个面板选择 **Switch tool**，还可以换一个 Agent 继续。

![历史节点的激活预览，展示上下文估算和切换工具入口](docs/images/activation.png)

同工具激活会保留支持的原生记录，包括已记录的工具活动和推理。跨工具转换保存文本表示及来源信息。客户端指令、模型行为、外部文件和不可展开的压缩内容仍可能不同；具体边界见[上下文说明](docs/context-and-sync.md)。

## 少一些整理负担

可选的 **Smart Organization** 会为已有和新会话补齐模型命名、分类新会话，并为分叉节点起名。填入自己的 OpenAI API key 后，会话整理和节点命名可以独立开启；手动名称会保留。

Session 名称代表整棵树，与各条 Transcription 路径独立。自动会话名跟随第一个已命名节点更新，手动会话名保持不变；路径选单显示客户端中的名称。独立的**新增节点时更新 Transcription 标题**开关默认关闭。兼容的 Codex VS Code 客户端运行时，分叉或压缩产生新节点后，可以同步更新 Grove 和客户端的路径标题，无需重启。命名只使用已完成节点中的用户请求和简短回复；末尾内容持续更新不会触发请求，相同内容复用结果。开启开关不会批量改名现有路径，尚未验证兼容的客户端或平台会禁用此选项。

默认同时处理两个请求，可在 Settings 改为串行或最多四个并发，并设置请求最小间隔。进度会说明正在做什么、还剩多少，以及需要处理的问题。只有启用功能时才会把选取的消息发送给 OpenAI。

Settings 也可以调整 Codex 的上下文窗口和自动压缩阈值，以及 Claude 的自动压缩窗口。留空继承客户端默认值，实际容量仍受模型限制。保存 API key 后输入框禁用，按钮变为 Remove key；删除后恢复录入和验证流程。

## 几分钟试用

准备 **Node.js 24+** 和 Git，然后运行：

```sh
git clone https://github.com/MRziyi/session-grove.git
cd session-grove
pnpm install
pnpm run demo
```

打开 **http://127.0.0.1:7421**。Demo 使用示例会话，不读取个人历史。上面的截图来自真实界面中的合成示例。

管理自己的会话时，先停止 Demo，运行 `pnpm start`，再点击 **Update**。Grove 会读取本机 Claude Code 和 Codex 会话目录。浏览、整理和创建续接时，可以继续运行原生 Agent。

也可以使用 npm：`npm install`、`npm run demo`、`npm start`。左下角可切换中英文。

## 第一次使用

新资料库会显示简短引导和 **Update · 查找本机会话** 按钮。打开 Grove 本身不会自动扫描或上传；Git 同步和 OpenAI API key 都是可选项。

1. 点击 **Update**，读取本机 Codex 和 Claude Code 的已有对话。空库首次扫描后会进入 **Projects**，便于看到两个客户端的会话。没有结果时，先在客户端创建对话；展开**扫描目录**检查 Grove 查找的位置。自定义目录见[配置说明](docs/operations.md)。
2. 打开会话查看原文和分支图。**Session** 是整棵对话树，Transcription 选择器对应客户端的一条对话路径，**node** 是路径中的一段对话。**Pending** 表示还没有节点标签，不代表模型正在运行。
3. 勾选会话，通过 **Move to project → New project…** 创建项目，也可以把会话拖入已有项目；双击标题改名。**Current Active** 显示本机客户端可用的会话，**Projects** 也保留未激活的会话。
4. 选中节点并点击 **Activate**，选择工作目录后确认。有对应扩展时，可点击 **Open in VS Code**。继续在客户端聊天，再用 Grove 的 **Update** 读取新内容。

如果要读取另一台电脑的资料库，点击左侧**配置同步**。创建一个空的**私有 GitHub 仓库**，或使用已有 Grove 数据仓库；先配置好本机 Git SSH 访问，再到 **Settings → Git repository → Verify and connect** 填写仓库的 SSH 地址。使用独立数据仓库，不要填写本应用的源码仓库。**Pull** 读取远端资料；**Push** 先 Pull，再上传本地变更。连接配置完成前，两者保持灰色不可用。验证失败时可查阅[配置说明](docs/operations.md)。

左下角的 **ⓘ Information** 按钮可随时打开使用指南，不必完成同步或智能命名配置才能开始使用。

## 登录自启动

自启**默认关闭**。打开 Grove 后，进入 **Settings → 本地服务 → 登录后自动启动**：

1. 打开开关，下次登录 macOS 或 Windows 时就会自动启动 Grove。
2. 查看旁边的状态：**已关闭、已开启、正在更新或设置失败**。失败时保留原设置，并显示原因。
3. 关闭开关即可取消之后的登录自启，当前正在运行的服务仍保持可用。

macOS 上 Grove 作为后台服务运行，不一定显示在 **Open at Login（登录时打开）**应用列表中，也不会在登录时打开浏览器。

Grove 会自动配置当前用户的 macOS LaunchAgent 或 Windows 启动快捷方式，无需手写配置文件或执行终端命令。演示模式会禁用这个开关。移动仓库或更换 Node 安装位置后，把开关关掉再打开即可更新保存的路径。后台输出日志位于 `~/.session-grove/logs/server.log`，Windows 对应 `%USERPROFILE%\.session-grove\logs\server.log`。

## 资料在自己手中，工作在设备间继续

需要同步时，在 Settings 连接自己的**私有 Git SSH 仓库**。**Pull** 下载资料库；**Push** 先 Pull，再发布本地修改。默认手动操作，自动上传需要主动开启，各设备独立保留自己的 Active 选择。

本地及同步仓库保存可读历史。项目代码、Agent 凭据和智能整理 API key 不参与同步。Trash 从当前资料库移除会话，并提供可配置期限的本地恢复；旧 Git 提交仍保留历史。

## 继续了解

[部署与排错](docs/operations.md) · [上下文与分支](docs/context-and-sync.md) · [Git 同步](docs/git-sync.md) · [1.0 验证与性能](docs/1.0-windows-validation.md) · [1.1 真实资料库验证](docs/1.1-validation.md) · [更新记录](CHANGELOG.md)

反馈问题时，请附上选择了什么、发生了什么，以及界面的错误编号。请勿将私密对话或凭据放入公开 issue。

欢迎[反馈问题](https://github.com/MRziyi/session-grove/issues)和贡献。`pnpm test` 运行回归测试，`pnpm test:browser` 运行浏览器验收。

作者：[Ziyi Zhang](https://ziyi-zhang.vercel.app)。设计参考：[codex-session-sync](https://github.com/shonngithub/codex-session-sync)、[claude-sync](https://github.com/tawanorg/claude-sync)、[Chronicle](https://github.com/geekmuse/chronicle)。[MIT License](LICENSE)。
