# Testing and acceptance

Public tests use synthetic histories, disposable Git remotes and isolated browser profiles. They do not send model requests or publish personal transcripts. Historical validation reports describe their original versions, not the current test matrix.

## Commands

```sh
npm test
npm run test:browser
node scripts/ci-test.js --suite=core
node scripts/ci-test.js --suite=native
node scripts/ci-test.js --suite=git-1
node scripts/ci-test.js --suite=git-2
node scripts/ci-test.js --suite=browser-1
node scripts/ci-test.js --suite=browser-2
```

The Git and browser partitions are complete and nonoverlapping; `test/ci-plan.test.js` checks this. Windows runs expensive native/Git/browser groups separately. CI reports public test names and timings without uploading fixture contents. A pass on macOS does not establish Windows ACL or COM behavior; those cases run on Windows.

## Acceptance matrix

| Area | Required cases |
| --- | --- |
| History/identity | Native and Grove forks; shared, intermediate and endpoint prefixes; missing/corrupt/unsupported references; compressed segments and aliases; exact source preservation. |
| Activation | Root/middle/endpoint continuation; compaction before/after cutoff; unresolved tools; additive activation; deactivate/reactivate; active-file and collision protections; client links. |
| Organization | Manual/automatic names; no-op edits; partial/shared nodes; split boundaries; project moves/folding; date modes; inline editor save/cancel/stale rejection. |
| Smart Organization | Evidence isolation; request limits; opt-in defaults; manual ownership; imported completion; sync races; cached retries; Discard pause across restart/new messages and explicit resume. |
| Discard | Synced and never-synced organization edits; single/batch trees; stale selection and concurrent metadata; new messages/forks; unrelated project edits; no native writes or deactivation; retained client titles; incompatible project baselines. |
| Trash/recovery | Path/tree removal; shared ancestry; compressed source/index paths; backup verification; partial failures; expiry; repeat restore; no accidental activation. |
| Git | Initial/no-op Pull/Push; multiple devices; Unicode and byte fidelity; edits during transfer; offline verified baselines; cancellation/errors; archive/deletion propagation; conflicts. |
| UI/service | First use; optional sync; narrow/desktop layout; selection controls; drag targets; actual progress; failure dismissal; initialization/reconnect; terminal-independent service; startup setting rollback. |

## Real-library checks

Use a consistent SQLite backup and a new directory outside the live library. `scripts/real-discard-acceptance.js <library> <new-directory>` validates organization rollback while fingerprinting records, revision identities, fork boundaries and activation instances. `scripts/real-workspace-audit.js` and native equivalence scripts require their documented source arguments and disposable destinations; inspect their setup before running them.

Cover representative standalone sessions, branching trees, both available agents and archived/recovery histories. Include legal and rejected operations. Keep raw reports and personal identifiers outside Git. Live client/model tests require separate explicit authorization and must not be represented as public mock-test coverage.

## Performance

Use `npm run bench:store`, `npm run bench:local`, `npm run bench:ui` and `npm run bench:git`. Record cold/warm timings, corpus size, CPU/heap, filesystem/subprocess cost and event-loop responsiveness. CPU and I/O are resource proxies, not direct energy measurements. Optimize measured hotspots while retaining real progress for unavoidable work.

## Release checks

Follow [AGENTS.md](../AGENTS.md): accumulate fixes under Unreleased, keep the published version until release is requested, run appropriate tests, and verify cross-platform CI. A code push for another-device testing does not create a release.
