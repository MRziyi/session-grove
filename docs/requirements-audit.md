# Requirements and context-fidelity audit — 0.8.1

| Requirement | Status / evidence |
| --- | --- |
| First-use Update / Sync gates, existing-vault Unlock | Implemented; HTTP, mock WebDAV and new-device browser flow |
| Animated manual/scheduled operations and no-change Sync | Authenticated local event stream, browser feedback and no-PUT regression |
| Scheduled/background filter, opaque-reasoning display | Provenance filter, immutable-record and preview tests |
| Projects own trees; devices/clients are provenance | Implemented; membership, prefix inference and cross-device tests |
| Current Active / Projects / Archived, isolated archived paths | Implemented; server projections and stale-response browser regression |
| Logical Nodes, Pending, continuous ranges, shared-prefix edits | Implemented; repartition, branch-boundary and browser tests |
| Context-sensitive actions, smaller graph, styled selectors, pan/zoom/Sankey | Implemented; browser regression |
| English/Chinese, language inside Settings | Implemented; browser language persistence test |
| Staged WebDAV verification and masked saved fields | Implemented; UI and backend tests |
| Fixed dedicated cloud folder, optional encryption, Modify and progress | Implemented; verified-generation migration and failure tests |
| Local 1-minute capture; changed-only 15-minute fallback; capture before upload | Implemented; timer and zero-request tests |
| Indexed, lazy cloud loading, manual Pending upload | Implemented; cloud and live-provider tests |
| About, author links, Information/action help/diagnostics | Implemented; browser tests |
| Readable Markdown and non-prose context | Implemented; escaped HTML/URL tests, ledger and original-record API |
| Full raw history survives Node organization and WebDAV | Verified by exact record/round-trip comparisons |
| Supported Codex legacy materialization retains tools/reasoning/instructions | Verified by structured record comparison and native read/resume smoke; no model turn submitted |
| Original paginated file restored unchanged on its original machine/path | Byte-for-byte adapter test |
| Supported paginated fork materialization | Verified against native `thread/fork` at the same completed turn: projected items, response items, world-state and base instructions match. Referenced byte prefixes are resolved without converting to legacy; missing/unknown formats still fail closed |
| Real Claude client continuation | File adapters tested; actual client validation remains outstanding |
| Every token in the live model request visible in Grove | **Not possible from available logs alone.** Opaque reasoning/compaction, images, dynamic instructions and truncation limit observability |
| Identical model responses after resume | Not promised; preserving recorded input is distinct from runtime prompt construction and generation |

## What is preserved

Node operations modify organization only. Raw event records remain immutable, including tool calls, tool outputs such as captured file contents, reasoning payloads, saved instructions, compaction records and unknown fields. Supported materialization rewrites declared session identities and working-directory metadata only. It does not shorten tools or regenerate prompts from UI prose. Explicitly disabling a supported compaction intentionally changes effective history; it is not an equivalent-context operation.

Record comparisons cover complete tool results, base/developer instructions, dynamic-tool metadata, opaque reasoning strings and unknown fields. Native read/resume tests verify that Codex accepts the assembled legacy history, not that an unobserved network request is identical.

The native client may inject current instruction files, tools, model settings and environment information on resume. Changing device/path/model can therefore change its effective prompt even when every saved conversation item is preserved. [Official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server) describes restored dynamic tools, instruction sources and configuration overrides on resume. Native implementation details evolve; strict equivalence requires a supported client/version and inspection of its actual request-building behavior.

## What the Transcript shows

Markdown is display-only. Tool activity stays associated with the preceding visible chat and can be expanded. Structured file arguments show their recorded paths. Tool output is the captured result—not a fresh read of today's file. Shell commands may access files that are not individually identified in the log; Grove does not invent a complete file list. Readable reasoning and instructions are inspectable; opaque or non-text entries are labeled unknown. The latest native token count and historical text estimates remain separate measurements.

External attachments/companion directories still block unsupported materialization. This audit supersedes older design documents and any broad claim that all native sessions are interchangeable across clients.

## Native comparison in 0.7.1

The installed VS Code Codex executable (`0.155.0-alpha.16.3`) supports experimental paginated read/resume/fork. Blanket disabling based on older public documentation was too broad. `scripts/codex-fork-smoke.js` compares native `thread/fork(lastTurnId)` with Grove Fork → Activate using private, isolated copies, no authentication and no model turns. One comparison matched 46 projected items and 88 complete response-item payloads. Another matched 79 items and 134 payloads while explicitly disabling compaction, then re-enabling it and resuming a fresh native projection. World-state and base instructions matched; source file hashes remained unchanged. No personal fixture or transcript is committed.

`history_base` may reference a parent thread, an earlier segment of the same thread, or a context-window segment UUID. Its byte offset and exclusive ordinal bound the inherited prefix. The complete chain is resolved before inference, display, export or materialization. Earlier unselected suffixes are not appended to the selected path. Referenced parent segments remain discoverable when a parent is deactivated.

## 0.8 review

- Ungrouped now synchronizes, supports lazy retrieval and keeps device Active separate. Time grouping and batch archive address everyday-session growth without mandatory categorization.
- Lists/Nodes expose actual tool provenance; device badges identify the latest content source. Cross-agent context conversion remains unimplemented and has no selectable placeholder. A future conversion must preserve prefix provenance and mark the new suffix with its actual tool.
- Native ancestry uses verified pointer bounds and immutable reference slices, bypassing content comparison. Ordinal gaps caused by explicitly disabled compaction are accepted when order is valid.
- Ongoing turns may be captured for display; unsafe materialization still waits for completion. No-op applies bypass process checks; writes only check the target Agent. Missing history, unsupported attachments and index-schema checks remain necessary.
- Cached summaries avoid re-parsing old transcripts for list refreshes. Appends hash new fragments only; graph traversal uses indexes and a topological queue.
- Configuration changes queue behind running sync rather than failing immediately. Cloud cache writes use independent objects across vaults.
- Remote archive/native Active differences are explicit pending actions rather than silently hidden rows.
