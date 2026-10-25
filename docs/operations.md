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

## Troubleshooting

- If sessions do not appear, use Update and check the configured native roots. Reading saved histories does not require an API key or Git configuration.
- A missing-prefix error can indicate an unavailable earlier rollout segment. Codex compressed `.jsonl.zst` segments are read directly, using original decompressed byte offsets; do not manually rewrite history to bypass checks.
- Repository verification uses local Git/SSH access. Check the repository address, SSH agent, host verification and account access when verification fails.
- Failed operations remain visible and can be retried. Discard needs a verified local organization baseline, not a network fetch. See [Git sync](git-sync.md).
- New continuation creation can work while clients run. Existing-file writes/removal retain process/file-use, unchanged-content and recovery protections.

Diagnostic exports contain operation information intended for troubleshooting. Review exports before sharing them; do not publish an entire library, native logs, configuration backups or credentials. Reproduction and platform checks are in [Testing](testing.md).
