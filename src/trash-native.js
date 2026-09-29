import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assert, atomic, inside, safePath, hash } from './util.js';
import { isTrashed, cleanupLocal } from './trash.js';
import { codexFiles } from './codex-history.js';
// Explicit user action only. Native files are never touched by background cloud GC.
export function removeTrashNativeCopies(store, native, branchIds) {
    const selected = new Set(branchIds),
        instances = store.instances(),
        targets = instances.filter((i) => selected.has(i.branchId) && isTrashed(store, i.branchId));
    assert(targets.length, 'No native Trash copies to remove.');
    native.guard([...new Set(targets.map((i) => i.agent))]);
    const blocked = [],
        removed = [];
    for (const i of targets) {
        if (!i.file || !fs.existsSync(i.file)) {
            i.applied = false;
            i.desired = false;
            i.missing = true;
            i.baseline = null;
            removed.push(i.id);
            continue;
        }
        assert(
            inside(native.roots[i.agent], i.file) ||
                inside(path.join(store.root, 'parked'), i.file),
            'Native copy is outside managed storage.',
        );
        safePath(inside(store.root, i.file) ? store.root : native.roots[i.agent], i.file);
        if (i.observedHash && hash(fs.readFileSync(i.file)) !== i.observedHash) {
            blocked.push({
                instanceId: i.id,
                reason: 'Native history changed after Trash. Keep this copy for review.',
            });
            continue;
        }
        if (i.agent === 'codex') {
            let referenced = false;
            for (const file of codexFiles(native.roots.codex)) {
                if (file === i.file) continue;
                const fd = fs.openSync(file, 'r');
                const buffer = Buffer.alloc(262144);
                let size;
                try {
                    size = fs.readSync(fd, buffer, 0, buffer.length, 0);
                } finally {
                    fs.closeSync(fd);
                }
                const line = buffer.subarray(0, size).toString().split('\n')[0];
                try {
                    const meta = JSON.parse(line)?.payload;
                    if (
                        meta?.history_base?.thread_id === i.nativeId ||
                        (meta?.history_base?.thread_id &&
                            path.basename(i.file).includes(meta.history_base.thread_id))
                    ) {
                        referenced = true;
                        break;
                    }
                } catch {
                    referenced = true;
                    break;
                }
            }
            if (referenced) {
                blocked.push({
                    instanceId: i.id,
                    reason: 'Native forks still reference this file.',
                });
                continue;
            }
            const file = path.join(native.roots.codex, 'state_5.sqlite');
            if (fs.existsSync(file)) {
                const db = new DatabaseSync(file);
                try {
                    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
                    const row = db
                        .prepare('SELECT rollout_path FROM threads WHERE id=?')
                        .get(i.nativeId);
                    assert(
                        !row ||
                            !row.rollout_path ||
                            path.resolve(row.rollout_path) === path.resolve(i.file),
                        'Native thread moved. Update before removing it.',
                    );
                    db.prepare('DELETE FROM threads WHERE id=?').run(i.nativeId);
                } finally {
                    db.close();
                }
            }
        } else {
            const companions = path.join(path.dirname(i.file), i.nativeId);
            if (fs.existsSync(companions) && fs.readdirSync(companions).length) {
                blocked.push({
                    instanceId: i.id,
                    reason: 'Native companion files are retained for manual review.',
                });
                continue;
            }
            const index = path.join(path.dirname(i.file), 'sessions-index.json');
            if (fs.existsSync(index)) {
                const data = JSON.parse(fs.readFileSync(index, 'utf8'));
                if (Array.isArray(data.entries)) {
                    data.entries = data.entries.filter((e) => e.sessionId !== i.nativeId);
                    atomic(index, JSON.stringify(data));
                }
            }
        }
        const index = path.join(
            native.roots[i.agent],
            i.agent === 'codex' ? 'session_index.jsonl' : 'history.jsonl',
        );
        if (fs.existsSync(index)) {
            const lines = fs
                .readFileSync(index, 'utf8')
                .split('\n')
                .filter(Boolean)
                .filter((line) => {
                    try {
                        const v = JSON.parse(line);
                        return (i.agent === 'codex' ? v.id : v.sessionId) !== i.nativeId;
                    } catch {
                        return true;
                    }
                });
            atomic(index, lines.length ? lines.join('\n') + '\n' : '');
        }
        fs.rmSync(i.file);
        i.applied = false;
        i.desired = false;
        i.missing = true;
        i.baseline = null;
        removed.push(i.id);
    }
    store.local('instances', instances);
    cleanupLocal(store);
    return { removed: removed.length, blocked };
}
