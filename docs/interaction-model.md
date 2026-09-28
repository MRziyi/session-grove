# Session Grove interaction model

Implemented in 0.5.0. This document supersedes earlier interface proposals. The product workflow is in the README; runtime and diagnosis details are in [operations.md](operations.md).

## Terms

- **Session**: one native conversation that can be resumed.
- **Project**: the single membership container. A tree belongs to one Project or is Ungrouped. Source devices and working paths are provenance, not hierarchy.
- **Tree**: related sessions with a shared prefix, folded into one list entry.
- **Node**: a named consecutive stretch of chats. It can contain one or many messages.
- **Pending**: recorded chats not yet assigned to a named Node; may appear in the middle or at a path's tail.
- **Active**: actually available in the native client on this device. Device-local; not the same as “in use”.
- **In use**: unarchived paths, including paths not currently activated.
- **Archived**: retained complete paths outside the in-use view.

Ordinary conversations start in the agent. Grove has no blank-session creator, empty-project creator, descriptions or additional Group container. New Projects are created while filing existing sessions. Internal synthetic prefix records do not count as native sessions.

## Navigation and list page

The application bar contains **Update**, **Sync**, and **Settings**.

- Update refreshes native session capture without cloud publication.
- Sync publishes unsent filed changes, including Pending, and checks the cloud directory. Its tooltip shows last upload/check times.
- Settings contains Language, WebDAV connection/unlock, action help and diagnostic export. There is no separate top-level language or Upload button.

Navigation has Current Active (Codex / Claude Code with native-session counts), Projects (one count per tree or standalone session), and Archived. A project is omitted when it has no content. Current Active groups entries only by Project or Ungrouped, ordered by latest conversation activity.

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
| Selected endpoint of an inactive in-use path | Activate |
| Selected endpoint of an active filed path | Deactivate |
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
4. Restoring returns a filed path to its Project without activation. An Ungrouped archived path must be assigned to a Project during restoration, so it has a visible destination.
5. Empty projections return to the list rather than displaying stale details. The stored graph and raw history remain intact.

Historical whole-project archives are still readable/restorable. The normal UI does not offer a duplicate bulk Archive action; individual session Archive lives at the graph endpoint.

## Updates, sync and feedback

New completed native work extends Pending locally. Organizing, filing, renaming, Grove forks and archive/restore changes queue the affected filed tree for upload after a short debounce. Manual Sync can publish unfinished Pending. Automatic directory checks and lazy loading remain independent of native Active choices.

All graph edits carry a version to reject stale selections. Native compatibility and cold-write guards remain in force. A failed action keeps its error visible with a reference code; Settings offers diagnostic export without conversation text or credentials.
