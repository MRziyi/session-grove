# Technology choices

Session Grove uses JavaScript ES modules on Node.js 24+, Node's SQLite/HTTP/filesystem APIs, native Git over SSH, and a DOM/SVG browser interface. The Claude Agent SDK provides Claude session integration. Dependencies are pinned in `pnpm-lock.yaml`; there is no frontend build step.

SQLite is the local library and projection cache. Git receives plain session records and graph metadata, never the live SQLite database. Native agent formats remain the source of truth for resumable history. See [Git sync](git-sync.md).

Performance work targets measured costs: repeated parsing, large transient graph allocations, transaction boundaries, filesystem flushes, subprocess startup and redundant Git commands. Reconstructable Git cache writes do not force a disk flush per file; credentials and authoritative library writes retain durability.

On Windows, private writes restrict a fresh empty staging file with native `icacls` before writing content. Permission verification reads the current ACL rather than trusting a cached verdict. File-use checks continue to reject occupied native histories.

Measure local workloads with `pnpm bench:store` and `pnpm bench:git`. CPU, memory, I/O and elapsed time are proxies for resource use, not direct energy measurements.
