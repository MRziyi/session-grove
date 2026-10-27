import fs from 'node:fs';import path from 'node:path';
import {assert,hash,inside,safePath} from './util.js';

const categories=['database','git','backups','temporary','trash','other'];
const category=name=>/^grove\.sqlite(?:-wal|-shm)?$/.test(name)?'database':name==='git-cache'?'git':['preflight-backups','storage-backups','recovery-snapshots'].includes(name)?'backups':name==='transfer-cache'?'temporary':name==='trash'?'trash':'other';
const state=(file,s)=>({file,bytes:Number(s.size),mtime:String(s.mtimeNs),ino:String(s.ino),dev:String(s.dev),links:Number(s.nlink),directory:s.isDirectory()});
// Inventory file metadata asynchronously; never follow links or read Git/native
// bodies to open Settings. The exact reviewed inventory also guards cleanup.
export async function storageInventory(root){
    const entries=[],blocked=[];
    async function visit(relative){
        const file=path.join(root,relative);let s;try{s=await fs.promises.lstat(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
        if(s.isSymbolicLink()||!s.isFile()&&!s.isDirectory()){blocked.push(relative);return;}
        entries.push(state(relative,s));
        if(s.isDirectory())for(const name of await fs.promises.readdir(file))await visit(path.join(relative,name));
    }
    for(const name of await fs.promises.readdir(root))await visit(name);
    entries.sort((a,b)=>a.file.localeCompare(b.file));return {entries,blocked};
}
const under=(file,directory)=>file===directory||inside(directory,file);
export async function storageCleanupPlan(root,inventory){
    inventory??=await storageInventory(root);
    const {entries,blocked}=inventory,byFile=new Map(entries.map(e=>[e.file,e])),groups=[];
    function candidate(file,kind){
        const rows=entries.filter(e=>under(e.file,file));
        if(!rows.length||blocked.some(p=>under(p,file))||rows.some(e=>!e.directory&&e.links!==1||e.file.endsWith('-wal')&&e.bytes>0))return;
        groups.push({kind,paths:[file],entries:rows,bytes:rows.filter(e=>!e.directory).reduce((n,e)=>n+e.bytes,0),mtime:rows.reduce((n,e)=>BigInt(e.mtime)>n?BigInt(e.mtime):n,0n).toString()});
    }
    if(byFile.get('transfer-cache')?.directory)candidate('transfer-cache','temporary');
    const legacy='preflight-backups';
    if(byFile.get(legacy)?.directory)for(const name of await fs.promises.readdir(path.join(root,legacy))){
        const relative=path.join(legacy,name),row=byFile.get(relative);if(!row)continue;
        const database=row.directory?path.join(relative,'grove.sqlite'):relative;
        const allowed=row.directory?entries.filter(e=>under(e.file,relative)&&!e.directory).every(e=>['grove.sqlite','grove.sqlite-wal','grove.sqlite-shm','device.json','repair-candidates.json'].includes(path.basename(e.file))&&path.dirname(e.file)===relative):name.endsWith('.sqlite');
        if(!allowed||!byFile.get(database)||byFile.get(database+'-wal')?.bytes>0)continue;
        const handle=await fs.promises.open(path.join(root,database),'r');try{const bytes=Buffer.alloc(16);await handle.read(bytes,0,16,0);if(bytes.toString()!=='SQLite format 3\0')continue;}finally{await handle.close();}
        candidate(relative,'backups');
    }
    for(const directory of ['storage-backups','recovery-snapshots'])if(byFile.get(directory)?.directory)for(const row of entries.filter(e=>path.dirname(e.file)===directory&&e.file.endsWith('.sqlite.gz'))){
        const metadata=byFile.get(row.file+'.json');if(!metadata||metadata.bytes>16384||metadata.links!==1)continue;
        let saved;try{saved=JSON.parse(await fs.promises.readFile(path.join(root,metadata.file),'utf8'));}catch{continue;}
        if(!/^[a-f0-9]{64}$/.test(saved.sha256||'')||!Number.isSafeInteger(saved.bytes)||!(saved.schema===1||['grove-recovery-storage-v1','grove-maintenance-review-v1'].includes(saved.owner)))continue;
        candidate(row.file,'backups');const group=groups.at(-1);if(group?.paths[0]!==row.file)continue;
        group.paths.push(metadata.file);group.entries.push(metadata);group.bytes+=metadata.bytes;
        const device=byFile.get(row.file.slice(0,-'.sqlite.gz'.length)+'.device.json');if(device&&!device.directory&&device.links===1){group.paths.push(device.file);group.entries.push(device);group.bytes+=device.bytes;}
    }
    const backups=groups.filter(g=>g.kind==='backups').sort((a,b)=>BigInt(a.mtime)>BigInt(b.mtime)?-1:BigInt(a.mtime)<BigInt(b.mtime)?1:a.paths[0].localeCompare(b.paths[0]));
    // Keep the newest existing point and create a fresh verified database copy
    // before deleting older points. Two remaining points need no more pruning.
    const selected=[...groups.filter(g=>g.kind==='temporary'),...(backups.length>2?backups.slice(1):[])];
    selected.sort((a,b)=>a.paths[0].localeCompare(b.paths[0]));const version=hash(JSON.stringify(selected));return {version,groups:selected,bytes:selected.reduce((n,g)=>n+g.bytes,0),backupCount:selected.filter(g=>g.kind==='backups').length,temporaryBytes:selected.filter(g=>g.kind==='temporary').reduce((n,g)=>n+g.bytes,0)};
}
export function validateCleanupPlan(root,plan){
    for(const group of plan.groups){
        const actual=[];
        const visit=relative=>{safePath(root,path.join(root,relative));const s=fs.lstatSync(path.join(root,relative),{bigint:true});assert(!s.isSymbolicLink()&&(s.isFile()||s.isDirectory()),'Storage files changed. Review cleanup again.',409);actual.push(state(relative,s));if(s.isDirectory())for(const name of fs.readdirSync(path.join(root,relative)))visit(path.join(relative,name));};
        for(const file of group.paths)visit(file);
        const sort=rows=>rows.sort((a,b)=>a.file.localeCompare(b.file));assert(JSON.stringify(sort(actual))===JSON.stringify(sort([...group.entries])),'Storage files changed. Review cleanup again.',409);
    }
}
export function storageUpgrade(store){
    if(store.local('storage-encoding')?.schema===1)return false;
    return !!(store.storageUpgradeCandidate??=!!store.db.prepare("SELECT 1 FROM entities WHERE typeof(body)='text' AND length(cast(body as blob))>=16384 UNION ALL SELECT 1 FROM objects WHERE typeof(body)='text' AND length(cast(body as blob))>=16384 LIMIT 1").get());
}
export async function storageUsage(store){
    const inventory=await storageInventory(store.root),plan=await storageCleanupPlan(store.root,inventory),totals=Object.fromEntries(categories.map(k=>[k,0]));
    for(const row of inventory.entries)if(!row.directory)totals[category(row.file.split(path.sep)[0])]+=row.bytes;
    const pageSize=store.db.prepare('PRAGMA page_size').get().page_size;
    return {totalBytes:Object.values(totals).reduce((n,v)=>n+v,0),categories:totals,needsOptimization:storageUpgrade(store),freeDatabaseBytes:store.db.prepare('PRAGMA freelist_count').get().freelist_count*pageSize,cleanup:{version:plan.version,bytes:plan.bytes,backupCount:plan.backupCount,temporaryBytes:plan.temporaryBytes,newBackupBytes:plan.backupCount?store.db.prepare('PRAGMA page_count').get().page_count*pageSize:0},scannedAt:new Date().toISOString()};
}
