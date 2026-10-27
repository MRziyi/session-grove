import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';import {createGzip,createGunzip} from 'node:zlib';
import {assert,id,inside} from './util.js';
const owner='grove-recovery-storage-v1';
function snapshot(file){const s=fs.lstatSync(file,{bigint:true});assert(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n,'Recovery copy is not an independent regular file.');return {bytes:Number(s.size),mtime:String(s.mtimeNs),ino:String(s.ino),dev:String(s.dev)};}
const equal=(a,b)=>a.bytes===b.bytes&&a.mtime===b.mtime&&a.ino===b.ino&&a.dev===b.dev;
async function checksum(...streams){const digest=createHash('sha256');await pipeline(...streams,new Transform({transform(chunk,encoding,done){digest.update(chunk);done();}}));return digest.digest('hex');}

export function recoveryPackingPlan(root){
    const directory=path.join(root,'recovery-snapshots');if(!fs.existsSync(directory)||fs.lstatSync(directory).isSymbolicLink())return [];
    const files=[];const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())visit(file);else if(entry.isFile()&&entry.name.endsWith('.sqlite')){if(fs.lstatSync(file).nlink>1)continue;const state=snapshot(file),wal=file+'-wal';if(fs.existsSync(wal)&&fs.statSync(wal).size>0)continue;files.push({file,...state});}}};visit(directory);
    files.sort((a,b)=>Number(BigInt(b.mtime)-BigInt(a.mtime)));return files.slice(1);
}
export async function packRecoveryCopies(root,{onProgress=async()=>{}}={}){
    const plan=recoveryPackingPlan(root),total=plan.reduce((n,p)=>n+p.bytes,0),prepared=[];let completed=0,skipped=0;
    if(!plan.length)return {files:0,beforeBytes:0,afterBytes:0,savedBytes:0,skipped:0};
    const report=async()=>onProgress({phase:'Packing recovery copies',completed,total,unit:'bytes'});await report();
    for(const item of plan){
        assert(inside(path.join(root,'recovery-snapshots'),item.file)&&equal(snapshot(item.file),item),'Recovery copy changed. Its original was kept.');
        const target=item.file+'.gz',metadata=target+'.json';
        if(fs.existsSync(target)){
            snapshot(target);
            let saved;try{saved=JSON.parse(fs.readFileSync(metadata,'utf8'));}catch{}
            if(saved?.owner!==owner||saved.bytes!==item.bytes){skipped++;completed+=item.bytes;continue;}
            const original=await checksum(fs.createReadStream(item.file)),packed=await checksum(fs.createReadStream(target),createGunzip());assert(original===saved.sha256&&packed===original,'Recovery copy verification failed. Its original was kept.');completed+=item.bytes;
        }else{
            const temporary=target+'.tmp-'+id(),digest=createHash('sha256');let last=Date.now();
            try{
                await pipeline(fs.createReadStream(item.file),new Transform({transform(chunk,encoding,done){digest.update(chunk);completed+=chunk.length;if(Date.now()-last>150){last=Date.now();Promise.resolve().then(report).catch(()=>{});}done(null,chunk);}}),createGzip({level:1}),fs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
                const expected=digest.digest('hex'),actual=await checksum(fs.createReadStream(temporary),createGunzip());assert(actual===expected&&equal(snapshot(item.file),item),'Recovery copy verification failed. Its original was kept.');
                // Exclusive publication never replaces an existing archive.
                fs.linkSync(temporary,target);fs.writeFileSync(metadata,JSON.stringify({owner,bytes:item.bytes,sha256:expected,createdAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
            }finally{fs.rmSync(temporary,{force:true});}
        }
        prepared.push({...item,target,metadata});await report();
    }
    await onProgress({phase:'Verifying recovery copies',completed:0,total:prepared.length});
    // Validate every source again before removing any uncompressed copy.
    for(const item of prepared)assert(equal(snapshot(item.file),item),'Recovery copy changed. Its original was kept.');
    let before=0,after=0;
    for(const item of prepared){before+=item.bytes;after+=fs.statSync(item.target).size+fs.statSync(item.metadata).size;fs.unlinkSync(item.file);}
    return {files:prepared.length,beforeBytes:before,afterBytes:after,savedBytes:before-after,skipped};
}
