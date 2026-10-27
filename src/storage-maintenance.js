import {Worker} from 'node:worker_threads';import {assert} from './util.js';
import {packRecoveryCopies} from './recovery-storage.js';

export async function optimizeStorage(store,{onProgress=async()=>{},backup=true,vacuum=true,packBackups=false,action='optimize',version}={}){
    assert(!store.storageBusy&&!store.transferReaders,'Wait for the current transfer before optimizing storage.',409);store.storageBusy=true;
    let worker;
    try{
        worker=new Worker(new URL('./storage-worker.js',import.meta.url),{workerData:{root:store.root,backup,vacuum,action,version},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32}});
        const result=await new Promise((resolve,reject)=>{let settled=false;worker.on('message',value=>{if(value.progress){Promise.resolve().then(()=>onProgress(value.progress)).catch(()=>{});return;}settled=true;value.error?reject(Error(value.error)):resolve(value.result);});worker.on('error',reject);worker.on('exit',code=>{if(!settled)reject(Error('Storage worker stopped ('+code+').'));});});
        store.storage.clear();if(packBackups)result.recoveryCopies=await packRecoveryCopies(store.root,{onProgress});await Promise.resolve().then(()=>onProgress({phase:action==='cleanup'?'Storage cleaned':'Storage optimized',completed:1,total:1})).catch(()=>{});return result;
    }finally{await worker?.terminate();store.storageBusy=false;}
}
