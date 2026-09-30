// Synthetic, isolated Git resource audit. No credentials or personal history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {AutoSync} from '../src/auto-sync.js';
import {Native} from '../src/native.js';
import {GitRemote} from '../src/git-remote.js';
import {codexSample} from '../src/demo.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-git-performance-'));
const remote=path.join(root,'remote.git');execFileSync('git',['init','--bare','-b','main',remote],{stdio:'ignore',windowsHide:true});
const config={url:remote,allowLocal:true,provider:'git'},a=new Store(path.join(root,'a')),b=new Store(path.join(root,'b'));
const first=new AutoSync(a,()=>config,null,{provider:'git'}),second=new AutoSync(b,()=>config,null,{provider:'git'});
const roots={codex:path.join(root,'codex'),claude:path.join(root,'claude')},native=new Native(a,{roots,guard:()=>{}});
const phases=[],commands=[],run=GitRemote.prototype.run,lag=monitorEventLoopDelay({resolution:10});lag.enable();
GitRemote.prototype.run=function(args,options){commands.push(args[0]);return run.call(this,args,options);};
async function measure(name,fn){
    global.gc?.();await new Promise(r=>setTimeout(r,15));lag.reset();
    const cpu=process.cpuUsage(),start=performance.now(),offset=commands.length,changes=a.db.prepare('SELECT total_changes() n').get().n+b.db.prepare('SELECT total_changes() n').get().n;
    await fn();await new Promise(r=>setTimeout(r,15));
    const memory=process.memoryUsage(),operations=commands.slice(offset);
    phases.push({name,wallMs:Math.round(performance.now()-start-15),cpuMs:Math.round(Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000),rssMiB:Math.round(memory.rss/1048576),heapMiB:Math.round(memory.heapUsed/1048576),eventLoopMaxMs:Math.round(lag.max/1e6),sqliteRowsChanged:a.db.prepare('SELECT total_changes() n').get().n+b.db.prepare('SELECT total_changes() n').get().n-changes,gitCommands:operations.length,remoteChecks:operations.filter(c=>c==='ls-remote').length,fetches:operations.filter(c=>c==='fetch').length,pushes:operations.filter(c=>c==='push').length});
}
try{
    fs.mkdirSync(path.join(roots.codex,'sessions'),{recursive:true});
    for(let i=0;i<40;i++)fs.writeFileSync(path.join(roots.codex,'sessions',i+'.jsonl'),codexSample(root,Array.from({length:20},(_,j)=>['Question '+i+'/'+j,('Answer '+i+'/'+j+' ').repeat(100)])));
    await measure('cold capture',()=>native.refreshLocal());
    await measure('warm capture',()=>native.refreshLocal());
    await measure('first Push',()=>first.flush('push',true));
    await measure('new device Pull',()=>second.flush('pull',true));
    await measure('unchanged Pull',()=>second.flush('pull',true));
    const unchanged=phases.at(-1);assert.equal(unchanged.remoteChecks,1);assert.equal(unchanged.fetches,0);
    const branch=a.all('branch')[0];a.edit(branch.id,{name:'Metadata rename'});
    const before=first.cloud.connection.remote.head;
    await measure('rename Push',()=>first.flush('push',true));
    const files=execFileSync('git',['--git-dir',remote,'diff','--name-only',before,'main'],{encoding:'utf8',windowsHide:true});assert.ok(!files.includes('records/'));
    await measure('200 idle status/list cycles',()=>{for(let i=0;i<200;i++){first.status();a.snapshot();a.listing('projects');}});
    assert.equal(phases.at(-1).gitCommands,0);assert.equal(phases.at(-1).sqliteRowsChanged,0);
    const report={platform:process.platform,node:process.version,sessions:40,turnsPerSession:20,phases,metadataPushChangedRecordFiles:false,peakRssKiB:process.resourceUsage().maxRSS,energy:'CPU, memory and I/O proxies only; electrical energy was not measured.'};
    fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/git-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{GitRemote.prototype.run=run;lag.disable();first.close();second.close();a.close();b.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
