# Architecture

Grove is a local Node.js 24+ service with a DOM/SVG browser interface. Node provides SQLite, HTTP, filesystem and Zstandard support. Native Git over SSH is the only synchronization transport. The pinned Claude Agent SDK provides Claude session projection and fork support; there is no frontend build step.

## Components

| Area | Main implementation |
| --- | --- |
| HTTP, authentication and operation scheduling | `src/server.js` |
| Background service and login startup | `src/service.js`, `src/autostart.js` |
| SQLite records, immutable revisions and bounded caches | `src/store.js` |
| Native discovery, materialization and client adapters | `src/native.js`, `src/codex-history.js`, `src/claude.js` |
| Trees, naming ownership and organization checkpoints | `src/workspace.js`, `src/organization.js`, `src/organization-undo.js` |
| Shared local/sync projections | `src/cloud-view.js`, `src/project-view.js` |
| Git snapshots, subprocesses and transfer scheduling | `src/git-cloud.js`, `src/git-remote.js`, `src/auto-sync.js` |
| Organization-only rollback | `src/discard-changes.js` |
| Recovery copies and native deletion protection | `src/trash.js`, `src/trash-actions.js`, `src/trash-native.js` |
| Model naming and native title synchronization | `src/intelligence.js`, `src/transcription-titles.js` |
| Browser layout and interaction | `web/app.js`, `web/library-view.js`, `web/session-drag.js` |

## Storage and identity

The local library uses `grove.sqlite` for records, revision references, durable project identities, local instances and caches. Original transcript fragments are addressed by content hash. A logical Session groups related paths; each native path and each named conversation node has its own identity. Display names are not identifiers.

SQLite, native activation choices, credentials, context-configuration backups and recovery copies stay on the device. The Git data repository contains readable history, graph metadata and deletion identities, as described in [Git sync](git-sync.md). It is separate from the application's source checkout.

## Invariants

- Renaming and regrouping do not rewrite conversation records. Activation creates an independently identified continuation from a validated boundary.
- A missing native file does not erase saved library history. Project navigation and lists use the same backend visibility projection.
- Trash retains shared ancestry needed by surviving paths and saves recovery data before native removal. Message/context identities remain stable across recovery, including opaque compactions and legacy annotations.
- Discard changes Grove organization only. It preserves messages, new paths, native files, client titles and activation state.
- Concurrent local edits remain pending after an upload snapshot. Conflicts and stale destructive selections require a fresh decision.
- Status and progress reflect actual operations. Ordinary screens contain controls and state, rather than permanent explanatory notes.

## Resources

Parsing and record caches are bounded; immutable summaries and graph inputs are reused while valid. Reconstructable Git cache writes avoid a forced disk flush per file. Authoritative library writes and credential writes retain durability. Windows credential staging restricts an empty file's ACL before writing secrets, and permission checks read the current ACL.

Use the measurements and validation procedures in [Testing](testing.md). Old WebDAV credentials or cache files on disk are not read to reactivate a retired provider.
