# Session Grove

[English](README.md) | **简体中文**

**你的 AI 对话已经长成一棵树，不应该只能在一长串聊天列表里寻找它。**

Session Grove 是面向 **Claude Code 和 Codex** 的项目式会话管理工具。你继续在 CLI 或 VS Code 插件里与 Agent 对话；在 Grove 中整理对话历史、保存有用的上下文、管理分支，并通过自己的 WebDAV 在另一台 Mac 上接着工作。

![Session Grove 的对话与分支图](docs/images/workspace.png)

## 当聊天列表开始妨碍工作

你花了一段时间建立上下文，分叉去试另一个想法，又分叉去写 Introduction、调试实现或探索新方法。最后原生列表里塞满了相似的会话。你记得做过什么，却不记得在哪条 session 里。

Grove 给这些工作一个清楚的结构：

- **按项目放在一起。** 一篇论文、一个代码仓库或一项研究，都可以有自己的 Project。共享前缀的会话折叠为一棵树。
- **为工作片段命名。** “建立背景”“完成引言”“测试另一种方法”，都可以成为逻辑 Node。新对话留在 Pending，等你有空再整理。
- **对照阅读正文与分支图。** Transcript 与 Graph 并排展示，颜色与色带对应实际对话和逻辑节点。
- **让原生列表只保留正在用的内容。** 激活需要的路径；归档完成的路径。公共前缀不会丢，仍在用的分支不会一起被隐藏。
- **换一台 Mac 继续。** 项目通过你的 WebDAV 同步。先加载目录，打开具体树时再按需下载上下文。

Grove 管理会话资料库，**Codex 和 Claude Code 仍负责实际对话**。它不替代编辑器插件，也不会替你发送模型请求。

## 日常使用

1. 在 Codex 或 Claude Code 里开始对话，回到 Grove 点击 **Update**。
2. 勾选未归类的会话，用 **Move** 放进已有或新建的 Project。
3. 打开树，点击一条对话作为起点，再点击终点，中间内容自动选中。**Combine** 把它命名为一个节点，**Dissolve** 让所选内容回到 Pending。
4. 选中图节点可直接 **Rename**。给 Pending 命名后，它就成为正式节点。节点结束于完整轮次时才出现 **Fork**。
5. 选中 session 的末端，才能激活、停用或归档这条路径。归档区会保留它的完整前缀；在用图里只保留还在用的路径。
6. 继续在原生客户端对话，新增内容会进入 Pending。整理节点后自动上传；暂时不想整理，也可以点 **Sync** 把剩余 Pending 一起同步。

按钮只在当前选择适用时出现。语言切换、WebDAV 配置、操作帮助和诊断记录统一放在 **Settings**。

## 启动

需要 **Node.js 24+**，不必安装依赖，也不需要构建。

```sh
git clone https://github.com/MRziyi/session-grove.git
cd session-grove
pnpm run demo
```

打开 **http://127.0.0.1:7421**。演示模式只使用示例数据，不读取个人会话。

要管理真实会话，先停止演示，再运行：

```sh
pnpm start
```

也可以使用 `npm run demo`、`npm start` 和 `npm test`。界面默认英文，在 Settings 中切换中文。

## 上下文留在你自己的存储里

WebDAV 可选，不配置也能在本机整理。配置并解锁后，归入项目、命名节点等整理操作自动触发上传；原生新增对话只先收纳到本机，不会每条回复都上传。

**Sync** 会上传未同步的项目变更（包括未整理的 Pending），并检查云端目录。悬停可查看最近上传和检查时间。不同设备的 Active 选择彼此独立。

原始会话记录会保留。节点编辑只调整整理关系，不改写对话内容。云端数据在上传前加密；默认只在内存中保留加密口令，重启后重新输入；如需无人值守启动，可明确指定本机私有口令文件，详见部署说明。

## 当前范围

**0.5.0，实验性版本，优先 macOS。** 支持同一种 Agent 内分叉和跨设备续接，暂不进行 Claude 与 Codex 之间的上下文转换。

修改原生激活状态目前需要先关闭运行中的 Agent。Codex 已用真实可执行程序验证读取与恢复；Claude 文件适配已有测试，真实客户端验证仍待完成。WebDAV 已通过隔离协议测试与真实 Teracloud 往返测试；其他供应商可能存在差异。

Token 数是估算值。激活前会参考原生统计和本机可读取的上下文容量配置，接近上限时给出提示。

## 测试与反馈

遇到问题时，记录你选了什么、点击了什么，以及界面中的错误编号。**Settings → Diagnostics → Download diagnostics** 可以导出操作类型、耗时和错误编号，不含对话正文或凭据。

```sh
pnpm test
```

[部署、数据位置和排错](docs/operations.md) · [交互规则](docs/interaction-model.md) · [上下文与同步细节](docs/context-and-sync.md) · [技术选择](docs/technology.md)

设计参考：[codex-session-sync](https://github.com/shonngithub/codex-session-sync)、[claude-sync](https://github.com/tawanorg/claude-sync)、[Chronicle](https://github.com/geekmuse/chronicle)。

[MIT License](LICENSE)
