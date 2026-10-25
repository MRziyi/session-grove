const indexes=new WeakMap();
export function searchTree(tree,query,preferredBranchId,limit=80){
    const needle=String(query||'').trim().toLocaleLowerCase();if(!needle)return {total:0,results:[]};
    let entries=indexes.get(tree);
    if(!entries){
        entries=[];const shared=new Map(),nodes=new Map(tree.nodes.map(n=>[n.id,n]));
        for(const path of tree.paths){
            const nodeByChat=new Map(path.nodeIds.flatMap(id=>(nodes.get(id)?.chatIds||[]).map(chat=>[chat,id])));
            for(const message of path.messages){
                let entry=shared.get(message.id);
                if(!entry){entry={kind:'message',messageId:message.id,text:message.text,lower:message.text.toLocaleLowerCase(),owners:[]};shared.set(message.id,entry);entries.push(entry);}
                entry.owners.push({branchId:path.branchId,nodeId:nodeByChat.get(message.id)});
            }
            entries.push({kind:'path',text:path.transcriptionTitle||path.originalTitle||path.name,owners:[{branchId:path.branchId,nodeId:path.nodeIds[0]}]});
        }
        for(const node of tree.nodes)if(node.name)entries.push({kind:'node',text:node.name,owners:node.branchIds.map(branchId=>({branchId,nodeId:node.id}))});
        indexes.set(tree,entries);
    }
    let total=0;const results=[];
    for(const entry of entries){
        const at=(entry.lower||entry.text.toLocaleLowerCase()).indexOf(needle);if(at<0)continue;total++;
        if(results.length>=limit)continue;
        const owner=entry.owners.find(p=>p.branchId===preferredBranchId)||entry.owners[0];
        const start=Math.max(0,at-45),end=Math.min(entry.text.length,at+needle.length+100);
        results.push({...owner,kind:entry.kind,messageId:entry.messageId,snippet:(start?'…':'')+entry.text.slice(start,end)+(end<entry.text.length?'…':'')});
    }
    return {total,results};
}
