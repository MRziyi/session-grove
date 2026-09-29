import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:7421',job=JSON.parse(fs.readFileSync('test-results/real-sync-job.json','utf8'));
let boot=await fetch(base+'/api/bootstrap').then(r=>r.json()),token=boot.token,last='';
for(;;){
 const response=await fetch(base+'/api/status',{headers:{'X-Grove-Token':token}});if(response.status===403){boot=await fetch(base+'/api/bootstrap').then(r=>r.json());token=boot.token;continue;}
 const status=await response.json(),op=status.cloud.manualOperation||status.cloud.operation;
 const row={at:new Date().toISOString(),id:op?.id,state:op?.state,phase:op?.progress?.phase,done:op?.progress?.completed,total:op?.progress?.total,eta:op?.progress?.etaSeconds,lastUpload:status.cloud.lastUpload,error:status.cloud.error};
 const signature=JSON.stringify([row.id,row.state,row.phase,row.done,row.error]);if(signature!==last){console.log(JSON.stringify(row));last=signature;}
 if(op?.id===job.operationId&&op.state!=='running'){fs.writeFileSync('test-results/sync-result.json',JSON.stringify({...row,dirty:status.cloud.dirty,dirtyCount:status.cloud.dirtyCount},null,2));process.exit(op.state==='success'&&status.cloud.lastUpload?0:1);}
 await new Promise(r=>setTimeout(r,10000));
}
