import { assert } from './util.js';
export const defaults = { showScheduledSessions: false, inactiveProjectDays: 30, localUpdateEnabled: true, localUpdateMinutes: 1, autoUploadEnabled: true, autoUploadMinutes: 15 };
export const preferences = store => ({ ...defaults, ...store.local('preferences') });
export function savePreferences(store, value) {
    const next = { ...preferences(store) };
    for (const k of ['localUpdateEnabled', 'autoUploadEnabled', 'showScheduledSessions']) if (k in value) { assert(typeof value[k] === 'boolean', 'Invalid timer setting.'); next[k] = value[k]; }
    for (const k of ['localUpdateMinutes', 'autoUploadMinutes']) if (k in value) { assert(Number.isInteger(value[k]) && value[k] >= 1 && value[k] <= 1440, 'Choose an interval from 1 to 1440 minutes.'); next[k] = value[k]; }
    if ('inactiveProjectDays' in value) { assert([7,15,30,60].includes(value.inactiveProjectDays), 'Choose 7, 15, 30 or 60 days.'); next.inactiveProjectDays = value.inactiveProjectDays; }
    store.local('preferences', next); store.invalidate(); return next;
}
