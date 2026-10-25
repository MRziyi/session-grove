# Sync policy

Git over SSH is the only sync transport. See [repository format and reconciliation](git-sync.md).

- Update captures native history locally. Pull imports the current repository without uploading. Push pulls first, then publishes captured local changes with a normal fast-forward commit.
- Automatic Push is opt-in. A countdown exists only while work is pending; repeated status reads do not restart it. There is no background Pull.
- Local rename, activation, browsing and recovery remain available during network transfers. Mutations made after the captured upload snapshot stay pending.
- Native activation, credentials, recovery copies and SQLite files are device-local. Git stores session records, graph metadata and deletion identities.
- Failed manual transfers retain an actionable error until retry. Automatic failures back off. Cancellation preserves verified local work; conflicts require an explicit choice.
- Progress identifies the current phase and completed work. Unknown-size operations stay indeterminate; an estimate for one stage is not an estimate for the whole transfer.

Unit and integration tests cover concurrent local edits, rejection of stale pushes, no-op transfers, interrupted imports, Trash propagation and offline discard. Browser tests cover progress, cancellation, reconnection and local actions during transfers.
