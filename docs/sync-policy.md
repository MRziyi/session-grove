# Sync triggers and measured overhead

Implemented in 0.6.0. Local capture and cloud traffic are separate.

| Event | Upload | Check directory / fetch |
| --- | --- | --- |
| New native chat / Update | No; extend local Pending | No |
| File into a Project / move trees | Changed trees, debounced 2 seconds | Read relevant remote versions before publishing |
| Combine, Dissolve, Rename, Grove Fork | Changed trees, debounced | Same pre-publication check |
| Archive / Restore | Changed filed trees | Same pre-publication check |
| Change a path's compaction choice | Saved context policy, debounced | Same pre-publication check |
| Activate / Deactivate / Apply context | Device-local availability only | No unrelated publication |
| App start / unlock | Retry previously queued organization | Initial directory check |
| Explicit project/tree open | No | Check if last directory check is older than 2 minutes; fetch only missing index/body versions |
| Window regains focus | No | Check only if older than 5 minutes |
| Local UI polling | No | No directory checks; reuse cached content |
| Sync button | All dirty filed trees, including Pending | Explicit check, even with no local changes |
| Idle fallback | Only previously queued organization | Every 30 minutes, if directory is stale |

A paused/unconfigured vault makes no network calls. The fallback does not upload raw-only Pending. Repeated clicks and background refreshes do not bypass cache freshness. Publishing reads the necessary remote versions to detect conflicts; manual Sync does not redundantly re-read the same directory before publication.

The Sync button shows the most recent successful cloud action time. Its tooltip distinguishes last upload from last directory check. A failed attempt does not advance a success timestamp.

## Limits and retry behavior

The provider can impose traffic, authentication or service limits. A 15-second schedule alone does not prove that an IP will be blocked, and there is no universal safe request rate. The implementation therefore reduces unnecessary work rather than promising immunity from provider restrictions.

HTTP 429/503 responses honor `Retry-After`, with at least a one-minute pause. Other automatic failures use exponential backoff up to 30 minutes. Automatic retries never run on every page refresh. Manual Sync can retry an ordinary network failure but cannot bypass a provider-requested pause. Transfers are bounded to four concurrent requests, with in-flight work drained before a failure is reported.

[InfiniCLOUD's speed documentation](https://infini-cloud.net/en/support_guide_general_speed.html) describes per-IP, best-effort bandwidth; it does not specify a fixed WebDAV request-count ban threshold. Directory check frequency is not the same as HTTP request count: a check can require PROPFIND and conditional GETs for several device heads.

## Measurements

The former fallback scheduled 240 directory checks per hour. The new fallback schedules at most 2 per hour before accounting for cache freshness, plus intentional user actions. That is a 120× reduction in scheduled idle checks, not a guarantee about total traffic during editing/upload.

In a live Teracloud check confined to a new disposable test folder:

- 30 repeated cached project/tree/check cycles: **0 remote requests**, about **8.9 ms wall time / 9.4 ms CPU time**.
- The full multi-device integration run, including initialization, upload, lazy reads, compaction-policy synchronization, native sample materialization, archive, restore and cleanup: about **25.5 s wall time / 811 ms process CPU**, 142 HTTP requests, 23 KB sent / 51 KB received in measured protocol payloads.
- All temporary remote test data was deleted. No personal transcript was used.

These are measurements of that synthetic workflow against one live provider. CPU time, wakeups and traffic are useful overhead indicators; they are **not a watt-hour measurement**. TLS/header overhead is not included in payload byte counters. Latency and file sizes affect real workloads.

The main remaining costs are first-time encryption/transfer, parsing changed large histories, and rendering a very large open path. Changes in 0.6.0 skip agent-owned records before parsing, reuse immutable caches, avoid redundant catalog reads and coalesce Sankey redraws into one animation frame. Graph movement does not send network requests. Diagnostics expose CPU, request, byte and timing counters for actual testing.
