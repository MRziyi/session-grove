# Technology choices

Status: current implementation review and recommendation. No language migration is included in this change.

## Runtime and package manager are separate choices

Session Grove runs on **Node.js 24+**. Its current backend and frontend use **JavaScript ES Modules**, not TypeScript. The backend uses Node's HTTP, SQLite, filesystem, crypto and compression modules. The browser uses DOM and SVG.

**pnpm and npm both run the scripts in `package.json`.** Using pnpm does not replace the Node runtime. There are currently no third-party runtime or development dependencies and no build step, so no manual install step is needed to run the scripts. The repository uses `pnpm-lock.yaml` as its primary lockfile; it currently contains no external packages. npm can run the same scripts without generating a second lockfile.

See the official [pnpm run documentation](https://pnpm.io/cli/run) and [npm scripts documentation](https://docs.npmjs.com/cli/using-npm/scripts).

## Recommendation for this project

Keep Node.js for the current product iteration. Session Grove combines a changing browser UI, native session adapters, filesystem observation, SQLite and WebDAV. Reusing the existing JavaScript implementation and tests is currently more valuable than replacing the backend without measurements.

This is an engineering judgment for this project, not a claim that Node has the lowest memory use or highest throughput. No comparable Node / Go / Rust implementations have been benchmarked here. Gradual TypeScript adoption could improve maintainability of the graph, native schemas and sync contracts; that is a separate change and does not require replacing Node.

| Option | Reason to choose it | Tradeoff for Session Grove |
| --- | --- | --- |
| Node.js | Existing implementation, browser/backend language reuse, short UI iteration loop | Requires a Node runtime in the current distribution; synchronous work can block request handling |
| Go | Compiled executable distribution and built-in concurrency primitives | Backend rewrite and a separate language from the browser; SQLite driver choice affects native dependencies and build packaging |
| Rust | Native code, explicit memory ownership, and no garbage collector | A new backend implementation and additional ownership / async design work; attractive when measured CPU or memory limits justify it |

Go can build an executable independently of an installed Go toolchain on the destination; static linking and portability still depend on native dependencies and build configuration. See [Go's compile and install guide](https://go.dev/doc/tutorial/compile-install) and [concurrency guidance](https://go.dev/doc/effective_go#concurrency).

Rust's language design emphasizes performance and memory efficiency without a garbage collector. That characteristic alone does not establish that a Rust rewrite would make this particular app faster. See [the Rust project](https://rust-lang.org/).

## Current performance work comes before a rewrite

The implementation has identifiable hotspots:

- `src/native.js` reads and parses whole transcripts during discovery and collection, using synchronous filesystem calls.
- `src/store.js` reconstructs and parses branch history to build snapshots.
- `src/organization.js` compares cumulative history at completed checkpoints. Large histories need incremental signatures and cached comparisons.
- `src/sync.js` uses synchronous compression and scrypt key derivation.

These can delay the same process that serves the UI. Node's documentation explicitly discusses the cost of blocking its event loop and handling expensive work appropriately: [Don't block the event loop](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop).

Before choosing another language:

1. Measure discovery duration, update-to-UI latency, memory and API latency on representative session libraries, including unchanged scans and large histories.
2. Add change detection, incremental parsing, cached signatures and paginated conversation views.
3. Move expensive parsing / compression / key derivation off the request-handling thread where needed. Preserve ordered writes and recovery guarantees.
4. Re-measure. Consider Go if standalone distribution is the dominant requirement; consider Rust or a native module if CPU / memory limits remain dominant.

The benchmark and performance changes above are proposed next steps, not completed optimizations.
