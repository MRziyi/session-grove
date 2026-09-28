# Session Grove

**English** | [简体中文](README.zh-CN.md)

**A project-centered workspace for branching and managing agent sessions.**

Organize Codex and Claude Code sessions into projects, name meaningful pieces of work, manage branches and archives, and choose an explicit Active set. Continue the actual conversation in your agent's CLI or IDE, then bring its updates back into Grove. WebDAV adds optional cross-device storage.

**Version 0.4.0 — experimental.** Core and adapter tests pass. Codex native read/resume has been verified against the version listed below; real Claude Code client verification is still outstanding.

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

npm 用户可对应使用 `npm run demo`、`npm start`、`npm test`。当前无第三方依赖，无需先安装依赖。界面默认英文，可在右上角切换中文。

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

The interface defaults to **English**. Switch to **中文** in the top banner; the choice is remembered.

1. **Start in Codex or Claude Code.** Click **Update** to collect new conversations. Current Active separates the two agents and counts actual local native sessions.
2. **File entire trees into Projects.** Unfiled sessions appear under **Ungrouped**. Select them and choose **Move to project**, including inline project creation. Native forks with a matching completed prefix fold into one row. A tree counts once in the Projects navigation.
3. **Search titles and full content.** Lists are grouped by Project or Ungrouped, ordered by each group's latest conversation change, then by each row's latest change.
4. **Read the Transcript alongside its Graph.** The detail page keeps compact navigation and the session list on the left. Choose a graph branch to see its full conversation. Automatically assigned colors and ribbons connect chats to their logical Nodes; unorganized chats use a warm **Pending** palette, distinct from the cool colors of named Nodes.
5. **Combine and Dissolve selected chats.** Name consecutive chats as a Node, or return any selected chats to Pending. Partial edits leave the rest of existing Nodes intact. Shared-prefix edits affect all inheriting branches. Combine cannot cross a fork point. These edits never rewrite native history.
6. **Activate at a path endpoint.** Choose an existing local working directory; continue actual chat in your native client. **Deactivate** retains project history while removing that local native session. Close running agents and their IDE extensions before these cold writes, then reopen the client. A blocked action leaves activation and Archive state unchanged.
7. **Archive and restore in Grove.** Archive a session tree or an entire Project to retain its history and deactivate its sessions on this device. Restoring filed work does not automatically activate it. Restoring Ungrouped work requires choosing a Project (or creating one), so it remains accessible without auto-activation.

Ordinary sessions originate in the native client; Grove creates new native sessions only through explicit **Fork** from a completed-turn checkpoint. Logical Node boundaries can fall between individual chats, independently of native turn boundaries. Tool events and raw records remain preserved.

CLI and IDE interfaces using the same native data directory share one activation instance. Device and interface information is provenance, not the project hierarchy. Background collection checks for local changes every 10 seconds. Filing and organization do not change the displayed conversation modification time.

Nodes show approximate recorded-text tokens, including recognized tool text. The **Context** panel separates these estimates from recorded native input usage and compaction events. Readable compact summaries are displayed when saved; encrypted payloads remain explicitly opaque.

See [Context and sync](docs/context-and-sync.md) for token limits, automatic upload triggers and lazy cloud loading. See [Interaction model](docs/interaction-model.md) for the two-page layout, terminology and action rules.

## Encrypted WebDAV sync

In **Sync & settings**, enter your WebDAV root URL, username and password, then unlock automatic sync. Use a separate encryption passphrase of at least 12 characters, shared across your devices.

- AES-256-GCM authenticated encryption, with scrypt key derivation and compression before encryption.
- The encryption passphrase stays in process memory only. WebDAV connection credentials are stored locally in `webdav.json` with user-only permissions.
- Content-addressed immutable fragments deduplicate shared history. Dependencies upload before an encrypted revision manifest is published.
- Filing, organizing Nodes, forking, archiving and restoring queue affected trees for upload after a two-second debounce. Native chat growth only updates local Pending; it does not auto-upload.
- Manual **Upload** includes unfinished Pending; it is disabled when nothing has changed. Hover for the last successful upload time. **Sync** checks the directory without pushing Pending.
- Cloud directories are checked every 15 seconds while unlocked. Project indexes load on opening a project; missing or newer tree bodies load on opening that tree. Cloud-only, cached, updated and unsent states have a small cloud marker.
- Full-text search of a cloud project may fetch its transcripts on demand. Ordinary list navigation does not. Cached content remains readable offline.
- Without configuration, while locked, or offline, changes remain local and are shown as queued or retrying. Local storage is not reported as a successful upload.
- Unfiled sessions, native authentication, native databases and device-specific Active selections do not upload. Pulling never automatically activates a session.
- Divergent conversations are retained as separate branches. Concurrent metadata edits or alternative logical-node organizations remain explicit choices.
- Restarting the service requires unlocking sync again. Remote history objects are not automatically deleted.

Use HTTPS; HTTP is permitted only for local testing. The indexed cloud directory uses schema 4 with schema 3 tree graphs. Use 0.4.0+ on all writing devices; older vaults can be indexed without downloading all transcript bodies. Mixed-version writing after migration is not supported. Grove creates `session-grove-v1/` below the configured WebDAV URL and leaves other directories alone.

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

Cross-agent context conversion, Remote SSH/containers and opening a specific IDE tab are not implemented. Blank-session creation is intentionally absent from the UI and public API.

## Data and recovery

```text
~/.session-grove/
  device.json            Local device identity
  grove.sqlite           Projects, branches, versioned Node layouts and raw history
  webdav.json            Local connection credentials
  operations/            Native-operation journals and pre-write backups
  parked/                Deactivated native transcripts
  recovery-snapshots/    Current files preserved before manual crash recovery
```

The library retains raw JSONL lines, including unknown fields. Display models are not the only recovery source. Update collection compares against the exact materialized baseline so Grove does not import its own exports as new work.

Native-write failures attempt rollback. After an interrupted operation, Settings offers recovery from its operation backup. Recovery first saves current files separately to preserve work written after the interruption. Backups are not automatically pruned yet.

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

The browser check covers both pages, language persistence, native/project counts, full-text search, branch switching, shared-prefix edits, Combine/Dissolve, filing, activation, deactivation and Archive. Screenshots and compatibility reports go into the ignored `test-results/` directory. Use a new demo-library directory for each complete acceptance run.

CI runs `npm test` on macOS and Linux with Node 24. No dependency installation is needed for the current codebase.

## Project structure

```text
bin/                    Local server CLI
src/store.js            Projects, revisions, raw fragments and merge
src/organization.js     Legacy logical nodes and native prefix inference
src/workspace.js        Session lists, shared graph paths and editable Node layouts
src/auto-sync.js        Organization-triggered upload, directory checks and status
src/cloud.js            Encrypted lazy catalog, project indexes and tree hydration
src/context.js          Approximate token counts and recorded compaction details
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
