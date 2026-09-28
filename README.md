# Session Grove

**English** | [简体中文](README.zh-CN.md)

**Your AI conversations have branches. Your chat list should not be the only way to find them.**

Session Grove is a project-based session manager for **Claude Code and Codex**. Keep chatting in your CLI or VS Code extension; use Grove to organize conversation history, preserve useful context, manage branches, and continue work on another Mac through WebDAV.

![A conversation and its context tree in Session Grove](docs/images/workspace.png)

## When your chat history becomes the problem

You build a useful context, branch to try another idea, then branch again to write the introduction, debug an implementation, or explore a different approach. Soon the native chat list contains several almost-identical conversations. You remember what you worked on, but not which session contains it.

Session Grove gives that work a structure:

- **One Project for one piece of work.** Keep a paper, repository or research topic together across sessions and devices. Shared-prefix conversations appear as one tree. Internal agent workers and empty sessions stay out of your list.
- **Name the work, not every message.** Turn a stretch of conversation into “Set up context”, “Draft the introduction” or “Test the alternative”. New conversation stays in Pending until you organize it.
- **See the branch and read its context together.** The Transcript and Graph stay side by side, with color bands connecting the actual chats to your logical Nodes.
- **Choose which context to continue with.** Use a recorded compaction result or restore the recorded history before it. The graph shows which earlier Nodes are superseded; choices apply when you activate or explicitly apply the context.
- **Keep only useful sessions active.** Activate the path you want in your agent. Archive a finished path without losing its shared prefix or cluttering the tree you are still using.
- **Pick up on another Mac.** Filed projects sync through your WebDAV storage. Open a project to get its list; open a tree to download its context when needed.

Grove manages the session library. **Codex and Claude Code remain where you actually talk to the agent.** It does not replace their editor integrations or send model requests on your behalf.

## A typical workflow

1. Start a conversation in Codex or Claude Code, then click **Update** in Grove.
2. Select ungrouped sessions and **Move** them into an existing or new Project.
3. Open a tree. Click a start chat and an end chat to select a continuous range, then **Combine** it under a useful title. **Dissolve** returns a range to Pending.
4. Select any graph Node to **Rename** it. Naming a Pending segment turns it into a saved Node. **Fork** appears when that Node ends at a complete agent turn.
5. Select a session's endpoint to **Activate**, **Deactivate**, or **Archive** that path. Archived paths disappear from the in-use graph and remain complete in Archived. Other branches stay visible.
6. Continue chatting in the agent. New chats extend Pending automatically. Organizing Nodes triggers cloud publication; **Sync** can also publish the Pending you have not organized yet.

Read conversations as Markdown. Expand recorded activity to inspect tool inputs/results, named files and readable reasoning alongside the conversation. Large graphs support background dragging, zoom and reset; Sankey bands connect only visible content.

Actions appear only when they apply to the current selection. **Settings** contains language, WebDAV and automatic-update intervals. **ⓘ Information**, at the bottom of the sidebar, contains the action guide and diagnostics. **About** links to the author and repository.

## Try it

Requires **Node.js 24+**. There are no dependencies to install and no build step.

```sh
git clone https://github.com/MRziyi/session-grove.git
cd session-grove
pnpm run demo
```

Open **http://127.0.0.1:7421**. The demo uses sample sessions and does not read personal history.

To manage your own sessions, stop the demo and run:

```sh
pnpm dev
```

npm works too: `npm run demo`, `npm run dev`, and `npm test`. The interface defaults to English; switch to Chinese in **Settings**.

## Your context, on your storage

WebDAV is optional. Enter your server address, account and password; Grove adds its own **/Session-Grove/** folder. Verify the connection, then optionally set a content-encryption passphrase. Saved secrets remain visibly masked. Changing the connection or encryption settings runs a verified migration with progress.

Filing work, naming Nodes and other organization changes upload automatically. Local sessions refresh every **1 minute** by default. A **15-minute** fallback uploads changed projects, including unfinished Pending. Every upload captures local updates first; an unchanged library makes no scheduled cloud request. Both intervals can be changed or disabled in Settings.

**Sync** sends outstanding project changes—including unfinished Pending—and checks the cloud directory. The hover text shows the last upload and directory-check times. Native Active choices stay local to each device. Cloud reads follow startup, focus and explicit navigation with freshness checks; ordinary page refreshes do not poll WebDAV.

The library retains original session records. Node edits organize those records rather than rewriting the conversation. Cloud content is encrypted when you enable encryption; a yellow status identifies unencrypted storage. Saved credentials and the optional passphrase live in owner-only local files so `pnpm dev` can reconnect. This is not macOS Keychain storage.

## Current scope

**0.7.0 · experimental · macOS first.** Same-agent branching and cross-device continuation are supported; Claude-to-Codex conversion is not.

**Context fidelity has limits.** Supported materialization preserves recorded tool calls/results, reasoning and instructions instead of rebuilding a conversation from visible prose. Unknown Codex paginated rewrites are blocked; an unchanged original paginated session can be restored byte-for-byte on the same machine/path. Dynamic client instructions, opaque compaction and external assets prevent a promise of identical model requests. See the [requirements and fidelity audit](docs/requirements-audit.md).

Native activation changes currently require closing running agent processes first. The UI explains this in Settings. Codex native read/resume has been exercised with a real executable; Claude file adapters are tested, but real Claude-client verification is still pending. WebDAV has passed isolated protocol tests and a live Teracloud round trip; other providers can differ.

Node token counts are estimates. Before activation, Grove checks recorded usage and available local context-window settings and warns when the context may be near its limit.

## Testing and feedback

If something fails, note what you selected, what you clicked, and the error reference shown in the UI. **ⓘ Information → Diagnostics → Download diagnostics** exports operation types, timings and error references without chat text or credentials.

```sh
pnpm test
```

[Setup, data locations and troubleshooting](docs/operations.md) · [Interaction rules](docs/interaction-model.md) · [Context and sync details](docs/context-and-sync.md) · [Sync triggers and measured overhead](docs/sync-policy.md) · [Technical choices](docs/technology.md)

<details>
<summary>中文简介</summary>

Session Grove 用项目和分支图管理 Claude Code 与 Codex 的会话。你仍在原生客户端对话，在 Grove 里整理上下文、为一段工作命名、分叉、激活或归档，并通过自己的 WebDAV 在不同 Mac 之间续接。

[阅读完整中文说明 →](README.zh-CN.md)

</details>

Design references: [codex-session-sync](https://github.com/shonngithub/codex-session-sync), [claude-sync](https://github.com/tawanorg/claude-sync), and [Chronicle](https://github.com/geekmuse/chronicle).

[MIT License](LICENSE)
