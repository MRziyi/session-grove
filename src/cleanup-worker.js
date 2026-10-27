import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';import path from 'node:path';
import {prepareCleanupPlan} from './trash.js';
import {StorageCodec,unpackStorage} from './storage-codec.js';
const db=new DatabaseSync(path.join(workerData.root,'grove.sqlite'),{readOnly:true});
try{
    db.exec('PRAGMA busy_timeout=5000; BEGIN');
    const all=db.prepare('SELECT body FROM entities WHERE kind=?'),get=db.prepare('SELECT body FROM entities WHERE kind=? AND id=?'),local=db.prepare('SELECT body FROM local WHERE key=?');
    const storage=new StorageCodec(db),objects=db.prepare('SELECT body FROM objects WHERE hash=?');
    const store={db,storage,root:workerData.root,objectStatement:{get:h=>{const row=objects.get(h);return row&&{body:unpackStorage(row.body)};}},all:kind=>storage.entities(kind,all.all(kind)),get:(kind,id)=>{const row=get.get(kind,id);if(!row)throw Error('Missing cleanup dependency.');return storage.entity(kind,id,row.body);},find:(kind,id)=>{const row=get.get(kind,id);return row&&storage.entity(kind,id,row.body);},local:key=>{const row=local.get(key);return row?storage.local(key,row.body):null;}};
    const plan=prepareCleanupPlan(store);db.exec('COMMIT');db.close();parentPort.postMessage({plan});
}catch(error){try{db.close();}catch{}parentPort.postMessage({error:error.message});}
