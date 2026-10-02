import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomUUID} from 'node:crypto';

// Compatibility adapter for Codex VS Code 26.917's existing cross-window IPC.
// These notifications invalidate UI caches; they never change native session data.
let compatible;
function supportsCodexNotifications() {
    if(compatible!==undefined)return compatible;
    try {
        const root=path.join(os.homedir(),'.vscode','extensions');
        compatible=fs.readdirSync(root).filter(n=>n.startsWith('openai.chatgpt-')).some(n=>{
            const source=fs.readFileSync(path.join(root,n,'out','extension.js'),'utf8');
            return source.includes('"thread-archived":2')&&source.includes('"thread-unarchived":1')&&source.includes('"ipc.sock"');
        });
    } catch { compatible=false; }
    return compatible;
}
const frame=value=>{const body=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);};
export async function notifyCodex(root,changes,{supported=supportsCodexNotifications(),timeout=600,messages=null}={}) {
    if(!changes.length&&!messages?.length)return {status:'unchanged'};
    if(!supported||process.platform==='win32')return {status:'unsupported'};
    const socketPath=path.join(root,'ipc','ipc.sock');
    try {
        const dir=fs.lstatSync(path.dirname(socketPath)),socket=fs.lstatSync(socketPath),uid=process.getuid?.();
        if(!dir.isDirectory()||dir.uid!==uid||(dir.mode&0o022)||!socket.isSocket()||socket.uid!==uid)return {status:'unavailable'};
    } catch { return {status:'not-running'}; }
    return new Promise(resolve=>{
        const socket=net.createConnection(socketPath),requestId=randomUUID();let buffer=Buffer.alloc(0),done=false;
        const finish=status=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve({status});};
        const timer=setTimeout(()=>finish('unavailable'),timeout);
        socket.on('error',()=>finish('unavailable'));socket.on('close',()=>finish('unavailable'));
        socket.on('connect',()=>socket.write(frame({type:'request',requestId,sourceClientId:'initializing-client',version:0,method:'initialize',params:{clientType:'session-grove'}})));
        socket.on('data',chunk=>{
            buffer=Buffer.concat([buffer,chunk]);
            while(buffer.length>=4){
                const length=buffer.readUInt32LE(0);if(!length||length>1024*1024){finish('unavailable');return;}
                if(buffer.length<length+4)return;
                let message;try{message=JSON.parse(buffer.subarray(4,4+length).toString());}catch{finish('unavailable');return;}
                buffer=buffer.subarray(4+length);
                if(message.type!=='response'||message.requestId!==requestId)continue;
                if(message.resultType!=='success'||typeof message.result?.clientId!=='string'){finish('unavailable');return;}
                const packets=messages?messages.map(packet=>frame({type:'broadcast',...packet,sourceClientId:message.result.clientId})):changes.map(({nativeId,active})=>frame({type:'broadcast',method:active?'thread-unarchived':'thread-archived',version:active?1:2,sourceClientId:message.result.clientId,params:{hostId:'local',conversationId:nativeId}}));
                // Flush before disconnecting. IPC has no UI acknowledgement: "sent" is intentional.
                socket.end(Buffer.concat(packets),()=>finish('sent'));return;
            }
        });
    });
}
export async function refreshNativeClients(native,before) {
    const previous=new Map(before.map(i=>[i.id,i])),changes=[];
    for(const instance of native.store.instances()){
        if(instance.agent!=='codex')continue;
        const old=previous.get(instance.id),active=!!instance.applied&&!instance.missing;
        if(active!==(!!old?.applied&&!old?.missing))changes.push({nativeId:instance.nativeId,active});
    }
    return notifyCodex(native.roots.codex,changes);
}

let titleSupport;
export function codexTitleSupport(){
    if(titleSupport)return titleSupport;
    if(process.platform==='win32')return {supported:false,reason:'Live transcription-title refresh is not verified on this platform.'};
    try{
        const root=path.join(os.homedir(),'.vscode','extensions');
        const installed=fs.readdirSync(root).filter(n=>n.startsWith('openai.chatgpt-')).sort((a,b)=>fs.statSync(path.join(root,b)).mtimeMs-fs.statSync(path.join(root,a)).mtimeMs);
        for(const folder of installed){
            const extension=fs.readFileSync(path.join(root,folder,'out','extension.js'),'utf8'),assets=path.join(root,folder,'webview','assets');
            if(!extension.includes('query-cache-invalidate')||!extension.includes('thread/name/set'))continue;
            const runtime=fs.readdirSync(assets).filter(n=>n.startsWith('app-initial-')&&n.endsWith('.js')).map(n=>fs.readFileSync(path.join(assets,n),'utf8')).join('\n');
            if(['recent-conversations','recent-conversations-meta','command-menu-thread-search','thread/name/updated','invalidateQueries'].every(marker=>runtime.includes(marker)))return titleSupport={supported:true,client:'Codex VS Code',version:folder.replace('openai.chatgpt-','')};
        }
    }catch{}
    return {supported:false,reason:'A compatible Codex VS Code client is required for live transcription-title updates.'};
}
export function refreshCodexTitles(root,options={}){
    return notifyCodex(root,[],{supported:codexTitleSupport().supported,timeout:1500,...options,messages:[['recent-conversations'],['recent-conversations-meta'],['command-menu-thread-search','local']].map(queryKey=>({method:'query-cache-invalidate',version:0,params:{queryKey}}))});
}
