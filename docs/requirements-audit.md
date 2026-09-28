# Requirements and context-fidelity audit — 0.7.0

| Requirement | Status / evidence |
| --- | --- |
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
| Arbitrary paginated history rewritten/migrated with identical native semantics | **Not verified; blocked.** Prior 0.6 format conversion has been removed |
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
