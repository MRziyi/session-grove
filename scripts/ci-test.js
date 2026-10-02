// Keep failures visible in public check annotations as well as runner logs.
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
const tests=fs.readdirSync('test').filter(file=>file.endsWith('.test.js')).flatMap(file=>{
    const source=fs.readFileSync('test/'+file,'utf8');
    return [...source.matchAll(/\btest\(\s*(['"])([^\r\n]+?)\1/g)].map(match=>({name:match[2],file:'test/'+file,line:source.slice(0,match.index).split('\n').length}));
});
const browser=process.argv.includes('--browser');
const files=browser?['scripts/node-browser-smoke.js','scripts/sync-browser-smoke.js','scripts/session-drag-browser-smoke.js','scripts/inline-name-browser-smoke.js','scripts/tree-loading-browser-smoke.js']:fs.readdirSync('test').filter(file=>file.endsWith('.test.js')).map(file=>'test/'+file);let cursor=0,failedFiles=0;
function run(file){return new Promise(resolve=>{
    console.log('Testing '+file);
    const child=spawn(process.execPath,browser?[file]:['--test','--test-timeout=90000','--test-reporter=spec',file],{stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
    let tail='',timedOut=false;
    const output=chunk=>{process.stdout.write(chunk);tail=(tail+chunk.toString()).slice(-16000);};
    child.stdout.on('data',output);child.stderr.on('data',output);
    const timer=setTimeout(()=>{
        timedOut=true;console.error(`::error file=${file},title=Test file timed out::${file} did not exit within two minutes.`);
        if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
        else try{process.kill(-child.pid,'SIGKILL');}catch{}
    },120000);
    child.on('error',()=>{clearTimeout(timer);failedFiles++;resolve();});
    child.on('close',code=>{clearTimeout(timer);
    if(code||timedOut){failedFiles++;
        // Only emit names already present in public source. Never publish output,
        // assertion values, filesystem paths, fixtures or environment data.
        const lines=tail.replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/);
        const failed=tests.filter(test=>test.file===file&&lines.some(line=>line.trim().startsWith('✖ '+test.name+' (')));
        for(const test of failed)console.error(`::error file=${test.file},line=${test.line},title=Regression test failure::${test.name.replaceAll('%','%25')}`);
        for(const [label,pattern] of [['Windows ACL helper',/private-file\.js/],['PowerShell module mismatch',/Could not load file or assembly|requires PowerShell/],['Access denied',/Access is denied|UnauthorizedAccessException/],['Command unavailable',/is not recognized/],['Assertion failed',/ERR_ASSERTION/],['PowerShell type unavailable',/Cannot find type|Method invocation failed/]])if(pattern.test(tail))console.error(`::error file=${file},title=Failure category::${label}`);
        if(!failed.length&&!timedOut){
            const positions=[...tail.matchAll(/(?:node-browser-smoke|sync-browser-smoke)\.js:(\d+):/g)];
            const line=browser&&positions.length?Number(positions.at(-1)[1]):1;
            const category=/EPERM|EBUSY/.test(tail)?'Temporary file access failed':/Timeout/.test(tail)?'UI wait timed out':/ERR_ASSERTION/.test(tail)?'Assertion failed':'Execution failed';
            console.error(`::error file=${file},line=${line},title=Regression test failure::${category}. See this public source location.`);
        }
    }
    else console.log(`::notice file=${file},title=Test file passed::${file}`);
    resolve();
    });
});}
await Promise.all(Array.from({length:browser?1:3},async()=>{for(;;){const file=files[cursor++];if(!file)return;await run(file);}}));
process.exitCode=failedFiles?1:0;
