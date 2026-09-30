import {rootOf,metadata} from './organization.js';
import {isTrashed} from './trash.js';
import {id,now} from './util.js';

// 1.0.x stored a transcript-only helper plus the discarded path ID in the same
// recovery event. Use that explicit provenance and verified conversation prefix
// to reconnect it. Never infer ancestry from a title or a working directory.
export function repairLegacyRecoveries(store) {
    const repaired=[],skipped=[];
    for(const entry of store.local('trashEntries')||[]){
        if(!entry.restoredAt)continue;
        for(const branch of store.all('branch').filter(b=>!b.parentId&&!b.synthetic&&!isTrashed(store,b.id)&&entry.branchIds.includes(b.chatIdentity))){
            const originals=entry.branchIds.map(id=>store.find('branch',id)).filter(b=>b?.parentId&&b.agent===branch.agent);
            if(originals.length!==1)continue;
            const original=originals[0];
            try{
                let parent=store.get('branch',original.parentId);
                while(!store.find('revision',parent.head)&&parent.parentId)parent=store.get('branch',parent.parentId);
                const root=rootOf(store,parent.id);
                // A whole-tree tombstone would suppress a newly attached path.
                const events=[...(store.local('trashState')?.events||[]),...(store.local('trashPending')||[])];
                if(events.some(e=>(e.treeIds||[]).includes(root.id)))continue;
                const parentParsed=store.parsed(parent.head,parent.agent),prefix=parentParsed.messages.filter(m=>m.role!=='tool');
                const parsed=store.parsed(branch.head,branch.agent),messages=parsed.messages.filter(m=>m.role!=='tool');
                let count=0;while(count<Math.min(prefix.length,messages.length)&&prefix[count].role===messages[count].role&&prefix[count].text===messages[count].text)count++;
                if(count<2)continue;
                let end,parentEnd;
                while(count>=2){
                    end=parsed.checkpoints.find(c=>c.end>=messages[count-1].line&&(!messages[count]||c.end<messages[count].line))?.end;
                    parentEnd=parentParsed.checkpoints.find(c=>c.end>=prefix[count-1].line&&(!prefix[count]||c.end<prefix[count].line))?.end;
                    if(end&&parentEnd)break;count--;
                }
                if(!end||!parentEnd)continue;
                const before=store.treeGraph(branch.id),oldLayout=branch.layoutHead&&store.find('layout',branch.layoutHead);
                store.transaction(()=>{
                    store.put('branch',metadata(branch,{parentId:parent.id,projectId:root.projectId,forkRevision:parent.head,forkEnd:end,forkParentEnd:parentEnd,recoveryIdentity:original.id,layoutHead:null}));
                    const after=store.treeGraph(branch.id),restored=after.paths.find(p=>p.branchId===branch.id),previous=before.paths.find(p=>p.branchId===branch.id),assignments={};
                    // Recover historical annotations for the restored prefix/suffix,
                    // then give current shared annotations precedence.
                    const chats=new Set(restored.messages.map(m=>m.id));
                    for(const layout of store.all('layout').filter(l=>l.rootId===root.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))
                        for(const [chat,value] of Object.entries(layout.assignments))if(chats.has(chat))assignments[chat]=value;
                    for(const [index,message] of previous.messages.entries())if(oldLayout?.assignments[message.id])assignments[restored.messages[index].id]=oldLayout.assignments[message.id];
                    const current=root.layoutHead&&store.find('layout',root.layoutHead);
                    const layout={id:id(),rootId:root.id,parent:root.layoutHead||null,createdAt:now(),assignments:{...assignments,...(current?.assignments||{})}};
                    store.put('layout',layout);store.put('branch',metadata(store.get('branch',root.id),{layoutHead:layout.id}));
                    const audit={entryId:entry.id,branchId:branch.id,before:branch,rootId:root.id,previousLayout:root.layoutHead||null,at:now()};
                    store.local('recoveryLineageRepairs',[...(store.local('recoveryLineageRepairs')||[]),audit]);
                });
                repaired.push(branch.id);
            }catch(error){skipped.push({branchId:branch.id,reason:error.message});}
        }
    }
    return {repaired,skipped};
}
