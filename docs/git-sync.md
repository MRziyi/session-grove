# Git sync (0.15)

The runtime uses native Git over SSH and an application-owned checkout. Local SQLite remains the UI/index store; it is never committed. WebDAV, encryption and generation rebuilding are legacy migration code only. No new package dependency is needed.

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
- Settings verifies SSH access and repository format without publishing. Connect an empty repository or an existing Grove-format repository, not a source-code repository. Git uses the existing SSH configuration in batch mode; keys stay with SSH.

The split Pull / Push buttons contain the progress fill. Push fills Pull first, then Push. Workflow milestones allocate portions of the fill to preparation, transfer and import; the separately displayed percentage measures the named current phase, not total operation bytes. Unknown work uses a moving highlight. The action text remains above the buttons; measured speed and phase ETA appear only when available. Errors remain inline with expandable, bounded details. There is no separate transfer-progress panel or duplicate stage tags. Completed buttons briefly show a check and fade back to their idle appearance. New local edits clear Push success and add a pending dot. A Pull with no remote change and no outstanding local imports reports “Already up to date”.

## Trash and initial migration

Trash disappears from the latest version after Push; old Git commits keep the previous content. Local 30-day recovery can remain as a convenience. This is not a promise of historical erasure. The migration excludes existing Trash and Archive before the **first** Git commit. Shared prefixes still required by surviving paths are retained.

Run migration while the old service is stopped, to give it a stable source snapshot:

```
pnpm stop
pnpm migrate:git --remote git@github.com:owner/repository.git --prepare
pnpm migrate:git --remote git@github.com:owner/repository.git --publish
```

The staging directory defaults to `.grove/git-migration` (gitignored), and can be set with `--staging`. `--source` selects the old application library. Preparation copies SQLite through its backup API, reads the old cloud directory, reuses locally verified record caches, imports surviving cloud-only content, removes archived paths, and reports counts. `--local-only` intentionally omits the old cloud and is for installations with no cloud-only data. A prepared snapshot is reused on subsequent runs; to capture newer source changes, choose a new staging directory.

The source database, native agent files, old credentials and old WebDAV vault are left untouched. Only the prepared live graph and its referenced bodies enter Git. Recovery backups, SQLite, credential files, temporary files and discarded bodies are not committed. After publication, configure the live app with the new remote and Pull to apply deletion markers and import the remaining sessions. Old credentials may be retained locally for rollback; the Git runtime never reads them.

All devices must use version 0.15 or newer and the same data remote. A repository's private setting provides access control, not client-side encryption. Git retains history and ordinary fetch downloads reachable history; this intentionally favors easy local access over the old cloud-only storage model.

## Validation on 2026-09-30

- 181 automated tests passed, including eight Git/migration tests; both isolated browser suites passed.
- Initial migration excluded 76 archived branches and existing Trash. The published current state contains 141 sessions in 65 trees and 122,830 referenced records. Required shared prefixes remain.
- Reused 78,878 verified records from the previous transfer cache; no additional transcript bodies were needed from WebDAV. Its directory/manifests still had to be read once.
- Published plain files occupy about 1.1 GiB in the working tree; the local Git pack is 555,082,751 bytes (about 529 MiB). These are disk measurements, not billed network traffic.
- Reusing that checkout, first import into the live SQLite library took 15.34 seconds. A subsequent unchanged Pull took 2.45 seconds; unchanged Push (including Pull) took 2.44 seconds and created no new commit. Both left zero conflicts and zero pending changes.
- These timings measure this library and connection, with native scanning omitted in the isolated transfer invocation. They are not an equal-work benchmark against the former WebDAV cleanup operation or a guarantee for another network.

## Change summaries and identity

Pending uploads compare a compact semantic baseline with the current graph: session rename/move/add/remove, transcript append or rewrite, node rename/regroup/dissolve, context settings, and project metadata. These same captured changes generate the Git commit subject and body with project/session names. Changes made after the upload snapshot remain pending. Transcript append counts are native records, not model tokens or conversation turns.

Grove names are display aliases. UUIDs, native thread IDs, immutable revision IDs and message identities are independent of these names. Renaming does not schedule native rematerialization. Re-activating an unchanged native Claude session preserves its existing UUID chain instead of forking it again. Active endpoints show a green dot and offer Deactivate directly. Activation previews use the graph's complete Pending number, explain context capacity/compaction thresholds with labels, and put tool switching beside Confirm. General explanations belong in Information.
