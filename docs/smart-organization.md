# Smart Organization

Session organization, node naming and transcription-title updates are independent opt-in settings using the model configured in `src/intelligence-api.js`. An API key is required. Public settings expose only its presence; keys stay outside Git export.

## Evidence and triggers

- Session naming uses the Session's beginning: the first effective human request and its matching reply. New Ungrouped classification also receives project names and a short working-directory hint.
- Node naming uses evidence within the node boundary. Closed unnamed segments, including supported compaction boundaries, can be named; changing open tails do not cause continuous renaming.
- Transcription auto-renaming is off by default. New structural nodes can trigger it using completed user requests and concise assistant results. Identical evidence reuses cached results; enabling the option does not bulk-rename existing paths.

Client metadata, tool output, errors and opaque reasoning are not substitutes for human naming evidence. Human requests remain complete; long assistant prose is shortened. Completion provenance follows incoming synced metadata rather than causing another paid request on each device.

## Ownership and concurrency

Manual labels remain authoritative. Logical Session names and native transcription titles are independent. Native title synchronization uses compatible client APIs and refresh support; unavailable clients or stale paths produce explicit outcomes. Grove does not edit native transcript bytes to rename a title.

Settings controls request concurrency and spacing. Naming waits while synchronization reconciles incoming metadata. Path changes invalidate stale plans, cached results can be reused, and archived waiting jobs are removed. Native title changes are verified and rolled back when application fails.

## Discard and resume

Organization-only Discard restores Grove labels, grouping, project assignment and context preferences. It preserves client titles and conversation content. Affected automatic organization is paused across refresh, restart and new messages, preventing discarded labels from immediately reappearing.

The existing attention indicator opens Settings, where Continue explicitly resumes paused work. Removing the API key disables requests and cancels pending tasks. Genuine provider/client failures remain actionable; routine stale-path races do not permanently stop unrelated jobs.
