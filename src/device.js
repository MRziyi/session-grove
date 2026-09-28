import os from 'node:os';
import { execFileSync } from 'node:child_process';
let cached;
export function deviceDetails() {
    if (cached) return cached;
    const platform = process.platform; let model = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'Mac' : 'Linux';
    if (platform === 'darwin') {
        try { const info = JSON.parse(execFileSync('/usr/sbin/system_profiler', ['SPHardwareDataType', '-json'], { encoding: 'utf8', timeout: 3000 })); model = info.SPHardwareDataType?.[0]?.machine_name || model; } catch {}
    }
    return cached = { name: os.hostname(), platform, model, kind: /book|laptop|notebook/i.test(model) ? 'laptop' : 'desktop' };
}
export function contentOrigin(store, revisionId) {
    return store.memo('origin:' + revisionId, () => {
        let r = store.get('revision', revisionId), seen = new Set();
        while (r.parent && ['fork', 'shared-prefix', 'native-fork-snapshot', 'native-settings'].includes(r.source?.operation) && !seen.has(r.id)) { seen.add(r.id); r = store.get('revision', r.parent); }
        const s = r.source || {}, here = s.deviceId === store.device.id ? store.device : {};
        return { id: s.deviceId || null, name: here.name || s.deviceName || 'Unknown device', model: here.model || s.deviceModel || null, platform: here.platform || s.devicePlatform || null, kind: here.kind || s.deviceKind || (/book|laptop/i.test(s.deviceName || '') ? 'laptop' : 'desktop'), observed: s.operation === 'import' };
    });
}
