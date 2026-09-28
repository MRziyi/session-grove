import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { codexSample } from '../src/demo.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-benchmark-'));
const store = new Store(path.join(root, 'data')), roots = { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') };
try {
    fs.mkdirSync(path.join(roots.codex, 'sessions'), { recursive: true });
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(roots.codex, 'sessions', `sample-${i}.jsonl`), codexSample(root, Array.from({ length: 20 }, (_, j) => [`Session ${i}, question ${j}`, `A complete answer for session ${i}. ` + 'Sample context. '.repeat(15)])));
    const native = new Native(store, { roots, guard: () => {} }); native.refreshLocal();
    const measure = (name, fn, count = 3) => { fn(); const start = performance.now(); for (let i = 0; i < count; i++) fn(); return [name, Math.round((performance.now() - start) / count * 100) / 100]; };
    const result = Object.fromEntries([measure('unchangedScanMs', () => native.refreshLocal()), measure('snapshotMs', () => store.snapshot()), measure('graphMs', () => store.treeGraph(store.all('branch')[0].id))]);
    result.snapshotBytes = Buffer.byteLength(JSON.stringify(store.snapshot())); result.sessions = 40; result.chatsPerSession = 40;
    console.log(JSON.stringify(result));
} finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
