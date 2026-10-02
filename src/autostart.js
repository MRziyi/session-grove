import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {assert,atomic,hash,id} from './util.js';
const execute=promisify(execFile);
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const unxml=value=>value.replace(/&(amp|lt|gt|quot|apos);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[key]);
export const windowsArgument=value=>'"'+String(value).replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
const readShortcut="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; $c=$env:GROVE_STARTUP_CONFIG | ConvertFrom-Json; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($c.file); @{target=$s.TargetPath;arguments=$s.Arguments;description=$s.Description} | ConvertTo-Json -Compress";
const writeShortcut="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; $c=$env:GROVE_STARTUP_CONFIG | ConvertFrom-Json; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($c.file); $s.TargetPath=$c.target; $s.Arguments=$c.arguments; $s.WorkingDirectory=$c.directory; $s.Description=$c.description; $s.WindowStyle=7; $s.Save()";

// This controls the next user login only. Never unload or stop the live server.
export class Autostart {
    constructor({root,roots,port=()=>7421,demo=false,platform=process.platform,home=os.homedir(),directory,executable=process.execPath,entry=fileURLToPath(new URL('../bin/session-grove.js',import.meta.url)),run=execute,uid=()=>process.getuid()}={}) {
        Object.assign(this,{root:path.resolve(root),roots,port,demo,platform,home,executable,entry,run,uid});
        const standard=path.resolve(root)===path.join(home,'.session-grove'),suffix=standard?'':'.'+hash(path.resolve(root)).slice(0,12);
        this.label='io.session-grove'+suffix;
        this.directory=directory||(platform==='darwin'?path.join(home,'Library','LaunchAgents'):path.join(process.env.APPDATA||path.join(home,'AppData','Roaming'),'Microsoft','Windows','Start Menu','Programs','Startup'));
        this.file=path.join(this.directory,platform==='darwin'?this.label+'.plist':'Session Grove'+(suffix?' '+suffix.slice(1):'')+'.lnk');
    }
    get supported(){return !this.demo&&['darwin','win32'].includes(this.platform);}
    args(){return [this.entry,'--data-dir',this.root,'--codex-home',this.roots.codex,'--claude-home',this.roots.claude,'--port',String(this.port())];}
    safeEntry(){
        try{const stat=fs.lstatSync(this.file);assert(stat.isFile()&&!stat.isSymbolicLink(),'The startup entry is not a regular file.',409);assert(stat.size<128*1024,'The startup entry is too large to manage.',409);return true;}
        catch(e){if(e.code==='ENOENT')return false;throw e;}
    }
    async shortcut(script,config){return this.run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,GROVE_STARTUP_CONFIG:JSON.stringify(config)},windowsHide:true,timeout:30000,maxBuffer:128*1024});}
    async managed(){
        if(this.platform==='darwin'){
            const text=fs.readFileSync(this.file,'utf8'),library=/<key>GroveLibrary<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1];
            if(library)return unxml(library)===this.root;
            // Recognize the README's default-library LaunchAgent without adopting
            // arbitrary startup entries or another custom library's configuration.
            return this.root===path.join(this.home,'.session-grove')&&text.includes('<string>'+this.label+'</string>')&&text.includes('session-grove.js')&&!text.includes('--data-dir');
        }
        const value=JSON.parse((await this.shortcut(readShortcut,{file:this.file})).stdout.trim());
        return value.description==='Session Grove · '+this.root||!value.description&&this.root===path.join(this.home,'.session-grove')&&String(value.arguments).includes('session-grove.js')&&!String(value.arguments).includes('--data-dir');
    }
    async status(){
        const basic={supported:this.supported,enabled:false,busy:!!this.busy};
        if(!this.supported)return {...basic,reason:this.demo?'Login startup is unavailable in demo mode.':'Login startup is available on macOS and Windows.'};
        try{
            if(!this.safeEntry())return basic;
            if(!await this.managed())return {...basic,managed:false,error:'This startup entry belongs to another installation. Remove it manually before changing this setting.'};
            if(this.platform==='darwin'){
                const result=await this.run('/bin/launchctl',['print-disabled','gui/'+this.uid()],{timeout:5000,maxBuffer:128*1024});
                const disabled=result.stdout.split('\n').some(line=>line.includes('"'+this.label+'"')&&/=>\s*true/.test(line));
                return {...basic,enabled:!disabled,managed:true};
            }
            return {...basic,enabled:true,managed:true};
        }catch(error){return {...basic,error:error.status?error.message:'Could not read login startup settings.'};}
    }
    plist(){
        const args=[this.executable,...this.args()],logs=path.join(this.root,'logs','server.log'),environment=[...new Set([path.dirname(this.executable),...(process.env.PATH||'/usr/bin:/bin').split(':')])].join(':');
        return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n'+
            '<key>Label</key><string>'+xml(this.label)+'</string>\n<key>GroveLibrary</key><string>'+xml(this.root)+'</string>\n'+
            '<key>ProgramArguments</key><array>'+args.map(value=>'<string>'+xml(value)+'</string>').join('')+'</array>\n'+
            '<key>WorkingDirectory</key><string>'+xml(path.dirname(path.dirname(this.entry)))+'</string>\n'+
            '<key>EnvironmentVariables</key><dict><key>PATH</key><string>'+xml(environment)+'</string></dict>\n'+
            '<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>\n'+
            '<key>StandardOutPath</key><string>'+xml(logs)+'</string><key>StandardErrorPath</key><string>'+xml(logs)+'</string>\n</dict></plist>\n';
    }
    get pending(){return this.operation||null;}
    async set(enabled){
        assert(!this.operation,'Login startup settings are already changing.',409);
        this.operation=this.change(enabled);
        try{return await this.operation;}finally{this.operation=null;}
    }
    async change(enabled){
        assert(typeof enabled==='boolean','Choose whether to start at login.');assert(this.supported,'Login startup is unavailable in this environment.');assert(!this.busy,'Login startup settings are already changing.',409);this.busy=true;
        let temporary;
        try{
            const exists=this.safeEntry();assert(!exists||await this.managed(),'This startup entry belongs to another installation. Remove it manually before changing this setting.',409);
            if(!enabled){if(exists)fs.unlinkSync(this.file);return {...await this.status(),busy:false};}
            assert(path.isAbsolute(this.executable)&&path.isAbsolute(this.entry),'Startup requires absolute executable paths.');
            assert(fs.existsSync(this.executable)&&fs.existsSync(this.entry),'The startup executable is unavailable.');
            fs.mkdirSync(this.directory,{recursive:true,mode:0o700});fs.mkdirSync(path.join(this.root,'logs'),{recursive:true,mode:0o700});
            if(this.platform==='darwin'){
                const previous=exists?fs.readFileSync(this.file):null;atomic(this.file,this.plist());
                try{await this.run('/bin/launchctl',['enable','gui/'+this.uid()+'/'+this.label],{timeout:5000,maxBuffer:128*1024});}
                catch{if(previous)atomic(this.file,previous);else fs.unlinkSync(this.file);throw Error('Could not enable login startup. The previous setting was kept.');}
            }else{
                const staging=path.join(this.root,'startup-staging');fs.mkdirSync(staging,{recursive:true,mode:0o700});
                const previous=exists?fs.readFileSync(this.file):null;
                temporary=path.join(staging,id()+'.lnk');
                await this.shortcut(writeShortcut,{file:temporary,target:this.executable,arguments:[...this.args(),'--background'].map(windowsArgument).join(' '),directory:path.dirname(path.dirname(this.entry)),description:'Session Grove · '+this.root});
                assert(fs.existsSync(temporary),'The startup shortcut could not be created.');atomic(this.file,fs.readFileSync(temporary));fs.unlinkSync(temporary);temporary=null;
                try{const status=await this.status();assert(status.enabled&&!status.error,status.error||'Login startup could not be verified.');return {...status,busy:false};}
                catch(error){if(previous)atomic(this.file,previous);else fs.rmSync(this.file,{force:true});throw error;}
            }
            const status=await this.status();assert(status.enabled&&!status.error,status.error||'Login startup could not be verified.');return {...status,busy:false};
        }finally{if(temporary)fs.rmSync(temporary,{force:true});this.busy=false;}
    }
}
