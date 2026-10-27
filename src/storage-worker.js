import fs from 'node:fs';import path from 'node:path';import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync,backup} from 'node:sqlite';import {createGzip,createGunzip} from 'node:zlib';import {pipeline} from 'node:stream/promises';import {Transform} from 'node:stream';import {createHash} from 'node:crypto';
import {StorageCodec,packStorage,unpackStorage,sameStorage,sameRevision} from './storage-codec.js';
import {Store} from './store.js';
import {packRevision} from './revision-codec.js';import {graphFingerprint} from './cloud-view.js';import {assert,id,safePath} from './util.js';
import {storageCleanupPlan,validateCleanupPlan} from './storage-usage.js';

const root=workerData.root,file=path.join(root,'grove.sqlite'),db=new DatabaseSync(file),storage=new StorageCodec(db);
db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON');let last=0;
const report=(phase,completed,total)=>{const now=Date.now();if(completed===0||completed===total||now-last>100){last=now;parentPort.postMessage({progress:{phase,completed,total,...(/storage recovery copy/.test(phase)?{unit:'bytes'}:{})}});}};
const payloadBytes=()=>Number(db.prepare("SELECT sum(n) n FROM (SELECT coalesce(sum(length(cast(body as blob))),0) n FROM entities UNION ALL SELECT coalesce(sum(length(cast(body as blob))),0) FROM objects UNION ALL SELECT coalesce(sum(length(cast(body as blob))),0) FROM local)").get().n);
function prepareViews(){
    const views=new Store(root);
    try{
        const trees=views.collections().items;report('Preparing fast conversation views',0,trees.length);
        for(const [i,tree]of trees.entries()){views.db.exec('BEGIN');try{views.treeGraph(tree.id);views.db.exec('COMMIT');}catch(error){views.db.exec('ROLLBACK');throw error;}report('Preparing fast conversation views',i+1,trees.length);}
        views.pruneViews();
    }finally{views.close();}
}
async function makeBackup(){
    const directory=safePath(root,path.join(root,'storage-backups'));fs.mkdirSync(directory,{recursive:true,mode:0o700});const plain=path.join(directory,'before-'+id()+'.sqlite'),packed=plain+'.gz';
    const pageBytes=db.prepare('PRAGMA page_size').get().page_size;report('Copying storage recovery copy',0,null);
    const copiedPages=await backup(db,plain,{rate:1024,progress:({totalPages,remainingPages})=>report('Copying storage recovery copy',(totalPages-remainingPages)*pageBytes,totalPages*pageBytes)});report('Copying storage recovery copy',copiedPages*pageBytes,copiedPages*pageBytes);
    fs.chmodSync(plain,0o600);const verification=new DatabaseSync(plain);try{verification.exec('PRAGMA journal_mode=DELETE');assert(verification.prepare('PRAGMA quick_check').get().quick_check==='ok','Storage recovery copy integrity check failed.');}finally{verification.close();}
    const digest=createHash('sha256');let completed=0,total=fs.statSync(plain).size;
    try{
        await pipeline(fs.createReadStream(plain),new Transform({transform(chunk,encoding,callback){digest.update(chunk);completed+=chunk.length;report('Saving storage recovery copy',completed,total);callback(null,chunk);}}),createGzip({level:1}),fs.createWriteStream(packed,{flags:'wx',mode:0o600}));
        const expected=digest.digest('hex'),check=createHash('sha256');completed=0;report('Verifying storage recovery copy',0,total);await pipeline(fs.createReadStream(packed),createGunzip(),new Transform({transform(chunk,encoding,callback){check.update(chunk);completed+=chunk.length;report('Verifying storage recovery copy',completed,total);callback();}}));
        assert(check.digest('hex')===expected,'Storage recovery copy verification failed.');
        fs.writeFileSync(packed+'.json',JSON.stringify({schema:1,bytes:total,sha256:expected,createdAt:new Date().toISOString()}),{mode:0o600});return packed;
    }catch(error){fs.rmSync(packed,{force:true});throw error;}finally{for(const file of [plain,plain+'-wal',plain+'-shm'])fs.rmSync(file,{force:true});}
}
async function optimize(){
    const before=payloadBytes(),beforeFile=fs.statSync(file).size,previous=db.prepare("SELECT body FROM local WHERE key='storage-encoding'").get();
    if(previous&&JSON.parse(unpackStorage(previous.body))?.schema===1){
        prepareViews();const free=db.prepare('PRAGMA freelist_count').get().freelist_count*db.prepare('PRAGMA page_size').get().page_size;
        if(workerData.vacuum!==false&&free>=64*1024*1024){report('Reclaiming database space',0,null);db.exec('VACUUM');db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
        return {beforeBytes:before,afterBytes:payloadBytes(),beforeFileBytes:beforeFile,afterFileBytes:fs.statSync(file).size,changedEntities:0,changedObjects:0,changedBaselines:0,backupFile:null,alreadyOptimized:true};
    }
    const backupFile=workerData.backup===false?null:await makeBackup();
    let changedEntities=0,changedObjects=0,changedBaselines=0;
    const entityIds=db.prepare("SELECT id,kind FROM entities WHERE kind IN ('revision','layout','node') AND id>? ORDER BY id LIMIT 64"),writeEntity=db.prepare('UPDATE entities SET body=? WHERE id=? AND kind=?');
    const entityTotal=db.prepare("SELECT count(*) n FROM entities WHERE kind IN ('revision','layout','node')").get().n;let cursor='',completed=0;
    report('Packing history references',0,entityTotal);
    for(;;){const rows=entityIds.all(cursor);if(!rows.length)break;db.exec('BEGIN IMMEDIATE');try{
        for(const row of rows){const raw=storage.read.get(row.kind,row.id).body,value=storage.entity(row.kind,row.id,raw),packed=storage.encodeEntity(row.kind,value);
            if(!sameStorage(raw,packed)){writeEntity.run(packed,row.id,row.kind);if(row.kind==='revision'){storage.trackRevision(row.id,packed);assert(sameRevision(storage.revision(row.id),value),'Revision changed during storage packing.');}else assert(JSON.stringify(storage.entity(row.kind,row.id,packed))===JSON.stringify(value),'Organization changed during storage packing.');changedEntities++;}
            cursor=row.id;completed++;
        }db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}report('Packing history references',completed,entityTotal);
    }
    prepareViews();
    const objectIds=db.prepare('SELECT hash FROM objects WHERE hash>? ORDER BY hash LIMIT 128'),readObject=db.prepare('SELECT body FROM objects WHERE hash=?'),writeObject=db.prepare('UPDATE objects SET body=? WHERE hash=?');
    const objectTotal=db.prepare('SELECT count(*) n FROM objects').get().n;cursor='';completed=0;report('Packing native records',0,objectTotal);
    for(;;){const rows=objectIds.all(cursor);if(!rows.length)break;db.exec('BEGIN IMMEDIATE');try{
        for(const {hash}of rows){const raw=readObject.get(hash).body;if(typeof raw==='string'){const packed=packStorage(raw);if(typeof packed!=='string'){assert(unpackStorage(packed)===raw,'Native record changed during storage packing.');writeObject.run(packed,hash);changedObjects++;}}cursor=hash;completed++;}
        db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}report('Packing native records',completed,objectTotal);
    }
    const baselines=db.prepare("SELECT key,length(cast(body as blob)) bytes,typeof(body) type FROM local WHERE key LIKE 'git-undo:%'").all(),readLocal=db.prepare('SELECT body FROM local WHERE key=?'),writeLocal=db.prepare('UPDATE local SET body=? WHERE key=?'),baselineHeader=db.prepare("SELECT json_set(body,'$.graph.revisions',json('[]')) body FROM local WHERE key=?"),baselineRows=db.prepare("SELECT value FROM local,json_each(local.body,'$.graph.revisions') WHERE local.key=?");completed=0;report('Packing sync baselines',0,baselines.length);
    for(const row of baselines){
        if(row.type==='text'){
            let value;
            if(row.bytes>32*1024*1024){
                value=JSON.parse(baselineHeader.get(row.key).body);
                for(const revision of baselineRows.iterate(row.key)){
                    const r=JSON.parse(revision.value),base=r.parent&&storage.read.get('revision',r.parent);value.graph.revisions.push(packRevision(r,base?storage.revision(r.parent,base.body):null));
                }
                const packed=packStorage(JSON.stringify(value),{force:true}),verified=storage.local(row.key,packed);assert(!verified?.graph||graphFingerprint(verified.graph)===verified.ack,'Sync baseline changed during storage packing.');writeLocal.run(packed,row.key);
            }else{
                value=storage.local(row.key,readLocal.get(row.key).body);const packed=storage.encodeLocal(row.key,value),verified=storage.local(row.key,packed);assert(JSON.stringify(verified)===JSON.stringify(value),'Sync baseline changed during storage packing.');writeLocal.run(packed,row.key);
            }changedBaselines++;
        }report('Packing sync baselines',++completed,baselines.length);
    }
    baselineHeader.get('__grove_no_baseline__');baselineRows.all('__grove_no_baseline__');
    db.prepare("INSERT OR REPLACE INTO local(key,body) VALUES ('storage-encoding',?)").run(JSON.stringify({schema:1,at:new Date().toISOString(),backupFile}));
    report('Reclaiming database space',0,null);
    if(workerData.vacuum!==false){db.exec('VACUUM');db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
    assert(db.prepare('PRAGMA quick_check').get().quick_check==='ok','Storage integrity check failed.');assert(db.prepare('PRAGMA foreign_key_check').all().length===0,'Storage dependency check failed.');
    // The recovery copy is temporary on success. A failed/interrupted migration
    // retains it; successful runs do not accumulate another complete library.
    if(backupFile){fs.rmSync(backupFile);fs.rmSync(backupFile+'.json');db.prepare("UPDATE local SET body=? WHERE key='storage-encoding'").run(JSON.stringify({schema:1,at:new Date().toISOString(),backupFile:null}));db.exec('PRAGMA wal_checkpoint(PASSIVE)');}
    return {beforeBytes:before,afterBytes:payloadBytes(),beforeFileBytes:beforeFile,afterFileBytes:fs.statSync(file).size,changedEntities,changedObjects,changedBaselines,backupFile:null,recoveryCopyVerified:!!backupFile};
}
async function cleanup(){
    report('Reviewing unused storage',0,null);const plan=await storageCleanupPlan(root);
    assert(plan.version===workerData.version,'Storage files changed. Review cleanup again.',409);
    if(!plan.groups.length)return {savedBytes:0,backupFile:null,removedBackups:0};
    validateCleanupPlan(root,plan);
    const backupFile=plan.backupCount?await makeBackup():null;
    // The new recovery point is outside the frozen deletion plan. Recheck all
    // reviewed files before removing any; changed files keep every old backup.
    validateCleanupPlan(root,plan);report('Clearing unused storage',0,plan.groups.length);
    for(const [i,group]of plan.groups.entries()){for(const file of group.paths)fs.rmSync(path.join(root,file),{recursive:true});report('Clearing unused storage',i+1,plan.groups.length);}
    const backupBytes=backupFile?fs.statSync(backupFile).size+fs.statSync(backupFile+'.json').size:0;
    return {savedBytes:plan.bytes-backupBytes,removedBytes:plan.bytes,removedBackups:plan.backupCount,backupFile,recoveryCopyVerified:!!backupFile};
}
try{const result=await (workerData.action==='cleanup'?cleanup():optimize());db.close();parentPort.postMessage({result});
}catch(error){try{db.close();}catch{}parentPort.postMessage({error:error.message});}
