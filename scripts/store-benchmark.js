// CPU/storage scaling benchmark; accepts an optional pre-change source directory.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const source=path.resolve(process.argv[2]||fileURLToPath(new URL('..',import.meta.url)));
const {Store}=await import(pathToFileURL(path.join(source,'src/store.js')));
const {Cloud}=await import(pathToFileURL(path.join(source,'src/cloud.js')));
const {codexSample}=await import(pathToFileURL(path.join(source,'src/demo.js')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-store-bench-')),a=new Store(path.join(root,'a')),b=new Store(path.join(root,'b')),result={sessions:400};
const measure=(name,fn)=>{global.gc?.();const cpu=process.cpuUsage(),start=performance.now();fn();result[name]={wallMs:Math.round(performance.now()-start),cpuMs:Math.round(Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000),rssMiB:Math.round(process.memoryUsage().rss/1048576)};};
try{
 measure('seed',()=>{for(let i=0;i<400;i++)a.branch(null,'Session '+i,'codex',codexSample('/benchmark',Array.from({length:4},(_,j)=>['Question '+i+'/'+j,'Answer '+i+'/'+j])));});
 const graph=a.exportGraph(),objects=Object.fromEntries(a.db.prepare('SELECT hash,body FROM objects').all().map(r=>[r.hash,r.body]));
 measure('coldFingerprints',()=>new Cloud(a,()=>({})).dirtyIds());
 measure('merge',()=>b.merge(graph,objects));
 measure('unchangedMerge',()=>b.merge(graph,{}));
 console.log(JSON.stringify(result));
}finally{a.close();b.close();fs.rmSync(root,{recursive:true,force:true});}
