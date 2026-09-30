import fs from 'node:fs';
import path from 'node:path';
import {assert,hash,id,safePath} from './util.js';
import {writePrivateFile} from './private-file.js';
const read=file=>{try{return fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}};

// Locate scalar assignments without mistaking multiline instructions for settings.
function tomlLines(raw){
    let section='',multiline=null,nesting=0;
    const rows=raw.split(/\r?\n/).map((line,index)=>{
        const result={line,index,section,editable:!multiline&&nesting===0};let quote=null;
        for(let i=0;i<line.length;i++){
            if(multiline){if(line.slice(i,i+3)===multiline){multiline=null;i+=2;}else if(multiline==='"""'&&line[i]==='\\')i++;continue;}
            if(quote){if(quote==='"'&&line[i]==='\\')i++;else if(line[i]===quote)quote=null;continue;}
            if(line[i]==='#')break;
            if(line.slice(i,i+3)==='"""'||line.slice(i,i+3)==="'''"){multiline=line.slice(i,i+3);i+=2;}
            else if(line[i]==='"'||line[i]==="'")quote=line[i];
            else if(line[i]==='['||line[i]==='{')nesting++;
            else if(line[i]===']'||line[i]==='}')nesting--;
        }
        if(result.editable&&/^\s*\[/.test(line)){section=line.replace(/\s*#.*$/,'').trim();result.section=section;}
        return result;
    });
    assert(!multiline&&nesting===0,'Codex config.toml has an unfinished string or array.');return rows;
}
function scalars(raw,section=''){
    const result={};
    for(const row of tomlLines(raw))if(row.editable&&row.section===section){const m=row.line.match(/^\s*(profile|model_context_window|model_auto_compact_token_limit|model_auto_compact_token_limit_scope)\s*=\s*("[^"\n]*"|'[^'\n]*'|[\d_]+)\s*(?:#.*)?$/);if(m)result[m[1]]=/^\d/.test(m[2])?Number(m[2].replaceAll('_','')):m[2].slice(1,-1);}
    return result;
}
export function patchContextToml(raw,values){
    const rows=tomlLines(raw),seen=new Set(),eol=raw.includes('\r\n')?'\r\n':'\n',out=[];
    const add=()=>{for(const [key,value] of Object.entries(values))if(!seen.has(key)&&value!==null){out.push(key+' = '+value);seen.add(key);}};
    for(const row of rows){
        if(row.editable&&row.section!=='')add();
        assert(!(row.editable&&row.section===''&&/^\s*["'](?:model_context_window|model_auto_compact_token_limit)["']\s*=/.test(row.line)),'Edit this nonstandard Codex setting in config.toml first.');
        const m=row.editable&&row.section===''&&row.line.match(/^(\s*)(model_context_window|model_auto_compact_token_limit)\s*=\s*([^#]*?)(\s*(?:#.*)?)$/);
        if(m&&m[2] in values){assert(!seen.has(m[2])&&/^\d[\d_]*\s*$/.test(m[3]),'Edit this nonstandard Codex setting in config.toml first.');seen.add(m[2]);if(values[m[2]]!==null)out.push(m[1]+m[2]+' = '+values[m[2]]+m[4]);else if(m[4].trim())out.push(m[1]+m[4].trim());}
        else out.push(row.line);
    }
    add();return out.join(eol).replace(/(?:\r?\n)*$/,'')+eol;
}
export class NativeContextSettings{
    constructor(root,roots){Object.assign(this,{root,roots});}
    source(agent){
        assert(['codex','claude'].includes(agent),'Choose Codex or Claude Code.');
        if(agent==='codex'){
            const baseFile=path.join(this.roots.codex,'config.toml'),base=read(baseFile),defaults=scalars(base),profile=defaults.profile;
            assert(!profile||/^[\w.-]+$/.test(profile),'Edit this Codex profile in the client first.');
            const file=profile?path.join(this.roots.codex,profile+'.config.toml'):baseFile,raw=file===baseFile?base:read(file);
            return {file,raw,scope:profile||null,values:{...defaults,...(profile?scalars(base,'[profiles.'+profile+']'):{}),...scalars(raw)},fingerprint:hash(base+'\0'+raw)};
        }
        const file=path.join(this.roots.claude,'settings.json'),raw=read(file);let settings={};
        try{settings=raw?JSON.parse(raw):{};}catch{throw new Error('Claude settings.json is invalid. Fix it in the client first.');}
        assert(settings&&typeof settings==='object'&&!Array.isArray(settings)&&(!settings.env||typeof settings.env==='object'&&!Array.isArray(settings.env)),'Claude settings.json must contain an object.');
        return {file,raw,settings,fingerprint:hash(raw)};
    }
    read(agent){
        const source=this.source(agent),positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
        return agent==='codex'?{agent,fingerprint:source.fingerprint,profile:source.scope,window:positive(source.values.model_context_window),compactAt:positive(source.values.model_auto_compact_token_limit),compactScope:source.values.model_auto_compact_token_limit_scope||'total'}:{agent,fingerprint:source.fingerprint,window:positive(source.settings.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW),compactPercent:positive(source.settings.env?.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)};
    }
    status(){return Object.fromEntries(['codex','claude'].map(agent=>{try{return [agent,this.read(agent)];}catch(error){return [agent,{agent,error:error.message}];}}));}
    save(body){
        const source=this.source(body.agent);assert(body.fingerprint===source.fingerprint,'Context settings changed. Reopen Settings and try again.',409);
        const token=value=>{assert(value===null||Number.isSafeInteger(value)&&value>0&&value<=10000000,'Enter a positive token count or leave the field empty.');return value;};
        const window=token(body.window);let output;
        if(body.agent==='codex'){
            const compactAt=token(body.compactAt);assert(!window||!compactAt||source.values.model_auto_compact_token_limit_scope==='body_after_prefix'||compactAt<=window,'Compaction threshold must not exceed the context window.');
            const own=scalars(source.raw),unchanged=(key,value)=>value===null?own[key]===undefined:source.values[key]===value;
            if(unchanged('model_context_window',window)&&unchanged('model_auto_compact_token_limit',compactAt))return this.read(body.agent);
            output=patchContextToml(source.raw,{model_context_window:window,model_auto_compact_token_limit:compactAt});
        }else{
            assert(window===null||window>=100000&&window<=1000000,'Claude auto-compact window must be between 100000 and 1000000 tokens.');
            const previous=source.settings.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW;if(window===null?previous===undefined:Number(previous)===window)return this.read(body.agent);
            const settings=source.settings;if(window===null){if(settings.env)delete settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;}else(settings.env||={}).CLAUDE_CODE_AUTO_COMPACT_WINDOW=String(window);
            output=JSON.stringify(settings,null,2)+'\n';
        }
        if(output!==source.raw){safePath(this.roots[body.agent],source.file);if(source.raw)writePrivateFile(path.join(this.root,'context-backups',body.agent+'-'+id()+'.txt'),source.raw);writePrivateFile(source.file,output);}
        return this.read(body.agent);
    }
}
