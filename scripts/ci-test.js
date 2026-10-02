// Keep failures visible in public check annotations as well as runner logs.
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {testPlan} from './ci-plan.js';
const tests=fs.readdirSync('test').filter(file=>file.endsWith('.test.js')).flatMap(file=>{
    const source=fs.readFileSync('test/'+file,'utf8');
    return [...source.matchAll(/\btest\(\s*(['"])([^\r\n]+?)\1/g)].map(match=>({name:match[2],file:'test/'+file,line:source.slice(0,match.index).split('\n').length}));
});
const suite=process.argv.find(v=>v.startsWith('--suite='))?.slice(8)||(process.argv.includes('--browser')?'browser':'all'),browser=suite==='browser';
const plan=testPlan(fs.readdirSync('test').filter(file=>file.endsWith('.test.js')).map(file=>'test/'+file),tests,suite);
let cursor=0,failedFiles=0;const results=[];
function run({file,names}){return new Promise(resolve=>{
    const started=performance.now();let finished=false;
    const finish=(status)=>{if(finished)return;finished=true;results.push({file,status,durationMs:Math.round(performance.now()-started),...(names?{cases:names.length}:{})});resolve();};
    console.log('Testing '+file+(names?' ('+names.length+' cases)':''));
    const filter=names?['--test-name-pattern=^(?:'+names.map(RegExp.escape).join('|')+')$']:[];
    const child=spawn(process.execPath,browser?[file]:['--test','--test-timeout=90000','--test-reporter=spec',...filter,file],{stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
    let tail='',timedOut=false;
    const output=chunk=>{process.stdout.write(chunk);tail=(tail+chunk.toString()).slice(-16000);};
    child.stdout.on('data',output);child.stderr.on('data',output);
    const timer=setTimeout(()=>{
        timedOut=true;console.error(`::error file=${file},title=Test file timed out::${file} did not exit within two minutes.`);
        if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
        else try{process.kill(-child.pid,'SIGKILL');}catch{}
    },120000);
    child.on('error',()=>{clearTimeout(timer);failedFiles++;finish('spawn-error');});
    child.on('close',code=>{clearTimeout(timer);if(finished)return;
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
    else console.log(`::notice file=${file},title=Test file passed::${file} (${Math.round(performance.now()-started)} ms)`);
    finish(timedOut?'timeout':code?'failed':'passed');
    });
});}
// Native PowerShell/COM startup and Git integration spawn many subprocesses.
// Run these Windows suites without competing test workers; keep their existing
// watchdogs and every assertion, rather than extending a timeout after failure.
const exclusive=suite==='all'&&process.platform==='win32'?['test/autostart.test.js','test/git-cloud.test.js']:[];
for(const task of plan.filter(task=>exclusive.includes(task.file)))await run(task);
await Promise.all(Array.from({length:browser||suite!=='all'&&suite!=='core'?1:3},async()=>{for(;;){const task=plan[cursor++];if(!task)return;if(exclusive.includes(task.file))continue;await run(task);}}));
// Persist only public filenames, counts and timings, never test output or data.
fs.mkdirSync('test-results/ci',{recursive:true});
fs.writeFileSync('test-results/ci/'+suite+'.json',JSON.stringify({suite,platform:process.platform,node:process.version,results},null,2));
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n| Test file | Result | Seconds |\n| --- | --- | ---: |\n'+results.map(r=>`| ${r.file} | ${r.status} | ${(r.durationMs/1000).toFixed(2)} |`).join('\n')+'\n');
process.exitCode=failedFiles?1:0;
