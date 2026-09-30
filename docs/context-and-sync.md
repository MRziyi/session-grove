# Context visibility and incremental cloud sync

> Git 技术分支（0.15）以 [Git 同步与迁移](git-sync.md) 为当前规范。下文 WebDAV、加密、按需下载及云端物理清理描述属于旧实现；该分支不再启用这些流程。

Updated for 0.8.0. This document complements the [interaction model](interaction-model.md).

## Three different token quantities

The graph displays **approximate recorded text tokens** per Node, including Pending. The metric covers displayed messages and recognized tool arguments/results associated with those messages. Tool-only events are assigned to the preceding visible chat; the transcript and native records are not changed.

This is a local heuristic, not an official tokenizer: ASCII characters / 4 + non-ASCII characters × 1.5, rounded for each text fragment. It is useful for comparing the relative size of work segments. Code, language, model vocabulary, framing and modalities can produce substantial error. Hidden instructions, encrypted content and images are excluded. Tool estimates must not be mistaken for measured model usage.

Activation preflight uses the latest recorded native input-token count and available local limits. The title area shows compact path metrics; there is no separate Context button. Recognized native fields include:

- Codex: `event_msg/token_count.info.last_token_usage.input_tokens` and `model_context_window`.
- Claude: input tokens plus cache-read and cache-creation input tokens from the recorded assistant usage object. A context limit is not guessed when absent.
- Cumulative billing totals are never presented as current context size.
- If compaction occurred after the last available usage event, the current reported input is shown as unknown. A pre-compaction observation is not reused as a post-compaction measurement.

An estimate of all historical Nodes is **not** the effective context after compaction. The latest recorded input is also a historical observation, not a live remaining-capacity meter.

## Compaction is a context boundary, not erased history

Grove retains the full raw history and logical organization. It recognizes Codex `compacted` records and Claude `compact_boundary` / explicitly saved `isCompactSummary` records. The graph/Transcript mark the next segment after a compaction boundary. A logical assignment spanning the boundary is displayed in separate segments with its title retained.

The parser retains the following information for context checks and future inspection (the normal UI only marks the boundary):

- the event time;
- input-token observations before and after, when recorded (the later observation can also include new messages);
- an explicitly recorded readable summary;
- retained readable user/assistant messages, shown separately from the summary;
- an explicit indication when the compaction payload is encrypted or no summary was saved.

A read-only inspection of a relevant local Codex transcript found a `compacted` record with an empty `message`, retained readable messages and an encrypted `compaction` item. No personal transcript or identifiers were added to this repository. Grove cannot decrypt this native model payload, reconstruct an authoritative hidden summary from it, or claim to score its quality. A newly generated summary would be a separate artifact, not evidence of what the agent retained; this version does not generate one.

Compaction records remain in the raw materialization source. Forking at a complete checkpoint before compaction retains that earlier history; a later checkpoint includes the recorded compaction state. This reader does not promise that every proprietary compaction format can be resumed in every client. Existing adapter compatibility checks still apply, and real Claude client verification remains outstanding.

References checked for this change:

- [OpenAI Compaction](https://developers.openai.com/api/docs/guides/compaction): Responses compaction can return opaque encrypted state.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): token-usage notifications and `contextCompaction` lifecycle items; the lifecycle item alone is not a summary.
- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works): session files, context management and compaction behavior.

## Capture and publication are separate

| Event | Local library | Automatic cloud action |
| --- | --- | --- |
| New completed native messages | Capture raw events; extend Pending and update counts | None; mark local changes |
| Update button | Immediately collect native changes | None |
| Move into a Project / create Project while filing | Assign the whole tree | Queue the changed tree |
| Combine / Dissolve / supported rename / Grove Fork | Save organization or membership | Queue the changed tree |
| Archive / Restore | Save membership/archive state after applicable native actions | Queue affected trees |
| Activate / Deactivate alone | Change device-local native availability | None |
| Resolve an organization conflict | Save the chosen version with merge ancestry | Queue the changed tree |
| Manual Sync | Preserve all current history | Publish dirty trees, including remaining Pending |
| Background interval | Capture local records first | Upload dirty filed trees, including Pending; no requests when unchanged |

Management changes debounce for two seconds. Only affected trees are queued, so organizing one project does not automatically publish unrelated Pending in another. An uploaded tree is a coherent snapshot including any remaining Pending; the trigger policy controls **when**, not whether the transcript is complete. New native changes arriving later remain local until an organization action, manual Sync or the dirty-only fallback.

The queue survives a service restart, retries after failures and remains pending while locked. Background upload fallback defaults to 15 minutes while configured and unlocked and runs only for dirty project content; normal UI refreshes do not check the cloud. Explicit opens use freshness windows, and failed automatic operations back off. See [sync policy](sync-policy.md). Opening a browser also requests a directory check when the service is unlocked.

Sync has a single explicit role: publish unsent changes (including Pending) and refresh the cloud directory. Its tooltip shows last publication/check times. It remains useful without local changes because the directory may have changed remotely. Cloud glyphs show cached, cloud-only, updated and local-unsent states. Language and connection settings are in Settings.

Settings saves credentials and the optional key in owner-only local files. Empty keys mean explicitly unencrypted vaults. The next `pnpm dev` reuses saved settings. This is not Keychain integration.

## Three levels of cloud loading

The encrypted WebDAV vault retains its root `session-grove-v1/` and adds an indexed protocol:

```text
vault.json                   Salt and authenticated passphrase check
heads/<device-id>.bin         Small encrypted project directory per writer (schema 4)
projects/<hash>.bin           Immutable encrypted project membership/list index
trees/<hash>.bin              Immutable encrypted tree graph/revision manifest
objects/<hash>.bin            Immutable encrypted raw transcript fragments
commits/                     Retained older all-library manifests
```

1. **Directory**: read device heads, using ETags when supported. Heads contain project names, counts, index references and tree IDs needed to combine concurrent counts. They contain no transcript body or logical graph.
2. **Project**: selecting a project reads its missing project-index versions. Lists can show cloud-only titles, branch/chat counts and modification times before the graph or transcript is downloaded.
3. **Tree**: opening a tree fetches missing tree manifests and required raw objects, verifies hashes, then merges immutable history and organization. A cached tree is reused; a newer remote version is fetched on open. Already available local content remains readable offline.

Full-text search is an explicit request for content: searching an unopened cloud project may hydrate its trees to search the complete transcripts. Ordinary project navigation does not. Opening Archived may load the project indexes necessary to assemble that list, but not transcript bodies.

Cloud-only entries are metadata projections, not half-imported branches with missing raw objects. They enter the local graph store only when their dependencies have been downloaded and checked. Pulling never activates them in an agent.

## Publication and concurrent devices

Each device writes its own head, so two computers cannot overwrite each other's directory pointer. Immutable object, tree and project-index dependencies are uploaded before the head is published. A failed upload leaves the previous head usable and does not acknowledge unsent local changes. Orphaned immutable uploads can be reused on retry.

Project-index ancestry and tree-reference ancestry retire older versions without relying on wall-clock order. Concurrent independent trees remain present. Before publishing a changed tree, Grove reads the current relevant indexes and merges that tree's remote changes. Unresolved organization conflicts remain explicit choices; the uploader does not silently choose a layout.

Publishing a partially cached project preserves references to its cloud-only trees without fetching their transcripts. Moves update both the source and destination project indexes. Original raw data and immutable organization histories remain available; automatic remote garbage collection is not implemented.

Old schema 1–3 commits can be indexed without downloading all transcript objects. Their tree manifests and project indexes are converted as metadata when publishing the new directory, keeping unopened legacy projects reachable. Update all writing devices to 0.4.0+: older versions cannot consume the new head-based protocol, and mixed-version writes after migration are not supported.

## Verified and remaining boundaries

Tests cover catalog-only reads, project-index-only reads, selected-tree hydration, no-op uploads, Pending-only local changes, organization triggers, failures before publication, concurrent writers, project moves, cloud-only references during publication, old-vault migration, tool-text estimates and compaction visibility. Browser checks cover action visibility, panel layout, graph reading, token hints, language switching and archive/activation workflows.

WebDAV interoperability is tested against an isolated protocol server and a live Teracloud account using a disposable dedicated test directory. This does not certify every provider or deployment. Recorded context estimates are intentionally approximate. Encrypted native compaction contents remain opaque. No real personal transcript was used as a committed fixture.


For local context configuration, warning acknowledgement and diagnostic logging, see [Operations](operations.md).


## Selecting original or compacted context

Each path has a synchronized `contextPolicy` listing disabled compaction event IDs. These IDs refer to immutable recorded events. The newest enabled event determines which earlier graph Nodes are superseded in the preview. Raw history and organization remain unchanged.

Apply is explicit for active paths; inactive paths use the choice on Activate. For adopted native sessions, a changed context is materialized into a new native instance and the previous instance is parked under the normal journal/rollback mechanism. Capturing subsequent native updates reattaches the new suffix to the retained original revision, so toggling does not destroy earlier history.

Codex legacy materialization preserves all recorded response items, tool inputs/results, reasoning, metadata instructions, turn settings and unknown fields. Only declared session identity/path fields and explicitly disabled compaction records change. Supported paginated histories resolve their `history_base` chain by exact byte/ordinal bounds and materialize as self-contained paginated logs. Metadata identity/path references are rebound; conversation, tool, reasoning, world-state and enabled compaction payloads remain intact. Missing or inconsistent segments fail closed. Context replacement creates a fresh native identity to avoid stale projection caches. Paginated parent files stay in native archived storage when deactivated so active children retain access to their prefixes.

For recognized Claude boundaries, expanding omits the boundary/summary and reconnects known parent UUIDs to the retained prefix. Real Claude-client verification is still outstanding. The UI cannot offer expansion when no recorded prefix is available.

All writing devices should use 0.7.1+ to honor path context policies. A native agent may compact again during later work; the switch does not change its global auto-compaction configuration. Expanded-history token estimates can differ substantially from the previous compacted input usage and are checked again at activation.


## Optional encryption and key changes

Schema 1 encrypted vaults remain readable. Schema 2 adds an explicit `encrypted`/`plain` mode and an optional generation pointer. Plain objects carry a format header and compression; they are not encrypted. Rekeying stages every old cloud object in a new generation, including unopened trees, and verifies every decoded read-back. A matching strong ETag or an exclusive WebDAV lock protects replacement of `vault.json`. Old files are removed only after verified publication; cleanup errors remain visible. The local private migration journal keeps the destination key until local settings commit. See the settings state machine in the interaction model.

## Record fidelity and responsiveness (0.8.1)

An opaque reasoning record can have no readable summary at all. The display says so explicitly. The immutable object, encrypted payload and unknown fields are retained; the record inspector omits opaque blobs and pages large readable content solely in its display projection. This does not claim the client or model will reuse opaque reasoning in every future request. Native compaction itself determines which earlier context is superseded.

Fork copies the recorded prefix at a completed checkpoint and inherits applicable compaction choices. A zero-chat endpoint is visible and selectable for activation. If a logical Node includes an ongoing turn, the Fork confirmation explains the excluded trailing chats; no synthetic completion event or missing tool result is fabricated.

Large histories previously exceeded the 24 MiB parsing cache and could be parsed repeatedly. The cache now keeps one oversized history up to the native 100 MiB limit, evicting other entries. Record inspection reads the requested immutable record directly. Folded tool/reasoning activity is rendered on demand. On one temporary copy of the current local library, cold target-graph computation measured about 1,615 ms before and 321 ms after (21 vs 12 history reads, process RSS 932 vs 406 MB). These are one-run local measurements, not a guarantee for other histories; first parsing and changed histories still cost time.
