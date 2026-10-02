// Read-only source audit: all writes, scans and synthetic probes use a disposable
// SQLite backup. No credentials, native histories or remote repositories are used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {pathToFileURL,fileURLToPath} from 'node:url';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const library=option('--library');
if(!library)throw Error('Usage: node --expose-gc scripts/local-resource-benchmark.js --library PATH [--source PATH]');
const source=path.resolve(option('--source')||fileURLToPath(new URL('..',import.meta.url)));
const {Store}=await import(pathToFileURL(path.join(source,'src/store.js')));
const {GitCloud}=await import(pathToFileURL(path.join(source,'src/git-cloud.js')));
const {codexSample}=await import(pathToFileURL(path.join(source,'src/demo.js')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-local-resource-'));
fs.chmodSync(root,0o700);
let store;const phases=[];
try{
    const input=new DatabaseSync(path.join(path.resolve(library),'grove.sqlite'),{readOnly:true});
    try{await backup(input,path.join(root,'grove.sqlite'));}finally{input.close();}
    const device=path.join(path.resolve(library),'device.json');if(fs.existsSync(device))fs.copyFileSync(device,path.join(root,'device.json'));
    function measure(name,fn){
        global.gc?.();const before=process.cpuUsage(),start=performance.now(),writes=store?.db.prepare('SELECT total_changes() n').get().n||0;
        let recordReads=0;const read=store?.objectStatement.get.bind(store.objectStatement);
        if(read)store.objectStatement.get=(...args)=>{recordReads++;return read(...args);};
        try{const result=fn(),memory=process.memoryUsage();phases.push({name,wallMs:Math.round(performance.now()-start),cpuMs:Math.round(Object.values(process.cpuUsage(before)).reduce((a,b)=>a+b)/1000),rssMiB:Math.round(memory.rss/1048576),heapMiB:Math.round(memory.heapUsed/1048576),recordReads,sqliteRowsChanged:store?store.db.prepare('SELECT total_changes() n').get().n-writes:0});return result;}
        finally{if(read)store.objectStatement.get=read;}
    }
    store=measure('open',()=>new Store(root));
    const database={integrity:store.db.prepare('PRAGMA quick_check').get().quick_check,pages:store.db.prepare('PRAGMA page_count').get().page_count,pageSize:store.db.prepare('PRAGMA page_size').get().page_size,freePages:store.db.prepare('PRAGMA freelist_count').get().freelist_count,branches:store.all('branch').length,revisions:store.db.prepare("SELECT count(*) n FROM entities WHERE kind='revision'").get().n,objects:store.db.prepare('SELECT count(*) n FROM objects').get().n};
    const cloud=new GitCloud(store,()=>({}));
    measure('collections',()=>store.collections());
    measure('cold fingerprints',()=>cloud.dirtyIds());
    measure('200 unchanged status/list cycles',()=>{for(let i=0;i<200;i++){cloud.dirtyIds();store.snapshot();store.listing('active:codex','');}});
    const trees=[...store.collections().items].sort((a,b)=>b.sessionIds.length-a.sessionIds.length).slice(0,3);
    for(const [index,item] of trees.entries()){
        measure('tree '+index+' cold ('+item.sessionIds.length+' paths)',()=>store.treeGraph(item.id));
        measure('tree '+index+' warm',()=>store.treeGraph(item.id));
    }
    if(trees.length){const branch=store.get('branch',trees[0].id);measure('unchanged metadata write',()=>{store.put('branch',branch);store.snapshot();cloud.dirtyIds();});measure('changed metadata refresh',()=>{store.put('branch',{...branch,name:branch.name+' [probe]'});store.snapshot();cloud.dirtyIds();});}
    // Mimic discovering one unrelated session after a large library was imported.
    store.branch(null,'Synthetic resource probe','codex',codexSample(path.join(root,'unrelated'),[['Unique probe','Synthetic answer']]));
    measure('new unrelated session family inference',()=>store.detectFamilies());
    global.gc?.();const memory=process.memoryUsage();
    console.log(JSON.stringify({platform:process.platform,node:process.version,gcExposed:!!global.gc,database,phases,retained:{rssMiB:Math.round(memory.rss/1048576),heapMiB:Math.round(memory.heapUsed/1048576)},energy:'CPU and memory proxies only; no electrical power measurement. GC between phases isolates retained objects; production RSS also depends on allocator reuse.'},null,2));
}finally{store?.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
