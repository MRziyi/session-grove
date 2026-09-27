# Changelog

## 0.2.0

- Default English interface, persistent Chinese switch, and localized forms / status labels.
- Local Active above cloud projects; automatically observe native sessions without changing their visibility.
- Infer unfiled fork families from exact completed history prefixes, scoped to the same Agent and working directory.
- Project collections with groups, standalone sessions and tree entries. Only forked items open a branch graph.
- Named logical work nodes separate from native threads. New interaction accumulates in a stable Pending tail.
- Commit successive complete-turn ranges from Pending, preserving remaining messages and immutable checkpoints.
- Move an entire session or fork family into a project; local-only data stays out of cloud exports.
- Automatic encrypted project sync after connection/unlock, queued offline changes, and retry status.
- Logical-node chains synchronize independently of message capture; concurrent organization is retained as an explicit choice.
- Schema 2 cloud manifests retain compatibility with schema 1. Existing local branches migrate to initial logical nodes.

## 0.1.0

- Project-centered local session library, branching, explicit Active set, native adapters, and encrypted WebDAV transport.
- Initial baseline commit: `0bf5956`.
