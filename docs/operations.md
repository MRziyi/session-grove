# Operations

Installation and first use are covered in the [README](../README.md); in-app **ⓘ Information** explains controls. This page covers running and diagnosing the local service.

## Service and paths

Run `npm start` from the application checkout to start the background service. `npm run status` checks the matching library's service; `npm stop` requests shutdown through its authenticated local endpoint. `npm run dev` stays in the foreground. Open `http://127.0.0.1:7421`; `localhost` page visits redirect there.

Defaults are `~/.session-grove` for the library, `~/.codex` for Codex and `~/.claude` for Claude. `--data-dir`, `--codex-home`, `--claude-home` and `--port` override them. Use matching arguments for service management; run `node bin/session-grove.js --help` for the current CLI options.

Settings → Local service provides login startup on macOS and Windows, off by default. macOS uses a user LaunchAgent; Windows uses a current-user Startup shortcut. Moving the checkout or changing Node's installation path requires refreshing the startup setting. Background output is under the library's `logs/server.log`.

## Configuration

Git repository settings are stored in `git-sync.json`. The Smart Organization key and switches are in `intelligence.json`, outside Git export. Unix key files use mode 0600; Windows writes use restricted ACLs. API responses expose whether a key exists, never its value.

Context settings edit the selected Codex profile's supported limits or Claude's user auto-compaction budget. Other settings are preserved and originals are backed up under `context-backups/`. These backups may contain credentials. Default removes the edited override; other profile, project, environment or launch settings can still take precedence. See [Context](context.md).

Activity-date settings affect display ordering, not synchronization clocks. The choices are conversation activity, manual edits (default) and automatic organization. Legacy records use available provenance where separate clocks were not recorded.

## Storage maintenance

Existing libraries with legacy large values show an actionable storage status in the top banner. Selecting it opens Settings at the Storage card and highlights that card twice. New writes already use compact storage; heavy migration never starts automatically at login. Settings → Storage reports local library, Git cache, maintenance backups, temporary cache, Trash and other file sizes. Scans run asynchronously only when requested, rather than during status polling. Sizes cover local file contents, not remote repository allocation.

Settings → Storage → **Optimize storage** performs lossless library packing in a worker, reports phases in the task panel, and reclaims free SQLite pages. Browsing remains available; writes and transfers wait until maintenance finishes. Node.js 24 or later is required to read the packed library. A verified temporary database backup is retained on failure and removed after successful integrity checks. Repeating optimization does not create another full backup or repack unchanged data.

**Review cleanup** previews obsolete transfer-cache files and recognized older maintenance backups. With more than two recognized points, cleanup keeps the newest existing backup and creates a fresh SQLite recovery point whose integrity and compressed-byte checksum are verified before removal. Unknown folders, linked files and active WAL backups remain untouched. The preview is tied to file identities and timestamps; changed candidates require another review. Conversations, native client files, Trash, Git cache/history and context/configuration backups are outside this cleanup. Large operations report worker progress in the task panel.

Older independent SQLite files under `recovery-snapshots/` become verified standard `.sqlite.gz` archives; the newest eligible copy stays uncompressed. All recovery points are retained. Linked files, active WAL databases and unknown existing archives are skipped. Sources, archives and WAL state are checked again before removing originals; a changed copy keeps every original. To use an archived SQLite recovery point, decompress it into a separate directory first; never overwrite a running library. Context/configuration backups, native client files and existing Git history are not compacted by this operation.

## Troubleshooting

- If sessions do not appear, use Update and check the configured native roots. Reading saved histories does not require an API key or Git configuration.
- A missing-prefix error can indicate an unavailable earlier rollout segment. Codex compressed `.jsonl.zst` segments are read directly, using original decompressed byte offsets; do not manually rewrite history to bypass checks.
- Repository verification uses local Git/SSH access. Check the repository address, SSH agent, host verification and account access when verification fails.
- Failed operations remain visible and can be retried. Discard needs a verified local organization baseline, not a network fetch. See [Git sync](git-sync.md).
- New continuation creation can work while clients run. Existing-file writes/removal retain process/file-use, unchanged-content and recovery protections.

Diagnostic exports contain operation information intended for troubleshooting. Review exports before sharing them; do not publish an entire library, native logs, configuration backups or credentials. Reproduction and platform checks are in [Testing](testing.md).
