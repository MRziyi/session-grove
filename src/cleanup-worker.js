import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';import path from 'node:path';
import {prepareCleanupPlan} from './trash.js';
const db=new DatabaseSync(path.join(workerData.root,'grove.sqlite'),{readOnly:true});
try{
    db.exec('PRAGMA busy_timeout=5000; BEGIN');
    const all=db.prepare('SELECT body FROM entities WHERE kind=?'),get=db.prepare('SELECT body FROM entities WHERE kind=? AND id=?'),local=db.prepare('SELECT body FROM local WHERE key=?');
    const store={db,root:workerData.root,objectStatement:db.prepare('SELECT body FROM objects WHERE hash=?'),all:kind=>all.all(kind).map(r=>JSON.parse(r.body)),get:(kind,id)=>{const row=get.get(kind,id);if(!row)throw Error('Missing cleanup dependency.');return JSON.parse(row.body);},find:(kind,id)=>{const row=get.get(kind,id);return row&&JSON.parse(row.body);},local:key=>{const row=local.get(key);return row?JSON.parse(row.body):null;}};
    const plan=prepareCleanupPlan(store);db.exec('COMMIT');db.close();parentPort.postMessage({plan});
}catch(error){try{db.close();}catch{}parentPort.postMessage({error:error.message});}
