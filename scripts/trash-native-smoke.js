// Real Codex archive/removal against a disposable home. No model requests.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {Store} from '../src/store.js';import {Native} from '../src/native.js';import {codexSample} from '../src/demo.js';import {stageTrash,restoreTrash} from '../src/trash.js';import {moveNativeToRecovery} from '../src/trash-actions.js';import {connect} from '../src/codex-rpc.js';import {codexBinary} from '../src/native-archive.js';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'grove-native-trash-'))),store=new Store(path.join(root,'library')),home=path.join(root,'codex'),native=new Native(store,{roots:{codex:home,claude:path.join(root,'claude')},guard:()=>{}});let client;
try{
 const b=store.branch(null,'Disposable session','codex',codexSample(root,[['Keep in recovery','Original answer']]));native.setActive(b.id,root,true);native.apply([b.id]);const i=store.instances()[0];
 client=connect(codexBinary(),home);await client.init();await client.request('thread/resume',{threadId:i.nativeId,excludeTurns:true,cwd:root,approvalPolicy:'on-request',sandbox:'read-only'});await client.close();
 stageTrash(store,[b.id],[b.id]);
 client=connect(codexBinary(),home);await client.init(); // another Codex process stays alive
 const result=await moveNativeToRecovery(store,native,[i.id]);assert.deepEqual(result.blocked,[]);assert.equal(result.moved.length,1);
 const restored=restoreTrash(store,result.recoveryIds[0]);assert.match(store.raw(store.get('branch',restored.branchIds[0]).head),/Keep in recovery/);
 console.log(JSON.stringify({nativeArchiveAndRemoval:true,recoveryRestored:true,otherCodexProcessKeptRunning:true,modelRequests:0}));
}finally{await client?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
