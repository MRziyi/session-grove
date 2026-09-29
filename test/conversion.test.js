import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { prepareConversion, createConversion, readOnlyTool } from '../src/conversion.js';
import { parse } from '../src/transcript.js';
import { claudeSample, codexSample } from '../src/demo.js';
import { id } from '../src/util.js';
test('lean shell classification accepts only simple allowlisted reads', () => {
    assert.equal(readOnlyTool('functions.exec_command', JSON.stringify({ cmd: 'cat src/app.js' })), true);
    assert.equal(readOnlyTool('Bash', { command: 'git diff -- src/app.js' }), true);
    assert.equal(readOnlyTool('Read', { file_path: '/work/CLAUDE.md' }), false);
    assert.equal(readOnlyTool('exec_command', { cmd: 'cat AGENTS.md' }), false);
    for (const cmd of ['cat file; rm file', 'cat file > copy', 'cat $(command)', 'git reset --hard', 'python script.py', 'rg --pre command query', 'cat file | other']) assert.equal(readOnlyTool('exec_command', { cmd }), false);
});
test('lean context keeps project instructions and the latest complete world-state chain',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-rules-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const rows=codexSample(root,[['Question','Answer']]).trim().split('\n').map(JSON.parse);rows[0].payload.developer_instructions='Keep this project requirement';
 rows.push({type:'world_state',payload:{full:true,state:{marker:'obsolete-marker'}}},{type:'world_state',payload:{full:true,state:{marker:'current-marker'}}},{type:'world_state',payload:{full:false,state:{marker:'delta-marker'}}});
 const b=store.branch(null,'Source','codex',rows.map(r=>JSON.stringify(r)+'\n').join('')),p=prepareConversion(store,b.id,{target:'claude',mode:'lean',cwd:root});
 const text=p.entries.map(e=>e.text).join('\n');assert.match(text,/Keep this project requirement/);assert.match(text,/current-marker/);assert.match(text,/delta-marker/);assert.ok(!text.includes('obsolete-marker'));assert.equal(p.preview.stats.retainedContextRecords,3);
});

test('full cross-agent contexts retain exact source bytes; each direction activates independently', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-convert-')), store = new Store(path.join(root, 'library'));
    t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
    const native = new Native(store, { roots: { codex: path.join(root, 'codex'), claude: path.join(root, 'claude') }, guard: () => {} });
    for (const agent of ['claude', 'codex']) {
        const raw = (agent === 'claude' ? claudeSample : codexSample)(root, [['Important requirement', 'Verified result']]);
        const source = store.branch(null, 'Original', agent, raw), target = agent === 'claude' ? 'codex' : 'claude';
        const options = { target, mode: 'full', cwd: root }, { preview } = prepareConversion(store, source.id, options);
        const { branch } = createConversion(store, source.id, { ...options, fingerprint: preview.fingerprint });
        assert.ok(parse(store.raw(branch.head), target).messages.some(m => m.text.includes(raw)));
        native.setActive(branch.id, root, true); assert.equal(native.apply([branch.id]).applied, 1);
        assert.equal(store.raw(source.head), raw); assert.equal(store.instances().some(i => i.branchId === source.id), false);
    }
});

test('lean conversion shortens only read-only output, keeps errors/writes, and rejects stale previews', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-lean-')), store = new Store(root);
    t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
    const rows = claudeSample(root, [['Keep every user request', 'Keep final response']]).trim().split('\n').map(JSON.parse);
    let previous = rows.at(-1).uuid;
    for (const [name, isError] of [['Read', false], ['Read', true], ['Edit', false]]) {
        const call = id();
        for (const [type, content, stop] of [['assistant', [{ type: 'tool_use', id: call, name, input: { file_path: '/work/file' } }], 'tool_use'], ['user', [{ type: 'tool_result', tool_use_id: call, content: 'x'.repeat(9000), is_error: isError }]]]) {
            const uuid = id(); rows.push({ type, uuid, parentUuid: previous, sessionId: rows[0].sessionId, cwd: root, message: { role: type, content, stop_reason: stop } }); previous = uuid;
        }
    }
    rows.push({ type: 'assistant', uuid: id(), parentUuid: previous, sessionId: rows[0].sessionId, cwd: root, message: { role: 'assistant', content: 'All tools completed.', stop_reason: 'end_turn' } });
    const b = store.branch(null, 'Source', 'claude', rows.map(r => JSON.stringify(r) + '\n').join(''));
    const options = { target: 'codex', mode: 'lean', cwd: root }, prepared = prepareConversion(store, b.id, options);
    assert.equal(prepared.preview.stats.shortenedOutputs, 1);
    assert.equal(prepared.entries.filter(e => e.text.includes('x'.repeat(9000))).length, 2);
    assert.ok(prepared.entries.some(e => e.text.includes('Keep every user request')));
    assert.ok(prepared.entries.some(e => e.text.includes('Keep final response')));
    assert.throws(() => createConversion(store, b.id, { ...options, mode: 'full', fingerprint: prepared.preview.fingerprint }), /changed/);
    assert.equal(store.all('branch').length, 1);
});
