// Compare whole-file and streamed record decoding in separate processes.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {GitCloud} from '../src/git-cloud.js';import {hash} from '../src/util.js';
const [mode,directory]=process.argv.slice(2);
if(mode){
    const cloud=new GitCloud({root:directory},()=>({}));cloud.directory=()=>directory;let records=0,peakRss=process.memoryUsage().rss;const start=performance.now();
    if(mode==='stream'){for await(const row of cloud.streamRecords('sample')){records++;peakRss=Math.max(peakRss,process.memoryUsage().rss);}}
    else for(const row of cloud.records('sample')){records++;peakRss=Math.max(peakRss,process.memoryUsage().rss);}
    console.log(JSON.stringify({mode,records,wallMs:Math.round(performance.now()-start),peakRssMiB:Math.round(peakRss/1048576)}));
}else{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-record-memory-')),dir=path.join(root,'trees',hash('sample'),'records');fs.mkdirSync(dir,{recursive:true});
    try{
        const fd=fs.openSync(path.join(dir,'000000.jsonl'),'w'),body=JSON.stringify({type:'response_item',payload:{type:'function_call_output',output:'x'.repeat(512*1024)}}),line=JSON.stringify([hash(body),body])+'\n';
        try{for(let i=0;i<64;i++)fs.writeSync(fd,line);}finally{fs.closeSync(fd);}
        const results=['whole-file','stream'].map(mode=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),mode,root],{encoding:'utf8',windowsHide:true})));
        const report={fileMiB:Math.round(fs.statSync(path.join(dir,'000000.jsonl')).size/1048576),results};fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/git-record-memory.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
    }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
