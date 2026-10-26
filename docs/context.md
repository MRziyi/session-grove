# Context and native history

Grove stores recorded history and organization separately. A node is a labeled range on a path, not a replacement for the original messages. Conversation branching does not isolate workspace files, editor tabs or other context supplied by a client; use separate working folders when file isolation is required.

## Titles and navigation

Logical Session names, node labels and native transcription titles are independent. The detail header's prefix action targets active client copies in the tree, previews `[prefix] original title`, and replaces a prefix previously managed by that action. Codex uses its existing name/refresh channel; Claude uses the pinned SDK's title metadata API. A batch reads and verifies client titles before saving Grove metadata, and attempts conditional rollback on failure without overwriting intervening client edits.

Detail search spans the loaded Session tree, deduplicates shared messages, identifies each result's transcription path and opens the matching message. It does not send a naming request. Offscreen ancestor cards follow the branch being previewed; all ancestors are listed individually in a scrollable column on the opposite side of horizontally cropped content while sibling branches are cropped normally.

## Activation and conversion

Activation previews and materializes the same path prefix through the selected node. A following compaction belongs to the next context window and is excluded. Boundaries with unresolved tool calls, unsupported history or unavailable attachments fail explicitly. Fresh continuations have independent native identities and do not overwrite the source conversation.

Same-agent materialization preserves supported native records, including recorded tool activity, instructions, reasoning payloads and unknown fields. Claude projection/forks use the pinned SDK. Client versions and hidden runtime state can affect resumability; preserving records does not prove that two clients send identical requests or generate identical responses.

Cross-agent conversion creates a new historical-text session:

| Mode | Included | Limits |
| --- | --- | --- |
| Balanced | Dialogue, tool inputs/results, project instructions and file changes | Long successful read-only results can be shortened. |
| Complete text | Dialogue and full recorded tool text, instructions and file changes | Binary attachments and proprietary thinking state remain in the source. |
| Messages only | User/assistant prose and readable compaction notes | Tool activity and extra runtime context are omitted. |

All modes retain the original source session. Generated IDs and destination paths are intentionally rebound.

## Two kinds of compression

Codex can compress stored rollout files as `.jsonl.zst`. This is lossless disk compression. Grove resolves the same native history references through plain or compressed segments; prefix offsets refer to decompressed bytes. File compression does not itself create a model-context summary.

Context compaction is a separate native history boundary. Grove recognizes supported Codex and Claude compaction records and keeps their original payloads. Readable summaries and retained messages can be inspected when present. Opaque encrypted payloads cannot be decrypted or reconstructed by Grove. Disabling a supported boundary changes the materialized context policy, while the library retains its raw source.

## Token measurements

Node counts estimate visible text plus recognized tool arguments/results. The local heuristic is approximate and excludes hidden instructions, encrypted payloads and images; it is not measured model usage.

Activation estimates prefer usable native input-token observations and available client/model limits. Cumulative billing totals are not current context size. If compaction occurred after the last usable observation, Grove does not reuse the pre-compaction count as a post-compaction measurement. An opaque summary can make the estimate incomplete.

Settings can edit supported client context limits; it cannot expand a model's capacity. New sessions pick up changed defaults, and other profile/project/launch overrides may take precedence. See [Operations](operations.md) for backups and configuration paths.

## References

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Claude session API](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude context management](https://code.claude.com/docs/en/how-claude-code-works)
