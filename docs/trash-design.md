# Trash and recovery

Trash records deletion identities separately from retained history. Shared prefixes needed by surviving paths remain readable. Recovery copies stay local and expire according to Settings; restored sessions receive safe identities so old deletion markers cannot erase them again.

Git Push includes deletion markers and removes deleted/currently excluded sessions from the latest snapshot. Git history can still retain prior commits and their contents; Trash does not promise physical erasure from repository history. No remote history rewriting or force-push is performed.

Moving native copies requires an unchanged-file check and applicable client/file protections. Failed or interrupted operations preserve recoverable data. Native activation is never propagated to another device.

Local discard restores a verified acknowledged Git baseline without a network request. See [Git sync](git-sync.md) and [operations](operations.md).
