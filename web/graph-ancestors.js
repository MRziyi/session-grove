export function pinnedAncestors(tree,layout,camera,width,height,branchId,nodeId){
    if(width<180||height<100)return null;
    const nodes=new Map(tree.nodes.map(n=>[n.id,n]));
    const rect=id=>{const p=layout.positions.get(id);return p&&{x:camera.x+p.x*camera.zoom,y:camera.y+p.y*camera.zoom,width:148*camera.zoom,height:80*camera.zoom};};
    const intersects=r=>r&&r.x+r.width>0&&r.x<width&&r.y+r.height>0&&r.y<height;
    const current=tree.paths.find(p=>p.branchId===branchId);
    const visible=tree.nodes.filter(n=>intersects(rect(n.id)));
    const score=n=>{const r=rect(n.id);return Math.abs((r.x+r.width/2)/width-.5)+Math.abs((r.y+r.height/2)/height-.5)-(n.id===nodeId ? .15 : 0)-(current?.nodeIds.includes(n.id) ? .04 : 0);};
    visible.sort((a,b)=>score(a)-score(b)||rect(b.id).y-rect(a.id).y);const focus=visible[0];if(!focus)return null;
    const paths=tree.paths.filter(p=>p.nodeIds.includes(focus.id));
    const path=paths.find(p=>p.branchId===branchId)||paths.sort((a,b)=>Math.abs(rect(a.nodeIds.at(-1)).x-width/2)-Math.abs(rect(b.nodeIds.at(-1)).x-width/2))[0];
    if(!path)return null;
    const ancestors=path.nodeIds.slice(0,path.nodeIds.indexOf(focus.id)).filter(id=>{const r=rect(id);return r&&(r.x<0||r.x+r.width>width||r.y<0||r.y+r.height>height);});
    if(!ancestors.length)return null;
    const focusRect=rect(focus.id),lastIndex=path.nodeIds.indexOf(ancestors.at(-1)),connectionId=path.nodeIds.slice(lastIndex+1).find(id=>intersects(rect(id)))||focus.id,connection=rect(connectionId);
    // Keep the chain away from the cropped side, where other branches remain.
    const side=ancestors.some(id=>rect(id).x<0)?'right':ancestors.some(id=>rect(id).x+rect(id).width>width)?'left':connection.x+connection.width/2<width/2?'right':'left';
    const cardWidth=Math.min(148,width*.42),x=side==='left'?6:width-cardWidth-6;
    const items=ancestors.map((id,index)=>({id,node:nodes.get(id),x,y:6+index*36,width:cardWidth,height:30}));
    const rail={x,y:6,width:cardWidth,height:Math.min(height-12,items.length*36-6)};
    return {branchId:path.branchId,focusId:focus.id,focus:focusRect,connectionId,connection,side,items,rail};
}
