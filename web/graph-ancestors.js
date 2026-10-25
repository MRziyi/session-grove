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
    const first=rect(ancestors[0]),side=first.x+first.width/2<=connection.x+connection.width/2?'left':'right',cardWidth=Math.min(132,width*.42),slots=Math.max(2,Math.min(6,Math.floor((connection.y-8)/40)));
    const ids=ancestors.length<=slots?ancestors:[ancestors[0],'more',...(slots>2?ancestors.slice(-(slots-2)):[])];
    // With two slots, one root card and one aggregate preserve the whole chain.
    if(ancestors.length>slots&&slots===2)ids.splice(0,ids.length,'more',ancestors.at(-1));
    const omitted=ancestors.length>slots?(slots===2?ancestors.slice(0,-1):ancestors.slice(1,ancestors.length-(slots-2))):[];
    const items=ids.map((id,index)=>({id,node:nodes.get(id),members:id==='more'?omitted:undefined,x:side==='left'?6:width-cardWidth-6,y:6+index*40,width:cardWidth,height:34}));
    return {branchId:path.branchId,focusId:focus.id,focus:focusRect,connectionId,connection,side,items};
}
