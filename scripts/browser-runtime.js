import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
export async function closeBrowser(child,socket){
    if(child.exitCode!==null||child.signalCode!==null)return;
    const exited=once(child,'exit'),timer=setTimeout(()=>child.kill(),2000);
    try{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:0,method:'Browser.close'}));else child.kill();await exited;}
    finally{clearTimeout(timer);socket?.close();}
}
export function browserBinary() {
    if(process.env.CHROME)return process.env.CHROME;
    const candidates=process.platform==='win32'
        ? [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(root=>[path.join(root,'Google/Chrome/Application/chrome.exe'),path.join(root,'Microsoft/Edge/Application/msedge.exe')])
        : process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
    const binary=candidates.find(file=>fs.existsSync(file));
    if(!binary)throw new Error('Install Chrome/Edge or set CHROME to the browser executable.');
    return binary;
}
