import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {atomic,id} from './util.js';

function acl(file,script){
    return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; "+script],{env:{...process.env,GROVE_PRIVATE_FILE:file},windowsHide:true,stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim();
}
export function privateFile(file){
    const stat=fs.statSync(file);
    if(process.platform!=='win32')return !(stat.mode&0o077);
    return acl(file,"$acl=Get-Acl -LiteralPath $env:GROVE_PRIVATE_FILE; $allowed=@($sid.Value,'S-1-5-18','S-1-5-32-544'); $unsafe=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowed }); if($unsafe.Count -eq 0){'private'}") === 'private';
}
export function writePrivateFile(file,content){
    if(process.platform!=='win32')return atomic(file,content);
    const staging=file+'.'+id()+'.private';
    try{
        atomic(staging,content);
        acl(staging,"$acl=New-Object Security.AccessControl.FileSecurity; $acl.SetAccessRuleProtection($true,$false); $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:GROVE_PRIVATE_FILE -AclObject $acl");
        fs.renameSync(staging,file);
    }finally{fs.rmSync(staging,{force:true});}
}
