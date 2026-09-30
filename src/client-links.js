import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Only advertise handlers actually installed in this VS Code environment.
export function installedClientLinks(directory=path.join(os.homedir(),'.vscode','extensions')) {
    let names=[];try{names=fs.readdirSync(directory);}catch{}
    return {codex:names.some(n=>n.startsWith('openai.chatgpt-')),claude:names.some(n=>n.startsWith('anthropic.claude-code-'))};
}
