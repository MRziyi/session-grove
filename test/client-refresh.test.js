import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {notifyCodex} from '../src/client-refresh.js';
const frame=value=>{const json=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(json.length);return Buffer.concat([header,json]);};
test('Codex refresh uses the existing notification channel after a fragmented handshake',{skip:process.platform==='win32'},async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-ipc-'));fs.mkdirSync(path.join(root,'ipc'),{mode:0o700});
    let received;const delivered=new Promise(r=>received=r);
    const messages=[],server=net.createServer(socket=>{
        let buffer=Buffer.alloc(0);socket.on('data',chunk=>{
            buffer=Buffer.concat([buffer,chunk]);
            while(buffer.length>=4&&buffer.length>=buffer.readUInt32LE(0)+4){
                const end=buffer.readUInt32LE(0)+4,message=JSON.parse(buffer.subarray(4,end));buffer=buffer.subarray(end);messages.push(message);if(messages.length===3)received();
                if(message.method==='initialize'){
                    const packet=frame({type:'response',requestId:message.requestId,resultType:'success',result:{clientId:'grove-test'}});
                    socket.write(packet.subarray(0,2));setImmediate(()=>socket.write(packet.subarray(2)));
                }
            }
        });
    });
    server.listen(path.join(root,'ipc','ipc.sock'));await once(server,'listening');
    t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
    const result=await notifyCodex(root,[{nativeId:'active-id',active:true},{nativeId:'archived-id',active:false}],{supported:true});
    assert.equal(result.status,'sent');await Promise.race([delivered,new Promise((_,reject)=>setTimeout(()=>reject(new Error('notification not delivered')),1000))]);
    assert.deepEqual(messages.slice(1).map(m=>[m.method,m.version,m.params]),[
        ['thread-unarchived',1,{hostId:'local',conversationId:'active-id'}],['thread-archived',2,{hostId:'local',conversationId:'archived-id'}]
    ]);
    assert.ok(messages.every(m=>m.method!=='thread/start'&&m.method!=='turn/start'));
});
test('refresh is optional when the client is absent or unsupported',async()=>{
    assert.equal((await notifyCodex('/missing',[{nativeId:'x',active:true}],{supported:true})).status,process.platform==='win32'?'unsupported':'not-running');
    assert.equal((await notifyCodex('/missing',[{nativeId:'x',active:true}],{supported:false})).status,'unsupported');
    assert.equal((await notifyCodex('/missing',[],{supported:true})).status,'unchanged');
});
