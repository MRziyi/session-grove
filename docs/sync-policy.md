# Sync policy

Current behavior: see [0.11 local copies and explicit Pull](0.11-local-copies.md). Startup, focus, navigation and search no longer trigger cloud reads. The versioned sections below describe historical behavior.

## First use and operation feedback (0.8.1)

A new library begins empty. Local discovery and its one-minute timer start after the first explicit Update. WebDAV verification/connection creates only configuration/protocol metadata, never publishes local history or reads cloud project indexes. The first explicit Sync enables cloud catalog reads, lazy hydration, operation-triggered uploads and the 15-minute fallback. Sync does not implicitly opt a fresh device into importing its native history. These onboarding choices persist across restarts. Upgrades retain previously initialized libraries.

Manual and scheduled work share running/success/error events, streamed over one authenticated local HTTP connection. This stream is idle between operations and makes no WebDAV requests. Countdown ticks remain local to the browser. Automatic fallback scans opted-in local sessions first and contacts WebDAV only when dirty; explicit Sync checks remote metadata even when local content is unchanged, but does not publish redundant objects.

## Sync triggers and measured overhead

Implemented in 0.8.1. Local capture and cloud traffic are separate.

| Event | Upload | Check directory / fetch |
| --- | --- | --- |
| New native chat / Update | No; extend local Pending | No |
| File into a Project / move trees | Changed trees, debounced 2 seconds | Read relevant remote versions before publishing |
| Combine, Dissolve, Rename, Grove Fork | Changed trees, debounced | Same pre-publication check |
| Archive / Restore | Changed trees | Same pre-publication check |
| Change a path's compaction choice | Saved context policy, debounced | Same pre-publication check |
| Activate / Deactivate / Apply context | Device-local availability only | No unrelated publication |
| App start / unlock | Retry previously queued organization | Initial directory check |
| Explicit project/tree open | No | Check if last directory check is older than 2 minutes; fetch only missing index/body versions |
| Window regains focus | No | Check only if older than 5 minutes |
| Local UI polling | No | No directory checks; reuse cached content |
| Sync button | All dirty trees, including Pending | Explicit check, even with no local changes |
| Idle fallback | All dirty filed trees, including Pending, after local capture | Default 15 minutes; no requests when unchanged |

A paused/unconfigured vault makes no network calls. The fallback uploads Pending belonging to changed Projects. Ungrouped is a shared default inbox and is included in publication. Repeated clicks and background refreshes do not bypass cache freshness. Publishing reads the necessary remote versions to detect conflicts; manual Sync does not redundantly re-read the same directory before publication.

The Sync button shows the most recent successful cloud action time. Its tooltip distinguishes last upload from last directory check. A failed attempt does not advance a success timestamp.

## Limits and retry behavior

The provider can impose traffic, authentication or service limits. A 15-second schedule alone does not prove that an IP will be blocked, and there is no universal safe request rate. The implementation therefore reduces unnecessary work rather than promising immunity from provider restrictions.

HTTP 429/503 responses honor `Retry-After`, with at least a one-minute pause. Other automatic failures use exponential backoff up to 30 minutes. Automatic retries never run on every page refresh. Manual Sync can retry an ordinary network failure but cannot bypass a provider-requested pause. Transfers are bounded to four concurrent requests, with in-flight work drained before a failure is reported.

[InfiniCLOUD's speed documentation](https://infini-cloud.net/en/support_guide_general_speed.html) describes per-IP, best-effort bandwidth; it does not specify a fixed WebDAV request-count ban threshold. Directory check frequency is not the same as HTTP request count: a check can require PROPFIND and conditional GETs for several device heads.

## Measurements from 0.6.0 (historical baseline)

An unchanged library now sends zero fallback cloud requests. The default 15-minute fallback only publishes changed Projects, after a fresh local capture. Explicit user navigation and Sync may still check the directory. Local capture defaults to 1 minute; both settings persist and can be disabled.

In a live Teracloud check confined to a new disposable test folder:

- 30 repeated cached project/tree/check cycles: **0 remote requests**, about **8.9 ms wall time / 9.4 ms CPU time**.
- The full multi-device integration run, including initialization, upload, lazy reads, compaction-policy synchronization, native sample materialization, archive, restore and cleanup: about **25.5 s wall time / 811 ms process CPU**, 142 HTTP requests, 23 KB sent / 51 KB received in measured protocol payloads.
- All temporary remote test data was deleted. No personal transcript was used.

These are measurements of that synthetic workflow against one live provider. CPU time, wakeups and traffic are useful overhead indicators; they are **not a watt-hour measurement**. TLS/header overhead is not included in payload byte counters. Latency and file sizes affect real workloads.

The main remaining costs are first-time encryption/transfer, parsing changed large histories, and rendering a very large open path. Changes in 0.6.0 skip agent-owned records before parsing, reuse immutable caches, avoid redundant catalog reads and coalesce Sankey redraws into one animation frame. Graph movement does not send network requests. Diagnostics expose CPU, request, byte and timing counters for actual testing.

## 0.8 overhead checks

The shared inbox uses the same encrypted objects and lazy indexes as named projects. Live-provider validation covers inbox upload, metadata-only listing, lazy hydration, local activation, a second device continuing the context, source-device updates, move-out, archive and restore-to-inbox. It uses synthetic data in a disposable child and removes it afterward.

The 40-session / 40-chat benchmark measured about 0.01 ms for an unchanged cloud dirty-status check and 0.82 ms for a metadata-only list refresh, with zero history-body reads for that refresh. These are local synthetic CPU/latency indicators, not measured electrical energy. The countdown updates two text nodes once a second while visible; it performs no networking.

A private copy of the real 12-session library (about 52 MB of current native logs) was also profiled. After saving verified summary/file-state hints, an independent process established native/list/cloud state in about 12 ms with roughly 72 MB RSS. First-scan transient RSS remained much higher (about 854 MB in that run); this is a remaining cost of decoding large histories, not the steady-state footprint. Imported/adopted sessions no longer retain a redundant full native-body baseline.

## 0.8.2: dirty-only upload clock and separate download

The main Download action uses pull only. Upload changes lives in the adjacent hover/click/keyboard menu. There is no upload fallback timer while clean: local capture or management starts it on the first dirty observation; repeated status reads do not restart it. Successful publication clears the deadline. Remote freshness checks remain on startup, focus and explicit navigation; this is not a WebDAV push subscription. Transfer progress reports completed verified records and an approximate **current-stage** ETA, throttled to at most five intermediate local UI events per second. Unknown-size preparation and index publication stay indeterminate.
