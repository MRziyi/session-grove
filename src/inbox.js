// A deterministic cloud container; locally, null still means not filed by the user.
export const INBOX_ID = '00000000-0000-4000-8000-000000000001';
export const inboxProject = () => ({ id: INBOX_ID, name: 'Ungrouped', builtin: 'ungrouped', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', metaVersion: 'grove-inbox-v1', metaAncestors: [], archived: false });
export const cloudProjectId = id => id || INBOX_ID;
