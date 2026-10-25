# Git sync

The runtime uses native Git over SSH and an application-owned checkout. Local SQLite remains the UI/index store; it is never committed. No new package dependency is needed.

## Repository format

```
grove.json                         # format and schema marker
trash.json                         # deletion identities, no transcript bodies
trees/<hash-of-tree-id>/index.json  # project/session listing metadata
trees/<hash-of-tree-id>/graph.json  # logical branches, nodes and revision refs
trees/<hash-of-tree-id>/records/000000.jsonl
```

Records are plain `[contentHash, originalRecordText]` JSONL, grouped into bounded files (8 MiB target; an individual record may exceed this, but files must remain below 95 MiB). Metadata is separate, so renaming does not rewrite record files. Git decides compression and delta encoding. Grove graph branches are data, not Git branches. The repository uses `main`; normal fast-forward pushes publish snapshots atomically. No force-push, application HTTP object uploads, readback downloads or cloud-wide garbage collection.

## Pull and Push

- Pull fetches `main`, validates the Grove format and file types, and imports every current session into local SQLite. Unopened sessions are local too, so the UI has no cloud badges. An interrupted import can be retried from the checkout.
- Push first performs Pull, then writes the current dirty trees and deletion markers into the checkout, commits and pushes. It acknowledges only the captured snapshot. Changes made while Git runs remain pending.
- Session metadata/transcript modification dates drive reconciliation and sorting. Fetch, open and commit timestamps do not replace those dates. Native activation remains local.
- No background Pull. Automatic Push is off by default; enabling it starts a countdown only for pending work. Browsing and local Rename/Activate/Trash do not wait for network completion.
- A stale remote rejection preserves local database changes. Retry Pull/Push to reconcile. We target sequential personal use, not team collaboration.
- Settings verifies SSH access and repository format without publishing. It uses `ls-remote` for emptiness, then a disposable depth-one, tree-filtered fetch to inspect only the top-level layout and `grove.json`. It does not check out files, download session bodies or fetch history. Nonempty servers must advertise partial-clone filtering; verification never falls back to an unfiltered fetch. Full validation remains part of Pull/Push. Connect an empty repository or an existing Grove-format repository, not a source-code repository. Git uses the existing SSH configuration in batch mode; keys stay with SSH.

The split Pull / Push buttons contain the progress fill. Push fills Pull first, then Push. Workflow milestones allocate portions of the fill to preparation, transfer and import; the separately displayed percentage measures the named current phase, not total operation bytes. Unknown work uses a moving highlight. The action text remains to the left of the aligned toolbar buttons; measured speed and phase ETA appear only when available. Errors remain inline with expandable, bounded details. There is no separate transfer-progress panel or duplicate stage tags. Completed buttons briefly show a check and fade back to their idle appearance. New local edits clear Push success and add a pending dot. A Pull with no remote change and no outstanding local imports reports “Already up to date”.

## Reviewing sync conflicts

Click the sync error or open the Push dropdown to review affected sessions/projects. Each row compares the synced version (**Keep previous**) with the current local version (**Keep current**). Select individual rows or Select all, then apply one choice to the selected items. These labels describe the two sources, not their wall-clock order.

Choices update local records and acknowledge both metadata/organization histories. A changed item must be reviewed again before applying a stale selection. Keeping a previous transcript saves a local recovery copy, deactivates the replaced client copy and detaches/suppresses its native identity so a later Update does not import the discarded history again. Resolving metadata alone preserves conversation records. Resolutions remain ordinary local changes for the next Push.

Project membership is inherited from the tree root before conflict comparison. Older same-version child-project conflicts caused solely by stale derived membership are repaired automatically; real field differences remain explicit choices.

## Trash and history

Trash disappears from the latest snapshot after Push; older Git commits may retain the previous content. Local recovery copies stay on this device. Shared prefixes required by surviving paths remain available. See [Trash and recovery](trash-design.md).

## Change summaries and identity

Pending uploads compare a compact semantic baseline with the current graph: session rename/move/add/remove, transcript append or rewrite, node rename/regroup/dissolve, context settings, and project metadata. These same captured changes generate the Git commit subject and body with project/session names. Changes made after the upload snapshot remain pending. Transcript append counts are native records, not model tokens or conversation turns.

Grove names are display aliases. UUIDs, native thread IDs, immutable revision IDs and message identities are independent of these names. Renaming does not schedule native rematerialization. Re-activating an unchanged native Claude session preserves its existing UUID chain instead of forking it again. Active endpoints show a green dot and offer Deactivate directly. Activation previews use the graph's complete Pending number, explain context capacity/compaction thresholds with labels, and put tool switching beside Confirm. General explanations belong in Information.

## Discarding pending local changes

Pending uploads separates organization edits from conversation changes. Only rows with reversible organization edits can be selected for Discard. The hover menu preserves selection when reopened.

Discard restores names, project assignments, node labels/grouping and context preferences from verified downloaded metadata or a local pre-edit organization checkpoint. It never replaces conversation revisions, removes new sessions/forks, changes native files, deactivates sessions or undoes Trash. Conversation additions and other content changes remain pending for Push. Active sessions do not require confirmation for an organization-only discard.

The operation keeps a metadata-only recovery record locally. It uses read-only Git history when needed and performs no network transfer. Concurrent organization changes cause a safe retry; conversation growth is preserved. A no-op is explicitly reported as having no organization changes to discard. Discarded automatic organization stays paused across refresh, restart and new messages. The existing Smart Organization attention indicator opens Settings, where Continue explicitly resumes it.

Previous archives is local-only in Git sync. Archived branches and archived projects are excluded from outgoing graphs; an archived ancestor contributes only the frozen prefix required by its active descendants. Catalog reads skip archived-only remote entries. Explicit Push removes those old entries from the current remote tree, without rewriting Git history or deleting local archives. Older clients must be upgraded to avoid reintroducing them.
