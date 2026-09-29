# Trash proposal — not enabled

Useful older work belongs in ordinary History projects. Throwaway work can use a separate Trash lifecycle. Local-only archive does not remove remote storage or other devices' copies.

Proposed behavior, awaiting the user's choice:

- Moving a whole path or tree to Trash publishes a small deletion marker across devices. The operation device retains a local-only recovery copy for 30 days. Other Grove caches are removed after receiving the marker.
- Shared prefix records remain while any kept path references them. A deleted path's unique suffix is eligible for cleanup.
- A running native session is not rewritten or removed silently; deactivate it before native cleanup.
- Existing Archived records are not automatically migrated, purged or reclassified.
- Show separate states for logical removal and completed storage cleanup. A restore creates a newer explicit operation and reuploads retained local content.

Safe implementation needs versioned deletion markers that defeat resurrection by offline devices, a stable snapshot of every device head, and validated reachability of immutable manifests/records. Packs may mix live and deleted records and must be rewritten with retained records before the old pack can be removed. Generation publication and conditional writes/locks must prevent races with uploads. Old clients must fail closed instead of republishing a deleted branch. Old native and cloud histories must not be deleted merely because an index row disappears.

The current changes do not perform this remote garbage collection or delete existing cloud data. Archive semantics must not be advertised as reclaiming space until these checks and multi-device recovery tests exist.
