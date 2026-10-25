# Implementation map

The service runs on Node.js 24+, with native Git and a browser UI. Run `pnpm install` before starting it.

| Area | Implementation |
| --- | --- |
| Local HTTP API and lifecycle | `src/server.js`, `src/service.js` |
| SQLite records, revisions and caches | `src/store.js` |
| Native discovery and materialization | `src/native.js`, agent adapters |
| Graph and project projections | `src/workspace.js`, `src/project-view.js` |
| Shared sync snapshots and local views | `src/cloud-view.js` |
| Git transport and snapshots | `src/git-remote.js`, `src/git-cloud.js` |
| Transfer scheduling and settings | `src/auto-sync.js`, `src/git-settings.js` |
| Local recovery and deletion identities | `src/trash.js`, `src/trash-actions.js` |
| Smart Organization | `src/intelligence.js`, `src/transcription-titles.js` |

Use `node scripts/ci-test.js` for unit/integration checks and `node scripts/ci-test.js --browser` for isolated browser flows. Timing files contain public filenames and durations, not fixture contents. Git tests use disposable local repositories.

See [operations](operations.md), [Git sync](git-sync.md) and [sync policy](sync-policy.md).
