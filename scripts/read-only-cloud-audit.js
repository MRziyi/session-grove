// Explicit local verification only: remote GET/PROPFIND, never cloud writes.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {parse,renderNative} from '../src/transcript.js';import {forkBeforeNode} from '../web/library-view.js';
import {Store} from '../src/store.js';import {Cloud} from '../src/cloud.js';import {WebDAV} from '../src/sync.js';import {vaultKey} from '../src/vault.js';import {hash} from '../src/util.js';
const root=process.argv[2],targetName=process.argv.includes('--target')?process.argv[process.argv.indexOf('--target')+1]:null;assert(root,'Provide the configured local library.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'grove-remote-audit-'));fs.chmodSync(temp,0o700);
const store=new Store(path.join(temp,'library')),config=JSON.parse(fs.readFileSync(path.join(root,'webdav.json'),'utf8')),pass=fs.readFileSync(path.join(root,'sync-key.txt'),'utf8').replace(/\r?\n$/,'');
const rootDav=new WebDAV(config),metrics={requests:0,methods:{},bytesReceived:0},protect=dav=>{dav.request=async function(method,...args){assert(['GET','HEAD','PROPFIND'].includes(method),'Read-only audit attempted a mutation.');metrics.requests++;metrics.methods[method]=(metrics.methods[method]||0)+1;return WebDAV.prototype.request.call(this,method,...args);};return dav;};protect(rootDav);
try{
 const bytes=await rootDav.get('vault.json'),vault=JSON.parse(bytes.toString()),key=vaultKey(vault,pass),dav=vault.generation?protect(rootDav.scoped('generations/'+vault.generation+'/')):rootDav;
 const cloud=new Cloud(store,()=>config);cloud.cacheKey='cloud:'+hash(rootDav.base+vault.salt);cloud.connection={dav,rootDav,key,vaultBytes:bytes};cloud.connect=async()=>cloud.connection;
 const begin=performance.now();await cloud.catalog(pass);for(const p of cloud.summaries())await cloud.project(p.id,pass);
 const items=cloud.items();metrics.bytesReceived=rootDav.metrics.bytesReceived;const report={projects:cloud.summaries().length,trees:items.length,sessions:items.reduce((n,i)=>n+i.sessions.length,0),claudeTrees:items.filter(i=>i.sessions.some(s=>s.agent==='claude')).length,targetPresent:items.some(i=>targetName&&(i.name===targetName||i.sessions.some(s=>s.name===targetName))),catalogMs:Math.round(performance.now()-begin),metrics};
 if(process.argv.includes('--samples')){
  const target=items.find(i=>targetName&&(i.name===targetName||i.sessions.some(s=>s.name===targetName)));
  const claude=items.filter(i=>i.sessions.some(s=>s.agent==='claude')).sort((a,b)=>a.sessions.reduce((n,s)=>n+(s.chats||0),0)-b.sessions.reduce((n,s)=>n+(s.chats||0),0));
  const samples=[target,claude[Math.floor(claude.length/2)],claude.at(-1)].filter(Boolean);report.samples=[];const home=path.join(temp,'claude');fs.mkdirSync(path.join(home,'projects','sample'),{recursive:true});
  for(const [index,item]of samples.entries()){
   const start=performance.now(),cpu=process.cpuUsage();await cloud.hydrate(item.id,pass);const downloaded=performance.now();const graph=store.treeGraph(item.id,'in-use');
   const candidate=graph.paths.find(p=>p.name===targetName)||graph.paths[0];
   const row={sample:index,paths:graph.paths.length,nodes:graph.nodes.length,downloadMs:Math.round(downloaded-start),graphMs:Math.round(performance.now()-downloaded),rssMB:Math.round(process.memoryUsage().rss/1048576),cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000,nodeEligibility:candidate?.nodeIds.map(id=>{const n=graph.nodes.find(n=>n.id===id);return{depth:n.depth,chats:n.count,forkBefore:!!forkBeforeNode(candidate,n),terminal:n.endBranchIds.includes(candidate.branchId)};})};report.samples.push(row);
   for(const p of graph.paths.filter(p=>p.agent==='claude').slice(0,2)){const raw=store.raw(p.head),parsed=parse(raw,'claude');fs.writeFileSync(path.join(home,'projects','sample',parsed.nativeId+'.jsonl'),raw,{mode:0o600});}
  }
  if(fs.readdirSync(path.join(home,'projects','sample')).length){const output=execFileSync(process.execPath,['scripts/claude-smoke.js',home],{encoding:'utf8',maxBuffer:1048576});report.claude=JSON.parse(output.trim());}
  report.metrics.bytesReceived=rootDav.metrics.bytesReceived;
 }
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/read-only-cloud-audit.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}finally{store.close();fs.rmSync(temp,{recursive:true,force:true});}
