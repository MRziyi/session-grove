# Testing and acceptance

Public tests use synthetic histories, disposable Git remotes and isolated browser profiles. They do not send model requests or publish personal transcripts. Historical validation reports describe their original versions, not the current test matrix.

## Commands

```sh
npm test
npm run test:browser
node scripts/ci-test.js --suite=platform
node scripts/ci-test.js --suite=git
node scripts/ci-test.js --suite=unit
node scripts/ci-test.js --suite=browser-compat
node scripts/ci-test.js --suite=core
node scripts/ci-test.js --suite=native
node scripts/ci-test.js --suite=git-1
node scripts/ci-test.js --suite=git-2
node scripts/ci-test.js --suite=browser-1
node scripts/ci-test.js --suite=browser-2
```

Daily CI uses six jobs: Linux runs every unit/integration test and every browser flow; macOS and Windows repeat 18 platform-boundary files; Windows additionally runs all Git integration/output checks and the sync browser flow, including native-copy and Discard invariants. Pure logic and the other UI flows are not repeated on every OS. Push checks run on main and version tags; pull requests test working branches without also launching a duplicate branch-push run.

Version tags automatically expand macOS to all unit/integration files and Windows to the complete unit/Git and browser sets. Workflow dispatch offers the same expansion with the **full** checkbox. Every job remains blocking, including the release dependency; there are no automatic failure retries. Windows full `unit` plus `git` covers every test file exactly once. `test/ci-plan.test.js` also ensures all platform-conditional test files remain in daily desktop coverage. The older core/native, Git-case and browser partitions remain available for targeted local work.

Native PowerShell/COM and Git integration run without competing test-file workers inside their Windows job; the remaining platform files use at most three workers and browser flows run sequentially. CI reports public test names and timings without uploading fixture contents. A pass on macOS does not establish Windows ACL or COM behavior; those cases run on Windows. Hosted CI time savings require measurement after the workflow is pushed; local timings are not a prediction of runner duration.

Classify failures before reducing coverage: an interaction test reading stale UI state needs a readiness condition, while reproducible Git/filesystem failures can affect real libraries. Windows Git coverage includes hashed graph-part/media paths beyond MAX_PATH, interrupted writes and offline recovery without relying on global long-path configuration. Shortening test paths would hide that compatibility boundary. Keep platform behavior checks blocking; assess duplicated platform-independent assertions separately from them.

## Acceptance matrix

| Area | Required cases |
| --- | --- |
| History/identity | Native and Grove forks; shared, intermediate and endpoint prefixes; missing/corrupt/unsupported references; compressed segments and aliases; exact source preservation. |
| Activation | Root/middle/endpoint continuation; compaction before/after cutoff; unresolved tools; additive activation; deactivate/reactivate; active-file and collision protections; client links. |
| Organization | Manual/automatic names; no-op edits; partial/shared nodes; split boundaries; project moves/folding; date modes; inline editor save/cancel/stale rejection. |
| Active title prefixes | Multiple paths/agents; client name synchronization; prefix replacement and idempotence; unavailable clients; stale preview; concurrent manual names; lost write responses; partial rollback; conversation and logical-name preservation. |
| Smart Organization | Evidence isolation; request limits; opt-in defaults; manual ownership; imported completion; sync races; cached retries; Discard pause across restart/new messages and explicit resume. |
| Discard | Synced and never-synced organization edits; single/batch trees; stale selection and concurrent metadata; new messages/forks; unrelated project edits; no native writes or deactivation; retained client titles; incompatible project baselines. |
| Trash/recovery | Path/tree removal; shared ancestry; compressed source/index paths; backup verification; partial failures; expiry; repeat restore; no accidental activation; remain in a surviving tree; stale background reclamation plans. |
| Git | Initial/no-op Pull/Push; multiple devices; Unicode and byte fidelity; edits during transfer; offline verified baselines; cancellation/errors; archive/deletion propagation; conflicts. |
| UI/service | First use; optional sync; narrow/desktop layout; whole-tree search and result navigation; right-side message selection; opposite-edge ancestor chain, complete listing and scroll navigation; drag targets; actual progress; failure dismissal; initialization/reconnect; terminal-independent service; startup setting rollback. |

## Real-library checks

Use a consistent SQLite backup and a new directory outside the live library. `scripts/real-discard-acceptance.js <library> <new-directory>` validates organization rollback while fingerprinting records, revision identities, fork boundaries and activation instances. `scripts/real-workspace-audit.js` and native equivalence scripts require their documented source arguments and disposable destinations; inspect their setup before running them.

Cover representative standalone sessions, branching trees, both available agents and archived/recovery histories. Include legal and rejected operations. Keep raw reports and personal identifiers outside Git. Live client/model tests require separate explicit authorization and must not be represented as public mock-test coverage.

## Performance

Use `npm run bench:store`, `npm run bench:local`, `npm run bench:ui` and `npm run bench:git`. Record cold/warm timings, corpus size, CPU/heap, filesystem/subprocess cost and event-loop responsiveness. CPU and I/O are resource proxies, not direct energy measurements. Optimize measured hotspots while retaining real progress for unavoidable work.

For Trash, compare the same consistent library backup and path selection before and after a change. Include the following state refresh and measure event-loop heartbeat gaps separately from end-to-end latency. Tests that omit native copies do not measure native archive/removal costs. Check cached sync digests against fresh calculations across edits, forks, shared revisions, retention changes, rollback and reclamation.

For storage changes, pin one consistent real-library backup for both implementations. Compare canonical graph digests, native record hashes/bytes, identity counts, organization rollback and native materialization, including archived/shared histories. Measure cold/warm views, acknowledged and unacknowledged sync status, metadata-only Push reads, and encode/decode/Git packing separately. Record one-time migration cost separately from normal reads. Verify mixed legacy/packed values, cache rebuilds, interrupted maintenance, byte-exact recovery archives and idempotent repeat maintenance. Never benchmark against a moving live database or rewrite remote Git history to claim storage savings.

## Release checks

Follow [AGENTS.md](../AGENTS.md): accumulate fixes under Unreleased, keep the published version until release is requested, run appropriate tests, and verify cross-platform CI. A code push for another-device testing does not create a release.
