# Changelog

## 1.1.1

- Add reusable inline renaming for project navigation/category names, session titles, graph nodes and transcript node captions. Hover reveals a subtle border; double-click or F2 edits, check/Enter saves, and outside click/Escape cancels. Concurrent edits are rejected instead of silently overwritten.
- Separate whole-tree Session names from native transcription titles. Backfill missing Session naming records, follow the first named node for automatic Session names, and preserve manual names.
- Track the exact range of automatically named nodes and regenerate automatic labels when a later fork changes that range. Exclude open-Page metadata from naming evidence and follow the user’s instruction language when editing a quoted foreign-language passage.
- Compact Source into inline title fields and a single Capture changes list showing change type followed by time. Remove static explanatory text and rename tooltips.
- Add default-off transcription naming on new nodes for compatible Codex VS Code clients. Use completed-node requests and concise replies, cache/coalesce identical evidence, synchronize through the official rename API and refresh the client list without restarting. Preserve native manual edits and roll back failed refreshes.
- Add regression and real-corpus browser coverage for inline editing, cancellation, stale edits, naming coverage and shared-node boundary changes.
- Add a Settings toggle for user-login startup on macOS and Windows, retaining the current service and rolling back failed setup. Disable it in demo mode and preserve unrelated startup entries.
- Document the default-off Settings startup switch and its On/Off/Updating/Failed states in both READMEs.
- Keep Trash snapshots and their state version together so a concurrent change cannot leave the list stale.

- Node titles use the full card width, with tool icons overlaid. Compaction boundaries now name completed nodes on standalone paths as well as trees. Settings removes redundant static hints and keeps startup errors beside its status. Windows startup tolerates slower PowerShell initialization and restores the previous shortcut when verification fails.

## 1.1.0

- Preserve complete tree ancestry and shared node labels when client archives enter Trash. Restore individual paths into their surviving family, including separately restored parents/children and families moved between projects. Repair provable 1.0.x transcript-only recoveries using saved branch identities and verified history, with a local repair journal.
- Stream actual recovery read, decompression, integrity verification, record-write and graph phases into the lower-right task panel. Activation, conversion, deactivation and Discard use the same visible feedback; failures remain until dismissed. Restore no longer runs an unnecessary library-wide reclamation.
- Keep unused intermediate-node continuations reactivatable after the official client appends settings records. New turns and unfinished tool calls retain their existing guards.
- Store immutable native baselines separately and deduplicate them, capture only selected native histories during targeted operations, and scope rollback journals to affected instances.
- Compact Pending uploads with title/category on one line, dates below checkboxes, full-width change lists and stationary Select all / Deselect controls. Enable Current Active drag to project categories. Group Client archive and Trash by project, and reveal restored project rows with two highlights.
- Advertise VS Code links only for installed client extensions. Validate official Codex read/resume/archive/reactivate against real local history without submitting model turns.
- Add repeatable private-corpus audits for all visible trees, representative root/middle/endpoint activation, legal/rejected HTTP operations, recovery, Discard, local Git round trips and browser layout. See [1.1 validation](docs/1.1-validation.md) for evidence and limitations.

## 1.0.2

- Allow unused mid-turn activation continuations to deactivate after settings-only records; keep checks for new turns, tool calls, parse errors and changed file bytes. Empty placeholders disappear without entering Trash.
- Make Discard an observable workflow with inline progress and confirmation only for required native deactivation; updated selections and shared-project metadata are handled automatically. Confirm performs the prerequisite work and rollback together. Recover verified undo snapshots from local Git history when a working cache has been rewritten.
- Match Pending uploads to list controls: Select all / Deselect and Discard, no close icon, no static help or selected count, and a compact target/Confirm row without filesystem paths. The hover menu attaches directly to the banner.
- Separate Client archive from Trash; recovery Restore returns to Projects. Hide empty archive navigation and prevent native leftovers of trashed sessions from appearing as client archives. Back up then safely remove inactive native copies on Move to Trash.
- Compact the page headings and banner, keep fixed navigation groups with equal gaps, outline the scrollable project container, and preserve the selected project at scroll boundaries.
- Increase browser-startup readiness waits for slow CI hosts and validate both main and release-tag workflows when publishing.

## 1.0.1

- Verify Git using shallow, filtered metadata inspection instead of downloading history and session bodies; never fall back to an unfiltered verification fetch.
- Save Settings changes automatically, put verification actions beside their fields, and offer context-window presets with explicit client defaults. Successful API-key verification enables classification and node naming.
- Drag sessions, including multi-selection, into project groups or sidebar projects with edge scrolling.
- Group projects under Older projects when all their sessions are folded by Project contents; expanding Older projects reveals the sessions immediately.
- Remove empty activation placeholders on deactivation, retain continuations that contain chats, and correct the collapsed-sidebar footer spacing.
- Select Pending uploads and discard local changes back to an acknowledged snapshot, with stale-selection protection and recoverable local backups.
- Keep Previous archives local, exclude archived-only conversation suffixes from uploads, and remove old archive entries from the current Git tree on Push. Clarify local client-copy cleanup notices and hide irrelevant background-session notices.
- Add best-effort cache notifications for compatible Codex VS Code clients and direct Open in VS Code links. Claude's external archive/list-refresh interface remains unavailable; existing native-file protections stay in place.
- Add regression coverage for discard/recovery, archive boundaries, drag/scroll, older-project expansion, automatic settings and client notifications. See [release notes](docs/releases/v1.0.1.md).

## 1.0.0

- Validate Windows local history, Git Pull, native activation, cross-agent conversion and smart organization; add Windows unit/browser CI and test-gated GitHub releases.
- Fix Windows process detection, Codex executable discovery, native file locks, restricted credential storage, headless browser checks and RPC shutdown.
- Lock the saved Smart Organization key field; show Remove key in place of Verify, restoring the entry workflow after removal.
- Index native identities during discovery; skip redundant Git fetch and catalog reads on unchanged Pull. Add `pnpm bench:git` for CPU, memory, latency, Git and SQLite measurements.
- Batch revision/session writes in SQLite transactions; stream Git record files and yield during imports. Avoid repeated base-history reads and forced disk flushes for disposable Git cache files.
- Default smart organization to two concurrent requests, with configurable concurrency and request spacing. Keep queued progress labeled, shorten the header and enlarge the About footer.
- Add native context-window controls with profile-aware Codex edits and Claude auto-compaction budgets, private backups and stale-form protection.
- Rewrite both READMEs around use cases and replace screenshots with synthetic examples rendered in the real UI.
- See [1.0 validation](docs/1.0-windows-validation.md) and [release notes](docs/releases/v1.0.0.md).

## 0.14.0

- Replace Sync with one Pull / Push control, directional arrow animations, linked stage indicators and completion checks. Transfers are manual by default; automatic Push is opt-in.
- Keep transfer details compact: remaining time above the progress bar, download speed below, and actual failures in place of the bar. Technical counters live in Information.
- Keep local activation, naming, node organization and Trash available during transfers. New edits stay queued after the uploaded snapshot; newer session modification times govern reconciliation.
- Show cloud-only, locally active and modified-session state icons in lists and rails.
- Unify node activation with prefix/token/title previews and optional tool conversion. Native titles use `[Grove] session · node`; existing suffixes remain intact.
- Preserve transcript scroll position, graph focus and camera across message expansion and branch changes; use a lightweight Trash endpoint.
- Reuse verified local and downloaded records during cloud cleanup, persist verified downloads across retries, and count missing shared records across sessions instead of restarting each session's progress.
- Keep Pull active through shared-history preparation; avoid a redundant publication after cleanup already committed its snapshot. Integrity checks, deletion fences and shared-prefix protection remain in place.
- Bound manifest memory, use indexed reconciliation and provide reproducible resource and isolated browser benchmarks. See the updated design and sync policy for the white-box contract.

## 0.13.0

- Replace new Archive actions with Trash; retain previous archives behind an explicit migration entry.
- Keep private recovery copies for a configurable 1–365 days (default 30), expire them automatically, and restore under new identities without activation.
- Publish deletion markers, preserve referenced prefixes/native fork metadata, reclaim old cloud generations, and remove stale local caches.
- Rescue unsynced offline changes locally while preventing stale-identity resurrection.
- Introduce a Trash-aware vault fence, verified collection locking, per-resource HTTP 207 checks, renewed leases and resumable cleanup journals.
- Provide guarded native-copy cleanup and remove redundant completed rollback payloads.
- All devices must upgrade before the first Trash sync; ordinary startup does not migrate or delete existing archives.

## 0.12.0

- Restore dependency installation under the existing release-age policy; surface missing Claude SDK dependencies immediately.
- Run manual Sync without a blocking dialog and constrain inline transfer progress.
- Add one-week/default and count-based project content folding; hide an empty Ungrouped entry.
- Fork before non-root logical Nodes, use depth-based Pending labels, and preserve transcript DOM/scroll anchoring on node selection.
- Replace raw-JSON cross-agent prompts with Balanced, Complete text and Messages only; use a directory picker and on-demand token estimates.
- Exclude managed background records from upload and consolidate legacy single objects into packs on subsequent changed-tree publication.
- Add native-reader equivalence, real read-only cloud sample checks, a browser workflow and a reproducible CPU/memory/network audit.
- Trash/deletion remains a separate proposal; no existing cloud data is purged.

## 0.11.0

- Make browsing local and Pull explicit; retain opened cloud sessions, show cloud icons only for missing local copies, and keep automatic Push separate from directory refresh.
- Start a single upload countdown only for local changes and honor the disabled setting. Viewing hidden background sessions no longer queues their entire history for upload.
- Fit complete trees on open, focus nodes by identity without rebuilding transcripts, and preserve scroll on checkbox selection.
- Collapse inactive projects together in both panes with a configurable 7/15/30/60-day threshold; save the background filter immediately.
- Preview Lean and Full token estimates in the custom activation selector; clarify working directories and collapse Information topics.
- Derive Claude fallback titles from real prompts, preserve native records, and separate command-only initialization from actual conversations.


## 0.10.0

- Unify Sync with Pull-before-Push previews, large-transfer confirmation, progress and ETA.
- Add continuous project groups, five-row previews, scroll-linked pinned navigation, collapsible panes and a resizable transcript/graph split.
- Shorten Claude badges, expose title provenance, and group confirmed background sessions behind the visibility preference.
- Use native Codex archive calls with rollback journals and two-month maintenance plans.
- Introduce verified record packs (cloud schema 5; upgrade other devices), persistent summaries and indexed family/merge validation.
- Fix single-chat toggle-off and foreign-device project-move directory cleanup.


## 0.9.0

- Add authenticated status/stop commands, cancellable sync and bounded shutdown.
- Recover paginated native ancestry without cutoff ordinals, including archived ancestors.
- Use official Claude file-only projection and fork semantics; snapshot companion files.
- Add full/lean cross-agent activation previews with provenance and stale-preview checks.
- Add sync phase timings, resumable immutable uploads, bounded graph caching, shared-message transport and gzip.
- Add native and browser regression checks; document fidelity and measured limits.

## 0.8.0

- Shared Ungrouped inbox with lazy cross-device loading, time groups, batch archive and restore without mandatory filing.
- Live local-only Sync/Update countdowns, compact About/footer and aligned selection controls.
- Actual tool/device provenance on lists and graph Nodes; no placeholder cross-agent conversion.
- Native pointer fast paths, append-only fragment hashing, lightweight status/summary caches and indexed graph traversal.
- Capture ongoing conversations for Pending display; retain completion checks for materialization.
- Queue settings changes behind sync and surface remote archives that still need local deactivation.

## 0.7.1

- Resolve Codex parent, edited-version and context-window history references before grouping or displaying sessions. Repair existing suffix-only imports on Update.
- Preserve explicit native fork ancestry and keep referenced parent prefixes accessible after deactivation.
- Support verified paginated materialization, correct native index modes, and restore Transcript/Graph compaction switches for complete histories.
- Compare native New branch and Grove Fork at the same completed turn with the installed Codex executable. Replace changed contexts with fresh native projections.

## 0.7.0

- Progressive WebDAV verification, fixed application folder, masked saved secrets, optional encryption and verified key migration with progress.
- Configurable one-minute local capture and dirty-only fifteen-minute upload fallback; capture before every upload.
- Markdown transcripts with tools, named files, reasoning and recorded-instruction inspection.
- Record-preserving activation; reject unverified paginated rewrites instead of downgrading histories.
- Sidebar About/Information, separate settings and diagnostics, and `pnpm dev`.

## 0.2.0

- Default English interface, persistent Chinese switch, and localized forms / status labels.
- Local Active above cloud projects; automatically observe native sessions without changing their visibility.
- Infer unfiled fork families from exact completed history prefixes, scoped to the same Agent and working directory.
- Project collections with groups, standalone sessions and tree entries. Only forked items open a branch graph.
- Named logical work nodes separate from native threads. New interaction accumulates in a stable Pending tail.
- Commit successive complete-turn ranges from Pending, preserving remaining messages and immutable checkpoints.
- Move an entire session or fork family into a project; local-only data stays out of cloud exports.
- Automatic encrypted project sync after connection/unlock, queued offline changes, and retry status.
- Logical-node chains synchronize independently of message capture; concurrent organization is retained as an explicit choice.
- Schema 2 cloud manifests retain compatibility with schema 1. Existing local branches migrate to initial logical nodes.

## 0.1.0

- Project-centered local session library, branching, explicit Active set, native adapters, and encrypted WebDAV transport.
- Initial baseline commit: `0bf5956`.
