import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {atomic,id} from './util.js';

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
    try{
        atomic(staging,content);
        // Use the framework directly: PowerShell 7 hosts may pass module paths
        // that cannot be imported by Windows PowerShell's Get/Set-Acl cmdlets.
        acl(staging,"$acl=[Security.AccessControl.FileSecurity]::new(); $acl.SetAccessRuleProtection($true,$false); $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); [IO.File]::SetAccessControl($env:GROVE_PRIVATE_FILE,$acl)");
        fs.renameSync(staging,file);
    }finally{fs.rmSync(staging,{force:true});}
}
