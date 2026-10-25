import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {atomic,id,assert} from './util.js';
import path from 'node:path';

let userSid;
function currentSid(){
    if(!userSid){
        const output=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});
        userSid=output.match(/"(S-1-[0-9-]+)"\s*$/m)?.[1];
        assert(userSid,'Could not identify the current Windows user.');
    }
    return userSid;
}

function acl(file,script){
    return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; "+script],{env:{...process.env,GROVE_PRIVATE_FILE:file},windowsHide:true,stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim();
}
export function privateFile(file){
    const stat=fs.statSync(file);
    if(process.platform!=='win32')return !(stat.mode&0o077);
    return acl(file,"$acl=[IO.File]::GetAccessControl($env:GROVE_PRIVATE_FILE); $allowed=@($sid.Value,'S-1-5-18','S-1-5-32-544'); $unsafe=$false; foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed){$unsafe=$true}}; if(-not $unsafe){'private'}") === 'private';
}
export function writePrivateFile(file,content){
    if(process.platform!=='win32')return atomic(file,content);
    const staging=file+'.'+id()+'.private';
    let fd;
    try{
        fs.mkdirSync(path.dirname(file),{recursive:true});
        fd=fs.openSync(staging,'wx',0o600);
        // A new empty file has no explicit ACEs. Remove inherited grants and
        // grant only the current SID before writing any secret bytes. icacls
        // avoids starting the PowerShell runtime for every settings write.
        execFileSync('icacls.exe',[staging,'/inheritance:r','/grant:r','*'+currentSid()+':F'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
        fs.writeFileSync(fd,content);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        fs.renameSync(staging,file);
    }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(staging,{force:true});}
}
