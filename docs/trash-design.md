# Trash lifecycle (0.13)

> Git 技术分支（0.15）以 [Git 同步与迁移](git-sync.md) 为当前规范。下文 WebDAV、加密、按需下载及云端物理清理描述属于旧实现；该分支不再启用这些流程。

Trash is discarded work, not a history archive. Keep useful older sessions in Projects.

## User behavior

- Move a complete path or the visible paths of a tree to Trash. It disappears from in-use views immediately, including cached cloud listings.
- A private recovery copy stays on the operation device for **30 days by default**. Settings accepts 1–365 days and applies the choice to future discards. Expired copies are removed while Grove is running or on its next startup, independently of the local-update timer.
- Sync removes discarded conversation bodies from cloud storage. There is no cloud recovery period. Small identity/deletion markers remain so offline devices cannot resurrect the old identity.
- Shared context, native metadata and companion assets still required by kept paths remain. A whole discarded tree is not kept just to preserve its visible prefix.
- Restore creates **new session identities**, keeps logical labels, returns them to Projects and does not activate them. Recovery files are not uploaded.
- An unchanged cache on another device is removed after Sync. Genuinely unsynced local content is rescued locally before removal, without automatically republishing it.
- Existing **Previous archives** remain unchanged. Selecting them and choosing Move to Trash is an explicit migration.

The UI distinguishes **Waiting for Sync**, **Cloud removed · cleanup pending**, and **Cloud space reclaimed**. An error does not falsely report reclaimed space.

## Native copies

The explicit Trash action uses the existing native deactivation/archive path where it succeeds. Busy or changed native copies remain intact, with a cleanup entry in Trash. Background cloud cleanup does not write native stores. The explicit native-cleanup action requires the corresponding agent to be closed and checks its file identity/hash. Native forks still referencing a file, changed copies, and companion directories needing review are retained rather than removed blindly.

The recovery deadline governs Grove's recovery files. Independently retained native copies must be cleaned through this safe native path; it is not a promise to erase files still required by a native client. Successful native transaction journals shed their duplicate rollback payloads; unfinished journals remain recoverable.

## Cloud protocol and concurrency

**Every device needs Session Grove 0.13+ after the first Trash sync.** Trash upgrades the vault to schema 3 / retention version 1 and publishes schema-6 device heads. Older clients reject the new vault instead of writing stale sessions back.

The cleanup coordinator:

1. Acquires a depth-infinity write lock on the dedicated protocol collection and verifies that unaffiliated writes/overwrites are blocked. Lock tokens are tagged with the locked root URI, including descendant requests. The lease renews during long operations.
2. Reads all current device indexes, resolves retained branches and native prefix requirements, and stages a new generation containing only retained bodies. Existing archives are preserved even if newer visibility/upload policies would hide them.
3. Verifies staged records and manifests, publishes deletion markers, then switches the vault pointer under the lock.
4. Removes obsolete protocol directories/generations and compacts local object storage. Shared immutable revision identities remain for ancestry comparisons, with explicit retained-body ranges rather than keeping discarded suffixes.
5. Marks cleanup complete only after reclamation. A private cleanup journal supports retry after publication, including when another device has subsequently completed a newer generation.

HTTP 207 is not blanket success: embedded per-resource failures are checked. The implementation accepts no destructive fallback on providers that cannot enforce collection locking. The cloud operation is confined to the configured Session-Grove protocol namespace; unrelated DAV directories are untouched.

Staging can require temporary cloud space for retained data and can be substantial for a large vault. If it fails before publication, the prior generation remains authoritative. If cleanup fails afterward, the new generation stays usable and cleanup can be retried. Interrupted work can leave a temporary generation until retry; no failed attempt is represented as completed reclamation.

## Fidelity and validation

Conversation records retain their original bytes. Sparse manifests specify required ranges and additional native fork metadata. In particular, Claude can inherit metadata located after the chosen checkpoint; those referenced records are retained without keeping the discarded conversation suffix.

Tests cover shared-prefix reclamation, cloud-generation fencing, stale and divergent offline clients, configurable local expiry/startup expiry, legacy archives, native-copy guards, logical labels, HTTP 207 failures, lock renewal, interrupted cleanup and successive cleanup generations. The real Teracloud test uses only a newly created synthetic self-check folder and removes that folder afterward.

## 1.0.2 interface and restoration

Client archive and Trash are separate views. The archive entry appears above Trash only when there are client-archived histories. Deactivated Grove continuations and native leftovers of trashed histories do not belong to Client archive. Moving an inactive Grove session to Trash saves its recovery copy first, then removes the native copy when file-idle and shared-prefix checks allow it. Any blocked cleanup remains a stateful, retryable removal operation on the Trash item, never a new archive category.

Restoring Trash creates visible project sessions under new identities and navigates to Projects. Restoration clears staging/exclusion and archived flags on selected copies and does not activate a client or create a client archive entry. Recovery files and archived-only transcripts remain excluded from Git uploads.
