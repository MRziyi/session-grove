# Running and diagnosing Session Grove

## Local service

Node.js 24+ is required. `pnpm start` and `npm start` run the same local server. Demo mode (`pnpm run demo`) uses isolated sample data. The default URL is `http://127.0.0.1:7421`; the service binds only to loopback.

```sh
pnpm start --port 7421 --data-dir /path/to/library \
  --codex-home /path/to/.codex --claude-home /path/to/.claude
# npm uses an extra -- before script arguments
npm start -- --port 7421 --data-dir /path/to/library
```

Defaults: library `~/.session-grove`, native roots `$CODEX_HOME` / `~/.codex` and `$CLAUDE_CONFIG_DIR` / `~/.claude`. Only one server may open a given library. Starting the real service discovers local transcripts without changing native activation. Configure WebDAV yourself in Settings; startup does not unlock it or upload ungrouped history.

## Files and recovery

| Location under the library | Purpose |
| --- | --- |
| `grove.sqlite` | Original transcript fragments, revisions, membership and organization |
| `webdav.json` | Local WebDAV URL and credentials, user-only permissions |
| `logs/operations.jsonl` | Redacted operations, failures and timings |
| `operations/` | Native write journals and backups |
| `parked/` | Deactivated native transcript copies |
| `recovery-snapshots/` | Files preserved before manual recovery |
| `server.lock` | Current service PID |

The operation log rotates at approximately 1 MiB and retains three older files. It does not record request bodies, transcript text, credentials, remote URLs or native working directories. Settings → Diagnostics downloads the latest 200 events, recent route timing metrics and memory usage. Error responses include an eight-character reference that can be matched to a log event. Raw transcripts and operation backups remain private library data and are **not** included in diagnostic downloads.

For a bug report, include the version, the action and selection, expected/actual behavior, the error reference and the diagnostic export. Do not attach the whole library or `webdav.json`.

Interrupted native writes can be recovered from Settings when a recovery journal exists. Recovery preserves the current files first. Backups are not automatically pruned.

## Compatibility

- Codex legacy JSONL and `state_5.sqlite` are supported. Known paginated histories are rebuilt into fresh local conversation logs on activation; old machine-specific world/turn settings are not replayed. Unknown required schema fields and history records fail closed.
- Codex 0.155.0-alpha.16.3 has been tested with real App Server list/read/resume/deactivate/reactivate calls, without sending model turns.
- Claude project JSONL, encoded paths and legacy indexes are covered by file-adapter tests; a real Claude client still needs validation.
- Native activation writes require the agent processes to be closed. Opening and organizing Grove history does not.
- External attachments, subagent companion directories and unsupported native history modes may prevent full activation. Source details show known compatibility warnings.
- Projects/code, authentication and installed plugins are not migrated. The destination working folder must already exist.
- Unknown/encrypted compaction payloads are preserved; Grove does not pretend to decode them.

## Activation budget checks

Checks read allowlisted model/budget fields without executing configuration commands. Codex reads root `config.toml`, a selected profile, local cached model metadata, then available native context-window records. CLI-only overrides or unobserved project trust/profile choices may differ; these are planning warnings, not an authoritative model query. Claude reads its user/project/local settings and relevant inherited compaction-budget environment variables. Its auto-compaction budget is not mislabeled as a hard context window.

A warning appears around 80% of a known window, or at an explicit lower compaction budget. The user can review it and choose Activate anyway. If the context/configuration changes before activation, a stale acknowledgement is rejected. Unknown limits are not inferred from model names. Encrypted compacted context without a later usage sample is marked incomplete rather than treated as a precise count.

Sources: [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [Claude environment variables](https://code.claude.com/docs/en/env-vars).

## Performance checks

Run `node scripts/benchmark.js` for an isolated synthetic workload: 40 native sessions, 20 turns / 40 chats each. It measures repeated unchanged scans, state projection and tree construction; it is not a network/provider benchmark.

Observed locally before/after 0.5.0 changes:

| Measure | Before | After |
| --- | ---: | ---: |
| Unchanged native scan | ~44 ms | ~0.5 ms |
| Warm state projection | ~43 ms | cached (<0.01 ms, excluding JSON serialization) |
| Warm tree projection | ~23 ms | ~0.04 ms |
| State response payload | ~1.41 MB | ~75 KB |

Changes: omit native baseline bodies from public state, reuse prepared object reads, cache immutable parsing within a bounded budget, cache derived views by store version, reference immutable revisions instead of duplicating adopted transcript baselines, skip unchanged native file parsing and avoid repeated prefix inference without new captures. Native write verification still reads/hashes the actual files. Transaction rollback invalidates derived caches. First-load behavior and larger/more branched datasets can differ; diagnostic timings capture actual usage.

## Checks

```sh
pnpm test
pnpm run test:codex   # isolated home, no authentication copied, no model request
node scripts/benchmark.js
```

Browser acceptance requires a fresh demo library and an isolated Chrome debugging profile:

```sh
pnpm run demo --data-dir .grove/browser-test --port 7425
node scripts/browser-smoke.js http://127.0.0.1:7425 http://127.0.0.1:9231
```

Screenshots and local compatibility reports go into ignored `test-results/`. Never commit personal sessions or libraries.


## Private unattended unlock and live-provider verification

An operator can opt into startup unlock with an existing owner-only key file:

```sh
node bin/session-grove.js --sync-key-file /absolute/private/path/sync-key.txt
```

The file must not be readable by group/other users. The default app behavior still keeps a manually entered passphrase only in memory. Keep a secure copy of the key for other devices; it is needed to decrypt the cloud vault. Do not add the file to Git or diagnostics. A remembered WebDAV password and the vault encryption key are separate credentials.

The setup can use an additional dedicated directory below the provider's DAV root. Grove creates `session-grove-v1/` below that configured directory and does not enumerate or modify unrelated folders.

`node scripts/provider-check.js /absolute/private/path/webdav.json` reads the credentials and adjacent `sync-key.txt` privately. It creates a unique `self-check-*` directory below the configured application folder, uses synthetic Codex/Claude samples for upload, lazy retrieval, organization, isolated native materialization, Pending publication, archive and restore, then deletes only that newly created test directory. The private report is written next to the config. A failed cleanup is reported with the exact test-folder name; no parent folder is removed.

The 0.5.0 live Teracloud check passed all these stages. No personal transcripts were uploaded as test fixtures. Raw-object transfers use up to four concurrent requests and drain in-flight requests before reporting a failure.

Native discovery prefers the Codex database's current rollout path and title: duplicate historical files with the same native identity do not become extra active instances. User-facing `name` takes precedence over internal preview `title`; source metadata excludes subagents/guardians and zero-chat records. Previously imported helpers are hidden and excluded from native operations without deleting source data. Native archive flags are read even when a file is not in an archive-named folder.


0.6.0 adds per-path compaction policy, live-provider request/CPU measurements, a thirty-minute fallback and throttling backoff. See [sync-policy.md](sync-policy.md). Diagnostics report successful body-transfer byte counts and HTTP request counts without remote URLs or credentials.
