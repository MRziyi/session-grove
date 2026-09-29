import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connect } from './native-rpc.js';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { prepareConversion, createConversion } from '../src/conversion.js';
import { codexSample, claudeSample } from '../src/demo.js';
const executable = process.argv[2] || 'codex', root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-conversion-native-'));
const home = path.join(root, 'codex'); fs.mkdirSync(home);
const store = new Store(path.join(root, 'library')), native = new Native(store, { roots: { codex: home, claude: path.join(root, 'claude') }, guard: () => {} });
let client;
try {
    client = connect(executable, home); await client.init(); await client.request('thread/list', { limit: 1 }); await client.close(); client = null;
    const source = store.branch(null, 'Source', 'claude', claudeSample(root, [['Remember conversion-marker-42', 'Confirmed conversion-marker-42']]));
    for (const mode of ['full', 'lean', 'messages']) {
        const options = { target: 'codex', mode, cwd: root }, { preview } = prepareConversion(store, source.id, options);
        const { branch } = createConversion(store, source.id, { ...options, fingerprint: preview.fingerprint });
        native.setActive(branch.id, root, true); native.apply([branch.id]);
        const live = store.instances().find(i => i.branchId === branch.id);
        client = connect(executable, home); await client.init();
        const read = await client.request('thread/read', { threadId: live.nativeId, includeTurns: true });
        assert.ok(JSON.stringify(read).includes('conversion-marker-42'));
        const resumed = await client.request('thread/resume', { threadId: live.nativeId, cwd: root, approvalPolicy: 'on-request', sandbox: 'read-only' });
        assert.equal(resumed.thread.id, live.nativeId); await client.close(); client = null;
    }
    const sourceCodex=store.branch(null,'Codex source','codex',codexSample(root,[['Keep reverse-marker-43','Confirmed reverse-marker-43']]));
    const {getSessionMessages}=await import('@anthropic-ai/claude-agent-sdk');
    for(const mode of ['lean','full','messages']){
        const options={target:'claude',mode,cwd:root},prepared=prepareConversion(store,sourceCodex.id,options),converted=createConversion(store,sourceCodex.id,{...options,fingerprint:prepared.preview.fingerprint}).branch;
        native.setActive(converted.id,root,true);native.apply([converted.id]);
        const instance=store.instances().find(i=>i.branchId===converted.id&&i.applied),rows=fs.readFileSync(instance.file,'utf8').trim().split('\n').map(JSON.parse);
        const messages=await getSessionMessages(instance.nativeId,{sessionStore:{load:async()=>rows}});
        const text=messages.map(m=>typeof m.message.content==='string'?m.message.content:m.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')).join('\n');
        for(const entry of prepared.entries)assert.ok(text.includes(entry.text),'Claude reader dropped converted text.');
    }
    const report = { codexToClaudeAllModesRead:true, fullReadResume: true, leanReadResume: true, messagesReadResume: true, modelRequests: 0 };
    fs.writeFileSync('test-results/conversion-native.json', JSON.stringify(report, null, 2)); console.log(report);
} finally { await client?.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
