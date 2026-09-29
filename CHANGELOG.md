# Changelog

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
