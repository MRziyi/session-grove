# Session Grove — Interaction model

Status: implemented in 0.4.0, following the two-page sketch and the confirmed rules below. Token/compaction visibility and cloud loading are detailed in [Context and sync](context-and-sync.md). This document supersedes earlier interface proposals and the conflicting collection/group terminology in `design.md`.

## Terms and invariants

| Term | Meaning |
| --- | --- |
| Session | A native Codex or Claude Code conversation that can be materialized and resumed. |
| Project | The sole membership container. “Group sessions” means assign their entire tree to a Project. |
| Ungrouped | No Project has been assigned. It is a section in a session list, never a second container inside a Project. |
| Tree | Related native sessions with a shared prefix, folded into one collection row. A standalone session also counts as one row. |
| Node | A named, consecutive segment of chats on a graph path. It can contain a single chat or many chats. |
| Pending | Chats that have not been assigned a Node. Pending segments can occur in the middle as well as at the end of a path. |
| Active | A native session actually present on this device. Desired but unapplied activation does not count. |
| Archived | History retained outside normal project lists. Archiving deactivates the selected sessions on this device. |

Project membership and content organization are independent: a session can belong to Chrono while most of its chats are still Pending. Activation is device-local; membership, archive metadata, raw history and logical organization are synchronized for filed projects.

A tree has exactly one Project or is entirely Ungrouped. Source devices, original paths and CLI/IDE information are provenance, not hierarchy. Synthetic prefix records are internal implementation details, never extra native sessions in counts or lists.

Ordinary conversations start in the native agent. Grove has no blank-session creator, independent empty-project creator, descriptions, or extra Project/Group/Ungrouped nesting. New projects are created atomically while filing selected content. An old project with no content is omitted from navigation; its metadata is retained for synchronization and recovery.

## Page 1: session lists

The horizontal banner contains Session Grove, Upload, Sync, Update, language switching, and Settings. English is the default; the language choice persists. Upload pushes filed projects; Sync exchanges project updates; Update collects native session changes immediately. WebDAV configuration/unlocking is available from Settings or the first sync action.

The left navigation has three sections:

1. **Current Active**: Codex and Claude Code, each with its own accent color and count of actual native sessions.
2. **Projects**: project names; each count is the number of collection rows, with an entire tree counting once.
3. **Archived**: archived projects and individual archived sessions, opened through the same list interface.

Selecting Codex or Claude Code displays “Active Codex Sessions” or “Active Claude Code Sessions”. The toolbar shows the native session count, a title/content search field and selection-dependent actions. Search matches full transcript content, including text collapsed in the reader, and returns the owning session/tree row. Search does not create duplicate rows for multiple matching messages.

Active sessions are grouped only by Project name or Ungrouped. Groups sort by their newest conversation update, descending. Rows within each group use the same ordering. Filing or naming a Node does not make an old conversation appear recently updated.

Rows contain a recognizable document/tree icon, the native title or family representative title, chat count for a standalone session or branch count for a tree, last conversation modification time, and a checkbox at the far right. Clicking a checkbox selects without navigating. Clicking the row opens Page 2. No fake “Shared context” session appears in this list.

Selection actions:

| Location/selection | Actions |
| --- | --- |
| Active, Ungrouped | Move to project; Archive |
| Active, already filed | Deactivate |
| Project | Archive selected rows; archive the entire project when all its rows are selected |
| Archived | Restore selected rows; restore an archived project |

Mixed filed/Ungrouped batch selections are disabled to keep Move and Deactivate unambiguous. Move assigns the whole selected tree, including inactive branches, to an existing or newly named Project. Moving does not change activation. Bulk Deactivate in Current Active affects only the currently selected agent's active sessions in the selected rows.

## Page 2: Transcript and Graph

The navigation narrows and a second narrow column retains the scoped session list. Both the originating category and selected row remain highlighted. The main area contains the item title, counters/actions, then Transcript on the left and a graph on the right. All categories open this same editor.

Counters describe the tree: number of native paths, number of unique chats with shared prefixes counted once, and number of unique Pending chats. A path picker identifies the native session whose full conversation is displayed in the Transcript.

### Transcript

- User messages align right; agent messages align left.
- Each chat has a selection checkbox. A segment checkbox selects its chats together.
- Long messages show their opening and closing text, with an explicit Expand/Collapse control.
- Colored segment backgrounds correspond to graph Nodes. Pending segments use a separate warm palette and dashed outlines; organized Nodes use cooler colors.
- Selecting a graph node on another branch switches to that branch's full Transcript, including its inherited prefix, and scrolls to the selected segment.
- Device/path history and compatibility information are available through Source & revisions.

### Graph

The graph is a top-to-bottom DAG of consecutive segments. A single session is a chain; native forks introduce splits. Automatically inferred shared history starts as Pending. Inherited history is represented once, and fork suffixes remain separate Pending segments until organized.

Node cards show title and chat count. Pending cards have warm tinted backgrounds and dashed borders. Colors are automatically allocated from a palette with different colors on neighboring nodes; Pending neighbors likewise use different warm colors. Translucent ribbons connect visible Transcript backgrounds to their actual graph cards. No manual color setting is exposed. Each Node also shows an explicitly approximate recorded-text token count, including recognized tools.

Opening a tree selects no Node and exposes no mutation buttons. Selecting an eligible complete-turn Node reveals Fork. Move and Archive are list-only actions. Clicking a path's endpoint reveals Activate or Deactivate for that native session. Two native sessions ending at the same shared node can be selected using the path picker. Activate always materializes that session's full latest context, including Pending. To continue from an earlier checkpoint, first Fork at a node ending on a completed native turn. Node boundaries themselves may occur between any two visible chats; native fork/materialization safety still uses complete-turn boundaries and preserves tool records.

### Combine and Dissolve

Checkbox selection exposes only legal actions: Combine for a continuous range without a fork crossing, Dissolve when selected chats have a named assignment, and Clear.

**Combine** requires consecutive chats on one path and asks for a Node title. It can consume portions of existing Nodes and Pending segments. Unselected portions retain their original titles. Combining across a real fork point is rejected; shared prefix organization applies to all paths referencing that prefix.

**Dissolve** removes the selected chats' Node assignments, leaving raw text unchanged. Those chats become Pending in place. A Node's remaining fragments survive, and empty Nodes disappear from the current view. Historical organization versions remain recoverable in the library.

Example:

```text
Before:   Context [5 chats] → Writing [5 chats]
Dissolve: Context [2] → Pending [3] → Writing [5]
Combine the last chat of Context, all 3 Pending, and first chat of Writing:
After:    Context [1] → Set up writing style [5] → Writing [4]
```

Edits carry the graph version the user selected against. If native content or another device's organization changed meanwhile, the operation fails with a refresh message instead of applying stale offsets.

## Native actions and archives

Activate asks for an existing local working directory and displays original device/path information. Deactivate removes the managed native instance while retaining the library's transcript and Project membership. No separate global “desired Active set” step is needed in the normal UI.

Native writes still use the adapter's cold-write guard, backups, schema checks and rollback. When the agent is running, an action reports that it could not be applied; it does not prematurely remove a list row or pretend activation succeeded. Changes are scoped to the selected native sessions, including native index updates.

Archiving a tree or Project retains its history and deactivates its affected sessions on this device before changing Archive metadata. Restoring filed work returns it to the Project without activating it. Restoring Ungrouped work requires selecting an existing Project or creating a new one, atomically with restoration; it never vanishes into an inaccessible inactive inbox. Restoring one session from an archived Project makes that Project available again while keeping its other archived sessions archived. Device Active selections never synchronize or activate remote sessions automatically.

## Storage and synchronization

The existing immutable raw JSONL revisions remain the materialization source. The editor adds immutable `layout` versions mapping stable semantic chat IDs to named annotations or explicit Pending. Shared chat IDs are inherited across frozen fork prefixes; raw native lines are not rewritten when combining or dissolving.

Legacy append-only named nodes are read as initial annotations. User edits layer over them. Automatically generated legacy shared-prefix nodes are displayed as Pending rather than pretending the user already named that work.

Sync graph schema 3 includes layout versions and their ancestry. Sequential changes fast-forward. Concurrent organizations retain both versions and require an explicit choice in Settings; resolution records both ancestors so the same conflict does not reappear on the next sync. Schema 1/2 imports remain readable. The 0.4.0 cloud directory protocol wraps these tree manifests; all writing devices should use 0.4.0 or later.

Filing and organization queue encrypted automatic WebDAV publication after configuration and unlock; ordinary native chat growth only updates local Pending. Manual Upload can publish that Pending. Unconfigured, locked, and retrying states do not imply successful upload. Ungrouped history remains on the originating device. Discovery and capture continue in the background; Update performs immediate collection. Directory checks are independent of upload. Projects load their indexes on open; trees load missing/updated transcripts on open.

## Verification

- Actual native Active counts exclude synthetic records, missing files, and desired-but-unapplied sessions.
- Project counts fold each tree once; full-text search returns its owning row.
- Shared-prefix edits appear on every inheriting path, including native forks discovered after filing.
- Arbitrary chat-level Combine/Dissolve preserves raw records and allows middle Pending segments.
- Stale, discontinuous and cross-fork combinations are rejected.
- Project creation and batch filing are atomic, with no empty project entry point.
- Native Activate/Deactivate and Archive are scoped; failed native writes preserve the previous UI state.
- Browser checks cover both pages, language persistence, search, branch switching, node edits, filing, native actions, Archive and narrow screens.
