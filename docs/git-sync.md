# Git sync and local recovery

Native Git over SSH is the only sync transport. Grove uses an application-owned checkout, separate from the user's project/source repository. Local SQLite remains the authoritative library and is never committed.

## Repository format

```text
grove.json                         format and schema marker
trash.json                         deletion identities
trees/<hash-of-tree-id>/index.json  project/session listing metadata
trees/<hash-of-tree-id>/graph.json  branches, nodes and revision references
trees/<hash-of-tree-id>/graph/<content-hash>.jsonl  large graph metadata parts
trees/<hash-of-tree-id>/records/000000.jsonl
```

Record files contain `[contentHash, originalRecordText]` JSONL. LF separates records; Unicode line/paragraph separators inside strings remain content. Files target 8 MiB and must remain below 95 MiB. Metadata is separate so ordinary renames do not rewrite conversation bodies. Git handles compression/delta encoding.

Graphs that fit the file limit retain the single-file representation. Larger graphs use a small `graph.json` manifest and content-addressed JSONL metadata parts targeting 8 MiB. Each part records field/row order, byte length, row count and a SHA-256 checksum. Reassembly preserves the original canonical graph digest and every revision reference. Parts are written before the manifest is atomically replaced; superseded working parts can then be pruned. Committed parts remain available for offline Discard even after a failed Push replaces the working cache.

Repositories containing graph parts use container schema 2; the graph itself retains its existing schema. Update Grove on every device before syncing such a repository. The current reader accepts both container schemas. The per-file limit remains 95 MiB, including individual graph rows and native record lines; oversize errors identify the file or row instead of silently dropping history.

The data repository uses `main`. Normal fast-forward pushes publish snapshots; Grove does not force-push or rewrite remote history. Keep the repository private because it contains readable conversation text. Native files, activation choices, API keys, SQLite and recovery copies are device-local.

## Capture, Pull and Push

Update captures native history locally. Pull fetches and validates the repository, then imports its current sessions into SQLite. It does not upload. Push pulls first, captures dirty trees/deletion markers, commits and pushes, and acknowledges only that snapshot. Local changes made during a transfer remain pending.

Automatic Push is opt-in and runs only while work is pending. There is no background Pull. Local browsing and permitted local actions stay available during transfers. Failures preserve verified work, show the failing phase, and require retry where appropriate; unknown totals remain indeterminate.

Archived branches/projects are local-only. An archived ancestor contributes the shared prefix needed by active descendants. Explicit Push removes archived-only entries from the current repository snapshot; earlier Git commits can still contain them.

## Conflicts

Keep previous and Keep current compare the synced and current local versions. They are source choices, not a judgment based on wall-clock time. A changed selection must be reviewed again. Conversation replacement saves a recovery copy and uses native-copy safeguards; metadata-only resolution preserves messages. Resolutions stay local until the next Push.

Project membership follows the tree root. Old conflicts caused only by stale derived child membership can be repaired; real field differences remain explicit.

## Organization-only Discard

Only pending rows with reversible Grove organization edits can be discarded: labels, project assignment, node grouping and context preferences. Discard preserves messages, revisions, new sessions/forks, native files, client transcription titles, activation state and Trash identities. Conversation/client changes remain queued for Push.

Targets come from verified downloaded metadata or a local pre-edit organization checkpoint. No network operation is needed. Old selections and changes during preparation fail safely; appended conversation content remains intact. Project metadata outside the selected tree's current project scope is preserved. Batches with incompatible shared-project baselines require separate decisions.

Rollback keeps a local metadata recovery record and reports a no-op honestly. It pauses affected [Smart Organization](smart-organization.md) until Continue is explicitly chosen, including after restart or new messages.

## Trash

Moving an inactive path or tree to Trash saves local recovery data before native removal. Surviving paths keep shared ancestry. Native files still referenced by other sessions are protected, including references from compressed rollouts. Content identity and physical-byte stability are checked separately.

Recovery copies expire according to Settings. Restoring creates safe identities, restores organization/shared ancestry where available, and does not activate the recovered session. Git Push propagates deletion identities, but old Git commits can retain the historical content; Trash is not repository-history erasure.
