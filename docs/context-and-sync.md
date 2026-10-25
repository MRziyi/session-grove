# Context visibility and incremental cloud sync


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

## Capture and publication

Native capture is local. Git Pull and Push exchange saved history; automatic Push is opt-in. See [sync policy](sync-policy.md) for triggers, conflict handling and progress.
