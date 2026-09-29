import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { archiveNative, codexBinary } from '../src/native-archive.js';
import { assert } from '../src/util.js';
const args=process.argv.slice(2),root=path.resolve(args[0]||''),apply=args.includes('--apply');
assert(args[0]&&fs.existsSync(path.join(root,'grove.sqlite')),'Usage: node scripts/archive-old.js LIBRARY [--apply]');
try{const pid=Number(fs.readFileSync(path.join(root,'server.lock'),'utf8'));try{process.kill(pid,0);throw Error('Stop Grove before offline maintenance.');}catch(e){if(e.code!=='ESRCH')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
const cutoff=new Date();cutoff.setUTCMonth(cutoff.getUTCMonth()-2);
const backupDir=path.join(root,'recovery-snapshots','age-'+new Date().toISOString().replace(/[:.]/g,'-'));
if(apply){fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const db=new DatabaseSync(path.join(root,'grove.sqlite'),{readOnly:true});await backup(db,path.join(backupDir,'grove.sqlite'));db.close();}
const store=new Store(root),native=new Native(store);
try{
const refreshed=native.refreshLocal();assert(!refreshed.errors.length,'Resolve local capture errors before archiving.');
const candidates=[];
for(const b of store.all('branch').filter(b=>!b.synthetic&&!b.archived&&(!b.excluded||b.background))){if(b.createdViaGroveFork&&Date.parse(b.createdAt)>=cutoff.getTime())continue;const revision=store.get('revision',b.head);if(revision.source.operation==='fork'&&Date.parse(revision.createdAt)>=cutoff.getTime())continue;const summary=store.summary(b.head,b.agent);if(!summary.lastActivity||Date.parse(summary.lastActivity)>=cutoff.getTime())continue;
 const p=store.parsed(b.head,b.agent),created=p.records.findLast(r=>r.value?.type==='session_meta'&&r.value.payload.id===p.nativeId)?.value.timestamp||p.meta?.timestamp;if(created&&Date.parse(created)>=cutoff.getTime())continue;
 candidates.push({id:b.id,head:b.head,name:b.name,agent:b.agent,lastActivity:summary.lastActivity});}
fs.mkdirSync('test-results',{recursive:true});const report={cutoff:cutoff.toISOString(),candidates,applied:false,backup:apply?backupDir:null};fs.writeFileSync('test-results/archive-plan.json',JSON.stringify(report,null,2),{mode:0o600});console.log({cutoff:report.cutoff,candidates:candidates.length,byAgent:candidates.reduce((a,b)=>(a[b.agent]=(a[b.agent]||0)+1,a),{})});
if(apply&&candidates.length){const dbFile=path.join(native.roots.codex,'state_5.sqlite');if(fs.existsSync(dbFile)){const db=new DatabaseSync(dbFile,{readOnly:true});await backup(db,path.join(backupDir,'codex-state.sqlite'));db.close();}
 const result=await archiveNative(store,native,candidates.map(b=>b.id),{executable:codexBinary(),beforeCommit:()=>{for(const b of candidates)assert(store.get('branch',b.id).head===b.head,'A candidate received new activity. Regenerate the plan.');}});
 report.applied=true;report.result=result;fs.writeFileSync('test-results/archive-plan.json',JSON.stringify(report,null,2),{mode:0o600});console.log(result);
}
}finally{store.close();}
