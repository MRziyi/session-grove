// Keep failures visible in public check annotations as well as runner logs.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const tests=fs.readdirSync('test').filter(file=>file.endsWith('.test.js')).flatMap(file=>{
    const source=fs.readFileSync('test/'+file,'utf8');
    return [...source.matchAll(/\btest\(\s*(['"])([^\r\n]+?)\1/g)].map(match=>({name:match[2],file:'test/'+file,line:source.slice(0,match.index).split('\n').length}));
});
const child=spawn(process.execPath,['--test','--test-reporter=spec','test/*.test.js'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let tail='';
const output=chunk=>{process.stdout.write(chunk);tail=(tail+chunk.toString()).slice(-16000);};
child.stdout.on('data',output);child.stderr.on('data',output);
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('close',code=>{
    if(code){
        // Only emit names already present in public source. Never publish output,
        // assertion values, filesystem paths, fixtures or environment data.
        const lines=tail.replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/);
        const failed=tests.filter(test=>lines.some(line=>line.trim().startsWith('✖ '+test.name+' (')));
        for(const test of failed)console.error(`::error file=${test.file},line=${test.line},title=Regression test failure::${test.name.replaceAll('%','%25')}`);
        if(!failed.length)console.error('::error title=Regression test failure::The regression suite failed. See the runner logs.');
    }
    process.exitCode=code??1;
});
