# Session Grove

**English** | [简体中文](README.zh-CN.md)

**A project-centered workspace for branching and managing agent sessions.**

Organize Codex and Claude Code sessions into projects, name meaningful pieces of work, manage branches and archives, and choose an explicit Active set. Continue the actual conversation in your agent's CLI or IDE, then bring its updates back into Grove. WebDAV adds optional cross-device storage.

**Version 0.2.0 — experimental.** Core and adapter tests pass. Codex native read/resume has been verified against the version listed below; real Claude Code client verification is still outstanding.

## Quick start

Requires **Node.js 24+**. Use **pnpm or npm** to run the same `package.json` scripts. Node is the runtime; the package manager is your command entry point. There are no third-party runtime or development dependencies and no build step, so you do not need to run `install` first.

```sh
git clone https://github.com/MRziyi/session-grove.git
cd session-grove
```

### With pnpm

```sh
# Isolated sample workspace; does not read your personal sessions
pnpm run demo

# Manage your local sessions
pnpm start

# Run the automated tests
pnpm test
```

### With npm

```sh
npm run demo
npm start
npm test
```

These commands run from the cloned repository. The project is not currently published to the npm registry.

Open the URL printed in the terminal, normally **http://127.0.0.1:7421**. Demo and personal libraries are separate. Only one server may open a given library at a time.

<details>
<summary>简体中文快速开始</summary>

需要 Node.js 24 或更高版本。在仓库目录执行：

```sh
pnpm run demo  # 隔离演示
pnpm start    # 管理本机会话
pnpm test     # 自动测试
```

npm 用户可对应使用 `npm run demo`、`npm start`、`npm test`。当前无第三方依赖，无需先安装依赖。界面默认英文，可在左下角切换中文。

[阅读完整中文文档 →](README.zh-CN.md)

</details>

### Custom data locations

```sh
# pnpm forwards arguments after the script name
pnpm start --data-dir /path/to/grove \
  --codex-home /path/to/.codex --claude-home /path/to/.claude

# npm uses -- to forward arguments to the script
npm start -- --data-dir /path/to/grove \
  --codex-home /path/to/.codex --claude-home /path/to/.claude
```

The personal library defaults to `~/.session-grove`. If you only have Node installed, `node bin/session-grove.js --demo` remains a supported entry point.

The repository uses `pnpm-lock.yaml` as its primary dependency lockfile. It currently contains no external packages. npm users can run the scripts unchanged; there is no need to generate a second lockfile just to start or test the app.

## How it works

The interface defaults to **English**. Switch to **中文** in the lower-left corner; the choice is remembered.

1. **Local Active comes first.** Grove discovers native sessions while preserving their current Active state. Unfiled work stays on this device.
2. **Related native forks become a tree.** Unfiled sessions from the same agent and working directory can be grouped by an exact, completed history prefix. Normally at least two complete turns are required; matching titles or a short greeting are insufficient. Existing user-named logical nodes are not automatically reorganized.
3. **Projects open as grouped collections.** Move a single session or an entire tree into a project and choose a group. Standalone sessions open a logical-node timeline; items that have actually forked open a branch graph.
4. **New conversation accumulates in Pending.** Background collection or Refresh extends one Pending tail. It does not turn each message into a graph node.
5. **Commit meaningful ranges.** For example, commit the first 10 of 20 new messages as “Finished the introduction.” The remaining 10 stay in Pending and can become another named node. Ranges end at complete turns, keeping tool calls and results together.
6. **Activate explicitly.** Choose an existing working directory, then review and apply the Active set. Close running agents and their IDE extensions before applying; reopen the client afterwards. Activate uses the session's latest context, including Pending. To continue from an earlier node, fork from that checkpoint first.
7. **Archive and restore in Grove.** History is retained. Archiving queues removal from this device's Active set; restoring does not automatically activate the session.

CLI and IDE interfaces that use the same native data directory share one activation instance. Device and interface information is provenance, not the project hierarchy. Observing a native session does not hide it; only an explicit Active-set change does.

Local changes are checked every 10 seconds, and the browser polls for updates. A single thread can contain multiple named work nodes without becoming a branch-tree item. Double-click a project title to edit it, or use an item's **Move / group** action to file its entire tree.

## Encrypted WebDAV sync

In **Sync & settings**, enter your WebDAV root URL, username and password, then unlock automatic sync. Use a separate encryption passphrase of at least 12 characters, shared across your devices.

- AES-256-GCM authenticated encryption, with scrypt key derivation and compression before encryption.
- The encryption passphrase stays in process memory only. WebDAV connection credentials are stored locally in `webdav.json` with user-only permissions.
- Content-addressed immutable fragments deduplicate shared history. Dependencies upload before an encrypted revision manifest is published.
- Filing, organizing and updating project work queues automatic synchronization while unlocked. Remote updates are checked every 15 seconds.
- Without configuration, while locked, or offline, changes remain local and are shown as queued or retrying. Local storage is not reported as a successful upload.
- Unfiled sessions, native authentication, native databases and device-specific Active selections do not upload. Pulling never automatically activates a session.
- Divergent conversations are retained as separate branches. Concurrent metadata edits or alternative logical-node organizations remain explicit choices.
- Restarting the service requires unlocking sync again. Remote history objects are not automatically deleted.

Use HTTPS; HTTP is permitted only for local testing. Grove creates `session-grove-v1/` below the configured WebDAV URL and leaves other directories alone.

## Compatibility and current limits

| Capability | Status |
| --- | --- |
| Projects, logical nodes, Pending, branching, deduplication, archives and provenance | Implemented and tested |
| Codex legacy JSONL and `state_5.sqlite` | Implemented; unknown required fields block write-back |
| Codex 0.155.0-alpha.16.3 | Real App Server list/read/resume/deactivate/reactivate verified; no model turn submitted |
| Codex VS Code panel refresh | Uses native storage; panel-level automation is not verified; reopen/reload may be required |
| Claude project JSONL, path encoding and history indexes | File-level round-trip tests pass; real client verification is outstanding |
| Native writes | Cold writes; applying is blocked while a Codex or Claude process is running |
| WebDAV providers | Local protocol-server tests pass; Nextcloud, Synology and other providers are not individually verified |

Project files, authentication, installed plugins and background processes are not migrated. Recognized external attachment references, non-legacy Codex history and long Claude project paths block activation. Embedded transcript content is preserved; subagent companion directories and other external resources are not yet packaged.

Path mapping changes known structured fields. Historical message text and tool output remain unchanged, so old paths may still appear in the conversation. The target project files must already exist; explain a changed working directory in the native conversation when needed.

Cross-agent context conversion, Remote SSH/containers and opening a specific IDE tab are not implemented. Empty sessions can be materialized, but some native clients may list them only after the first message.

## Data and recovery

```text
~/.session-grove/
  device.json            Local device identity
  grove.sqlite           Projects, branches, logical nodes and deduplicated history
  webdav.json            Local connection credentials
  operations/            Native-operation journals and pre-write backups
  parked/                Deactivated native transcripts
  recovery-snapshots/    Current files preserved before manual crash recovery
```

The library retains raw JSONL lines, including unknown fields. Display models are not the only recovery source. Update collection compares against the exact materialized baseline so Grove does not import its own exports as new work.

Native-write failures attempt rollback. After an interrupted operation, the Active-set dialog offers recovery from its operation backup. Recovery first saves current files separately to preserve work written after the interruption. Backups are not automatically pruned yet.

The server binds to loopback and checks Host, Origin, Fetch Metadata and a local API token. The UI loads no third-party scripts and sends no telemetry. Keep `.grove/`, personal libraries and real transcript samples out of the source repository.

## Technology

The current implementation uses **Node.js 24, JavaScript ES Modules, built-in SQLite, and browser DOM/SVG**. It has not been migrated to TypeScript.

The current recommendation is to retain Node for product and adapter iteration, then measure and optimize full-history scans, repeated parsing and blocking work. Go is worth considering for standalone executable distribution; Rust or native modules become more attractive if measured CPU or memory limits justify them. No project-specific comparison establishes one language as the fastest.

See [Technology choices](docs/technology.md) for the comparison, current implementation hotspots and proposed evaluation order.

## Verification

| Task | pnpm | npm |
| --- | --- | --- |
| Automated tests | `pnpm test` | `npm test` |
| Optional real Codex check | `pnpm run test:codex` | `npm run test:codex` |
| Browser acceptance | `pnpm run test:browser` | `npm run test:browser` |

The Codex check uses an isolated temporary home, copies no personal authentication and submits no model turn. It requires an installed Codex executable.

Browser acceptance requires a separate Chrome profile with `--remote-debugging-port=9228` and a **fresh demo library**, for example `pnpm run demo --data-dir .grove/browser-test`. The default URL is port 7421. Override it with `pnpm run test:browser http://127.0.0.1:7422` or `npm run test:browser -- http://127.0.0.1:7422`.

The browser check covers language persistence, Active-first navigation, 20→10+10 Pending commits and moving a tree into a project group. Screenshots and compatibility reports go into the ignored `test-results/` directory. Use a new demo-library directory for each complete acceptance run.

CI runs `npm test` on macOS and Linux with Node 24. No dependency installation is needed for the current codebase.

## Project structure

```text
bin/                    Local server CLI
src/store.js            Projects, revisions, raw fragments and merge
src/organization.js     Logical nodes, Pending, collections and prefix inference
src/auto-sync.js        Automatic sync, unlock, retry and status
src/transcript.js       Native event parsing, checkpoints and materialization
src/native.js           Discovery, collection, Active changes and recovery
src/sync.js             Encrypted WebDAV object and revision transfer
src/server.js           Same-origin local HTTP API
web/                    Project collections and session management UI
test/                   Isolated tests
scripts/                Browser and native Codex compatibility checks
docs/                   Design, implementation and technology decisions
```

## References and license

Design references: [codex-session-sync](https://github.com/shonngithub/codex-session-sync), [claude-sync](https://github.com/tawanorg/claude-sync) and [Chronicle](https://github.com/geekmuse/chronicle). Their native-store coordination, path mapping and partial-materialization approaches informed this project. Session Grove maintains its own project graph, logical nodes and explicit Active set.

Native behavior references: [Codex App Server](https://learn.chatgpt.com/docs/app-server) and [Claude Code sessions](https://code.claude.com/docs/en/sessions).

[MIT License](LICENSE)
