# Session Grove interaction model

Implemented in 0.8.0. This document supersedes earlier interface proposals. The product workflow is in the README; runtime and diagnosis details are in [operations.md](operations.md).

## Terms

- **Session**: one native conversation that can be resumed.
- **Project**: the single membership container. A tree belongs to one Project or is Ungrouped. Source devices and working paths are provenance, not hierarchy. Native `name` is preferred over internal preview `title`. Agent-owned/guardian and zero-chat records are not managed as independent sessions.
- **Tree**: related sessions with a shared prefix, folded into one list entry.
- **Node**: a named consecutive stretch of chats. It can contain one or many messages.
- **Pending**: recorded chats not yet assigned to a named Node; may appear in the middle or at a path's tail.
- **Active**: actually available in the native client on this device. Device-local; not the same as “in use”.
- **In use**: unarchived paths, including paths not currently activated.
- **Archived**: retained complete paths outside the in-use view.

Ordinary conversations start in the agent. Grove has no blank-session creator, empty-project creator, descriptions or additional Group container. New Projects are created while filing existing sessions. Internal synthetic prefix records do not count as native sessions.

## Navigation and list page

The application bar contains **Sync**, **Update**, and **Settings**.

- Update refreshes native session capture without cloud publication.
- Sync publishes unsent changes, including Pending, and checks the cloud directory. Its tooltip shows last upload/check times.
- Settings contains Language, a staged WebDAV/encryption form and automatic-update intervals. About and Information live at the sidebar bottom; Information contains action help and diagnostics. There is no separate top-level language or Upload button.

Navigation has Current Active (Codex / Claude Code with native-session counts), Projects (one count per tree or standalone session), and Archived. Named projects are omitted when empty; the built-in Ungrouped inbox remains visible. Current Active groups entries only by Project or Ungrouped, ordered by latest conversation activity.

List rows show the title, chat/branch count for the applicable paths, activity time, cloud state and an optional selection box. Archived has no bulk selection boxes. Search covers titles/content; cloud searches can fetch the content required for the query.

Selection actions are deliberately separate from graph actions:

| Selection | Available action |
| --- | --- |
| Ungrouped rows | Move to an existing/new Project |
| Project rows | Move the selected whole trees to another Project |
| Filed Current Active rows | Deactivate the selected currently active native sessions |
| No rows / Archived rows | Open/read only |

Moving assigns the whole tree, including archived paths, without changing activation. Mixed filed/Ungrouped selections in Current Active are disabled so the action is unambiguous.

## Transcript and Graph

The detail page narrows the original navigation and list into two rails. Transcript and Graph are framed panels with aligned, narrow gutters. The title area carries the agent, approximate path token count and compaction count when present; there is no separate Context button. Source opens recorded device/path provenance.

The graph is top-to-bottom. Colored ribbons connect graph Nodes with their Transcript spans. Pending uses darker translucent hues and dashed borders; colors are automatic. The Transcript path picker has room for session names and only includes paths belonging to the current view.

No Node is selected automatically on entry. Selecting a graph Node switches to its path if necessary and clears transcript range selection. Clicking a Transcript segment label focuses its corresponding graph Node.

### Continuous range selection

Click one chat as the start, then another as the end; all chats between them are selected. Clicking the same chat twice selects just that chat. A new click after completing a range begins a new range; Shift-click adjusts its end. The range hint shows the endpoints. The server independently rejects discontinuous selections.

Until an end is chosen, only Clear is available. With a completed range:

- **Combine** appears only for a continuous range that does not cross an existing fork boundary. It asks for a Node title.
- **Dissolve** appears only when the range includes named content. It returns those chats to Pending and preserves unselected fragments.
- **Clear** leaves the content unchanged.

Existing fork boundaries remain meaningful even if a sibling path is currently archived. Shared-prefix organization applies to all paths referencing that prefix.

### Graph selection actions

| Condition | Action |
| --- | --- |
| Selected in-use Node | Rename |
| Selected Pending Node | Rename; saving its title creates a named Node |
| Selected in-use Node ends at a complete native turn | Fork |
| Selected endpoint of an inactive path with a supported materialization or unchanged native copy | Activate |
| Selected endpoint of an active path | Deactivate |
| Selected endpoint of an in-use path | Archive that one complete session |
| Selected endpoint of an archived path | Restore |
| Archived content | No Rename, Fork, Combine or Dissolve |

Rename works on the selected segment; an unchanged title does not create a new layout or upload. Fork pins an immutable native checkpoint and does not activate automatically. Activation uses the entire latest path, including Pending. It checks local configuration/recorded context usage and requires acknowledgement for a near-limit warning. Unknown limits are not guessed.

## Path-specific archive projection

Archiving requires selecting the endpoint of the current session, not an arbitrary intermediate Node. It affects that session, not every branch sharing its root. Native deactivation must succeed before Archive metadata changes.

The in-use and archive views are projections of the same immutable underlying graph:

1. In-use includes only unarchived paths. Nodes/edges not referenced by any remaining path disappear from that view.
2. Archived includes only archived paths, each with its complete shared prefix. It never adds live siblings to the path picker or Transcript.
3. Shared nodes retain stable identities and fork boundaries. No transcript prefix is deleted merely because one path stops referencing the in-use view.
4. Restoring returns a filed path to its Project without activation. An Ungrouped archived path returns to the shared Ungrouped inbox without activation.
5. Empty projections return to the list rather than displaying stale details. The stored graph and raw history remain intact.

Historical whole-project archives are still readable/restorable. The normal UI does not offer a duplicate bulk Archive action; individual session Archive lives at the graph endpoint.

## Updates, sync and feedback

New complete JSON records extend Pending locally, including during an ongoing turn. Organizing, filing, renaming, Grove forks and archive/restore changes queue the affected tree for upload after a short debounce. Manual Sync can publish unfinished Pending. Automatic directory checks and lazy loading remain independent of native Active choices.

All graph edits carry a version to reject stale selections. Native compatibility and cold-write guards remain in force. A failed action keeps its error visible with a reference code; Information offers diagnostic export without conversation text or credentials.


## Compaction choices and graph navigation

Compaction switches are stored per path. The Transcript boundary and its graph-edge badge control the same choice. Enabling a boundary grays earlier Nodes superseded by that path's latest enabled compaction. Disabling it restores their normal appearance. This is a preview until Activate or Apply context succeeds; another path's choice is unchanged. Source history is retained in both cases. A later native auto-compaction is a new boundary, enabled by default.

For a changed active path, Apply context uses the cold-write guard and backup journal. Adopted native data is preserved while a compatible local continuation is rebuilt. Unknown formats or unavailable pre-compaction history are rejected rather than guessed. See [context details](context-and-sync.md).

The graph has a dotted canvas. Drag its background to pan, use the controls or Ctrl/Command-wheel to zoom, and Reset to return to the root. Only fully visible graph cards connect to visible Transcript spans. Compact path/language/project selectors share one keyboard-accessible popover style.

Scope changes immediately clear the prior detail view. Request tickets reject late responses from a previously selected view, so an in-use path picker cannot reappear under Archived. Empty projections also clear all stale controls.

Local Active requires an available working directory. A historical session whose directory no longer exists remains in the library; a filed path can still be activated into a different directory. No native file is deleted by discovery filtering.


## Staged settings

The URL field combines an editable server base and a fixed `/Session-Grove/` suffix. The Verify action appears only after credentials are present. Successful write/read/delete verification freezes those fields and reveals optional encryption. Confirming encryption freezes its masked field and shows a green encrypted status, or a yellow unencrypted status. Modify reopens the relevant step. Masked saved values are not returned as secrets to the browser.

Migration reports actual copy/verification counts, publishes a conditional vault pointer only after verification, and then cleans the enumerated previous copies. A failed or interrupted settings change exposes a recovery action. Pause other writing devices while migrating; they must reconnect afterward. Connection changes to a different provider retain the old provider as a recovery source.

Local capture defaults to 1 minute; dirty-project fallback defaults to 15 minutes. Each can be disabled. Before every upload the service captures local records, independently of the timer schedule. A no-change fallback sends no cloud requests. Manual Sync checks the directory even without local changes.

Transcript renders safe Markdown, with non-prose activity in collapsible sections. Named file arguments are displayed as paths; shell previews are not misrepresented as a complete list of accessed files. Clicking an activity opens its recorded content. The token breakdown distinguishes estimates from native usage and explicitly identifies opaque/non-text content.


## Shared inbox and provenance (0.8)

Ungrouped is a permanent home for everyday sessions. It appears under Projects and synchronizes with the same indexed/lazy protocol. Locally its membership stays null; the wire format uses a deterministic built-in project identity, decoded back to null on merge. Moves preserve the whole tree and update the old/new project indexes. Restoring an unfiled archive no longer asks for a project.

The inbox groups entries into Last 7 days, Last 30 days and Older. Older rows are constructed only when expanded; search covers all dates. Selected inbox rows offer Move and Archive. Nothing is automatically classified, archived or deleted.

Tool badges appear on rows and graph Nodes. Shared prefix Nodes retain their original tool; a tree with actual multiple tools can display Mixed. Last-device badges follow content revisions, not title/Node edits or activation. Imports are labeled as observed/imported sources when the historical writing device is unknown.

Remote archive metadata does not silently remove a still-running native copy. Current Active shows an explicit pending-deactivation notice and action until that local copy is deactivated.

Countdowns use server-provided deadlines and a local one-second clock. No HTTP or WebDAV request is made by a tick. The clock pauses for hidden pages and when neither timer has a deadline. A small status endpoint replaces repeated full-library polling.

## 0.8.1 refinements

- New installation: an empty list explains Update (local) and configure WebDAV → Sync (cloud). Each subsystem starts automatically only after its first explicit action.
- Existing encrypted vault: current passphrase + Unlock, followed by locked configured state and optional Modify. New encryption is a separate later action.
- Update/Sync animate during real work, including timers, then show a transient success/error mark. Manual no-change Sync confirms the directory is current without uploading.
- Fork ends at a complete native checkpoint; if trailing chats are unfinished, the confirmation makes the cutoff explicit. Every new fork has a selectable, zero-chat Pending endpoint.
- Tool/device labels are compact pills. Scheduled/background sessions are hidden by provenance by default, with a Settings filter applied on Update; title keywords are not used to guess automation.
- Reasoning with encrypted content but no text says “no readable summary, original preserved.” Expanded context records are bounded and paged, while storage and activation keep original contents.
