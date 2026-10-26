# Session Grove

[English](README.md) · **简体中文**

**留住上下文，探索不同方向，随时回到有价值的工作。**

Session Grove 是面向 **Claude Code 和 Codex** 的本地会话管理工具，支持 **Windows 和 macOS**。把分散的 AI 对话收进项目，用树状图看清共同历史与不同分支，再从有价值的位置继续。

适合已经超出平面聊天列表所能承载的研究、写作和软件项目。

![对话与分支图并排显示](docs/images/workspace.png)

## 看清对话之间的关系

一个项目往往包含许多对话：最初的想法、不同方案、初稿和多轮修改。Grove 把它们放在一起，让你找回思路背后的上下文，不必从一串相似的聊天标题中逐个翻找。

- **按项目整理。** 在同一个资料库里管理 Claude 和 Codex 会话，搜索内容，自由编辑标题。
- **沿着对话树探索。** 看清哪些路径拥有共同历史、从哪里开始分叉，点击节点即可阅读对应对话。
- **给工作片段命名。** 把长对话整理成“研究问题”“比较方案”“第一个原型”等容易找回的章节。

![包含 Claude 与 Codex 会话的项目资料库](docs/images/library.png)

## 从需要的上下文继续

从早先某个位置分叉，尝试不同方向，同时保留原有对话。**Activate** 会把选定的上下文带回 Agent，让你接着工作。

你也可以通过 **Activate as** 换一个工具继续，并选择续接时要保留多少历史上下文。

![选择续接位置并预览上下文](docs/images/activation.png)

Grove 管理对话历史；聊天和文件工作仍在 Claude Code 或 Codex 中进行。

## 少一些整理负担

可选的 **Smart Organization** 帮助你为会话和分叉节点命名，并把新会话归入项目。你也可以手动改名；受支持的 Codex 客户端还可以与 Grove 同步对话路径的标题。

在 Settings 中填入自己的 OpenAI API key，即可开启智能整理。命名时会将选取的对话文本发送给 OpenAI；浏览资料库和手动整理不需要 API key。

## 在不同电脑上继续工作

连接自己的**私有 Git 仓库**，即可在设备间同步对话资料库。Pull 和 Push 默认手动操作，也可开启自动上传。每台电脑独立选择要激活的会话。

未开启同步时，资料库保存在本机。同步仓库保存可读的对话历史，请保持私有；项目文件和应用凭据不参与同步。移入 Trash 的会话有一段本地恢复期。

## 开始使用

安装 **Node.js 24+** 和 **Git**，然后运行：

```sh
git clone https://github.com/MRziyi/session-grove.git
cd session-grove
npm install
npm start
```

打开 **http://127.0.0.1:7421**，点击 **Update** 查找本机 Claude Code 和 Codex 会话，再打开一条会话查看原文与分支图。Git 同步和智能整理都可以之后按需开启。

Grove 在后台运行，可以关闭终端。使用 `npm stop` 停止服务，`npm run status` 查看状态。Settings 中提供**登录后自动启动**开关，默认关闭。

想先体验界面？用 `npm stop` 停止服务，再运行 `npm run demo`。Demo 使用示例会话，不读取个人历史。按 Ctrl+C 停止 Demo 后，运行 `npm start` 即可回到自己的资料库。

界面支持中英文切换。遇到控件或操作流程方面的问题，可点击左下角的 **ⓘ Information** 查看使用指南。

## 反馈

[报告问题或提出建议](https://github.com/MRziyi/session-grove/issues) · [版本更新](https://github.com/MRziyi/session-grove/releases)

请勿在公开反馈中包含私密对话或凭据。

作者：[Ziyi Zhang](https://ziyi-zhang.vercel.app)。设计参考：[codex-session-sync](https://github.com/shonngithub/codex-session-sync)、[claude-sync](https://github.com/tawanorg/claude-sync)、[Chronicle](https://github.com/geekmuse/chronicle)。[MIT License](LICENSE)。
