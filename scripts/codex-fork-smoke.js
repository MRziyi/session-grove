// Explicitly selected native history only. Private copies are removed afterward;
// no auth/config is copied and no model turn is submitted.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { connect } from './native-rpc.js';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { parse } from '../src/transcript.js';
import { codexFiles, readCodexHistory, supportedHistory } from '../src/codex-history.js';
import { hash } from '../src/util.js';
const [sourceHome, threadId] = process.argv.slice(2), expanded = process.argv.includes('--expand');
assert(sourceHome && /^[a-f0-9-]{36}$/.test(threadId || ''), 'Usage: node scripts/codex-fork-smoke.js CODEX_HOME THREAD_ID [--expand]');
const index = new DatabaseSync(path.join(sourceHome, 'state_5.sqlite'), { readOnly: true });
const source = index.prepare('SELECT rollout_path FROM threads WHERE id=?').get(threadId); index.close(); assert(source, 'Native thread not found.');
const originals = codexFiles(sourceHome), full = readCodexHistory(source.rollout_path, originals), parsed = parse(full, 'codex');
assert(supportedHistory(parsed) && parsed.complete && parsed.checkpoints.length, 'Choose a complete supported native history.');
const ids = new Set([threadId, ...parsed.records.filter(r => r.value?.type === 'session_meta').flatMap(r => [r.value.payload.id, r.value.payload.history_base?.thread_id]).filter(Boolean)]);
const files = originals.filter(f => [...ids].some(id => path.basename(f).includes(id))), originalHashes = files.map(f => hash(fs.readFileSync(f)));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-fork-compare-')); fs.chmodSync(root, 0o700);
const home = path.join(root, 'native'), directory = path.join(home, 'sessions', '2026', '01', '01'); fs.mkdirSync(directory, { recursive: true });
for (const file of files) fs.copyFileSync(file, path.join(directory, path.basename(file)));
const store = new Store(path.join(root, 'library')), native = new Native(store, { roots: { codex: home, claude: path.join(root, 'claude') }, guard: () => {} });
let client, phase = 'start';
const digest = value => hash(JSON.stringify(value) ?? "undefined");
async function items(id) { let cursor, all = []; for (let n = 0; n < 100; n++) { const r = await client.request('thread/items/list', { threadId: id, limit: 100, sortDirection: 'asc', ...(cursor ? { cursor } : {}) }); all.push(...r.data); if (!r.nextCursor) return all; cursor = r.nextCursor; } throw new Error('Pagination limit reached'); }
const resume = id => client.request('thread/resume', { threadId: id, excludeTurns: true, cwd: root, approvalPolicy: 'on-request', sandbox: 'read-only' });
try {
    client = connect('codex', home); await client.init(); await resume(threadId);
    phase = 'native fork'; const forked = await client.request('thread/fork', { threadId, excludeTurns: true, lastTurnId: parsed.checkpoints.at(-1).turnId, cwd: root, approvalPolicy: 'on-request', sandbox: 'read-only' });
    const nativeItems = await items(forked.thread.id); assert(nativeItems.length > 0, 'Native fork has no projected items.'); await client.close(); client = null;
    phase = 'grove fork'; const parent = store.branch(null, 'Comparison source', 'codex', full);
    if (expanded) { assert(parsed.context.compactions.length, 'No compaction to test.'); for (const event of parsed.context.compactions) if (event.canDisable) store.setCompaction(parent.id, { head: parent.head, eventId: event.id, enabled: false }); }
    const branch = store.fork(parent.id, { name: 'Comparison fork', end: parsed.checkpoints.at(-1).end }); native.setActive(branch.id, root, true); native.apply([branch.id]);
    const instance = store.instances().find(i => i.branchId === branch.id && i.applied);
    client = connect('codex', home); await client.init(); await resume(instance.nativeId); const groveItems = await items(instance.nativeId);
    const state = new DatabaseSync(path.join(home, 'state_5.sqlite'), { readOnly: true }), nativeFile = state.prepare('SELECT rollout_path FROM threads WHERE id=?').get(forked.thread.id).rollout_path; state.close();
    const originalFork = parse(readCodexHistory(nativeFile, codexFiles(home)), 'codex'), groveFork = parse(fs.readFileSync(instance.file, 'utf8'), 'codex');
    const payloads = (p, type) => p.records.filter(r => r.value?.type === type).map(r => r.value.payload);
    phase = 'compare'; assert.equal(digest(nativeItems), digest(groveItems), 'Native projected items differ.');
    assert.equal(digest(payloads(originalFork, 'response_item')), digest(payloads(groveFork, 'response_item')), 'Model-history items differ.');
    assert.equal(digest(payloads(originalFork, 'world_state')), digest(payloads(groveFork, 'world_state')), 'Recorded world state differs.');
    for (const field of ['base_instructions', 'developer_instructions', 'dynamic_tools']) assert.equal(digest(originalFork.meta[field]), digest(groveFork.meta[field]), 'Recorded prompt metadata differs.');
    if (expanded) assert.equal(groveFork.context.compactions.length, 0);
    else assert.equal(digest(payloads(originalFork, 'compacted')), digest(payloads(groveFork, 'compacted')), 'Compaction payloads differ.');
    let toggleRoundTrip = false;
    if (expanded) {
        phase = 're-enable compaction'; await client.close(); client = null;
        for (const event of parsed.context.compactions) if (event.canDisable) store.setCompaction(branch.id, { head: branch.head, eventId: event.id, enabled: true });
        native.setActive(branch.id, root, true); native.apply([branch.id]);
        const restored = store.instances().find(i => i.branchId === branch.id && i.applied);
        assert.notEqual(restored.nativeId, instance.nativeId, 'A context replacement must get a fresh native projection.');
        client = connect('codex', home); await client.init(); await resume(restored.nativeId);
        assert.equal(digest(await items(restored.nativeId)), digest(nativeItems));
        assert.equal(parse(fs.readFileSync(restored.file, 'utf8'), 'codex').context.compactions.length, originalFork.context.compactions.length);
        toggleRoundTrip = true;
    }
    assert.deepEqual(files.map(f => hash(fs.readFileSync(f))), originalHashes, 'Original native files changed during the test.');
    const report = { version: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), nativeProjectedItems: nativeItems.length, modelHistoryItems: payloads(groveFork, 'response_item').length, projectedItemsIdentical: true, modelRecordsIdentical: true, worldStateIdentical: true, baseInstructionsIdentical: true, compactionsDisabled: expanded, toggleRoundTrip, originalFilesUnchanged: true, modelTurnsSubmitted: 0 };
    fs.mkdirSync('test-results', { recursive: true }); fs.writeFileSync('test-results/codex-fork-' + (expanded ? 'expanded' : 'native') + '.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch { console.error('Native comparison failed during ' + phase + '. No private contents were printed.'); process.exitCode = 1; }
finally { await client?.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
