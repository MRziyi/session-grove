import fs from 'node:fs';
import path from 'node:path';
export function browserBinary() {
    if(process.env.CHROME)return process.env.CHROME;
    const candidates=process.platform==='win32'
        ? [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(root=>[path.join(root,'Google/Chrome/Application/chrome.exe'),path.join(root,'Microsoft/Edge/Application/msedge.exe')])
        : process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
    const binary=candidates.find(file=>fs.existsSync(file));
    if(!binary)throw new Error('Install Chrome/Edge or set CHROME to the browser executable.');
    return binary;
}
