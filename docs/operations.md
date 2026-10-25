# Running and diagnosing Session Grove

## 1.0 on Windows and macOS

Use Node.js 24+ and Git. Run `pnpm install`, then `pnpm start`; open `http://127.0.0.1:7421` and click Update for local discovery. `pnpm run demo` uses isolated samples. Windows uses the same commands in PowerShell. `--codex-home`, `--claude-home` and `--data-dir` override the default native/library directories.

Settings connects a private Git SSH repository and optionally configures Smart Organization. The local files are `git-sync.json` and `intelligence.json`. Saved API keys are never returned to the browser or included in sync. Windows key files have restricted ACLs; Unix key files use mode 0600.

Project contents in Settings controls dates and ordering: recent conversation, include manual edits (default), or include automatic organization. These are display choices, not changes to the timestamps used for synchronization. Older records without separate manual/automatic clocks use the available naming provenance; exact historical intent cannot always be reconstructed.

Project category arrows collapse or expand their contents. Double-clicking a category name edits it. Collapsed categories remain drag destinations and keep their collapsed state after a drop.

Context windows in Settings edits the active Codex profile’s context/compaction values or the Claude user auto-compaction budget. Other settings are preserved. Existing configuration is backed up under `context-backups/` before a change. Treat these backups as private: a native configuration can contain credentials. Select Default to remove the edited override and inherit the remaining client defaults. Changes save automatically. Open a new client session to apply changes; project/launch/environment overrides may take precedence.

Creating an additional continuation works while agents are running. Operations that edit or remove an existing native copy retain process/file protections. Windows uses native process enumeration and exclusive-file checks. See the [1.0 validation report](1.0-windows-validation.md) for exercised client versions and remaining fidelity/performance boundaries.

## Transfers and troubleshooting

Use Pull to import and Push to publish. Automatic Push is opt-in. Failed operations retain their status and can be retried; local browsing stays available. Export diagnostics for a bug report rather than sharing a library or configuration file.

Run `node scripts/ci-test.js` and `node scripts/ci-test.js --browser` for validation. Git fixtures and browser profiles are disposable and contain synthetic histories. See [Git sync](git-sync.md) for storage, conflict and deletion semantics.
