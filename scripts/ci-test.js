// Keep failures visible in public check annotations as well as runner logs.
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
const tests=fs.readdirSync('test').filter(file=>file.endsWith('.test.js')).flatMap(file=>{
    const source=fs.readFileSync('test/'+file,'utf8');
    return [...source.matchAll(/\btest\(\s*(['"])([^\r\n]+?)\1/g)].map(match=>({name:match[2],file:'test/'+file,line:source.slice(0,match.index).split('\n').length}));
});
const files=[...new Set(tests.map(test=>test.file))];let cursor=0,failedFiles=0;
function run(file){return new Promise(resolve=>{
    console.log('Testing '+file);
    const child=spawn(process.execPath,['--test','--test-timeout=90000','--test-reporter=spec',file],{stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
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
        if(!failed.length&&!timedOut)console.error(`::error file=${file},title=Regression test failure::${file} failed. See the runner logs.`);
    }
    else console.log(`::notice file=${file},title=Test file passed::${file}`);
    resolve();
    });
});}
await Promise.all(Array.from({length:3},async()=>{for(;;){const file=files[cursor++];if(!file)return;await run(file);}}));
process.exitCode=failedFiles?1:0;
