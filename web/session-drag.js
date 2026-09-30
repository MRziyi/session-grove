// Delegation survives list refreshes; native drag events retain normal click/selection behavior.
export function installSessionDrag({canDrag,items,selected,projects,move,expandOlder}) {
    let drag=null,frame=0,lastTime=0,point=null,highlight=null,expandTimer=null,expandTarget=null;
    const clearHighlight=()=>{highlight?.classList.remove('project-drop-target');highlight=null;};
    const end=()=>{cancelAnimationFrame(frame);frame=0;lastTime=0;point=null;drag=null;clearTimeout(expandTimer);expandTarget=null;clearHighlight();document.body.classList.remove('session-dragging');document.querySelectorAll('.session-row.dragging').forEach(el=>el.classList.remove('dragging'));};
    const targetAt=(x,y)=>{
        const el=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,x)),Math.max(0,Math.min(innerHeight-1,y)));
        const target=el?.closest('[data-project-group],.project-directory [data-scope]');
        const id=target?.dataset.projectGroup||target?.dataset.scope;
        return target&&projects().some(p=>p.id===id&&!p.archived)?{el:target,id}:null;
    };
    const updateTarget=()=>{
        clearHighlight();if(!point)return;
        const target=targetAt(point.x,point.y);
        if(target&&drag?.some(item=>(item.projectId||'00000000-0000-4000-8000-000000000001')!==target.id)){highlight=target.el;highlight.classList.add('project-drop-target');}
        const toggle=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,point.x)),Math.max(0,Math.min(innerHeight-1,point.y)))?.closest('[data-older-projects]');
        if(toggle!==expandTarget){clearTimeout(expandTimer);expandTarget=toggle;if(toggle?.getAttribute('aria-expanded')==='false')expandTimer=setTimeout(()=>{expandOlder();},650);}
    };
    const tick=time=>{
        if(!drag||!point)return;
        const dt=Math.min(40,lastTime?time-lastTime:16);lastTime=time;
        const containers=[document.querySelector('.project-directory-scroll'),document.querySelector('#session-list')];
        for(const el of containers){
            if(!el||el.scrollHeight<=el.clientHeight)continue;
            const r=el.getBoundingClientRect();if(point.x<r.left||point.x>r.right)continue;
            const top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),edge=Math.min(70,(bottom-top)/3);
            const speed=point.y<top+edge?-Math.min(1,(top+edge-point.y)/edge):point.y>bottom-edge?Math.min(1,(point.y-bottom+edge)/edge):0;
            if(speed)el.scrollBy({top:speed*dt*.9,behavior:'instant'});
        }
        updateTarget();frame=requestAnimationFrame(tick);
    };
    document.addEventListener('dragstart',e=>{
        const row=e.target.closest?.('#session-list [data-item]');
        if(!row||!canDrag()||e.target.closest('input')){if(row)e.preventDefault();return;}
        const source=items().find(i=>i.id===row.dataset.item);if(!source){e.preventDefault();return;}
        const ids=selected();drag=ids.has(source.id)?items().filter(i=>ids.has(i.id)):[source];
        e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-grove-sessions',JSON.stringify(drag.map(i=>i.id)));
        e.dataTransfer.setData('text/plain',drag.map(i=>i.name).join('\n'));
        for(const el of document.querySelectorAll('#session-list [data-item]'))if(drag.some(i=>i.id===el.dataset.item))el.classList.add('dragging');
        document.body.classList.add('session-dragging');point={x:e.clientX,y:e.clientY};frame=requestAnimationFrame(tick);
    });
    document.addEventListener('dragover',e=>{
        if(!drag)return;e.preventDefault();point={x:e.clientX,y:e.clientY};updateTarget();e.dataTransfer.dropEffect=highlight?'move':'none';
    });
    document.addEventListener('drop',e=>{
        if(!drag)return;e.preventDefault();
        const target=targetAt(e.clientX,e.clientY),ids=target?drag.filter(i=>(i.projectId||'00000000-0000-4000-8000-000000000001')!==target.id).map(i=>i.id):[];
        end();if(ids.length)move(ids,target.id);
    });
    document.addEventListener('dragend',end);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')end();});
    window.addEventListener('blur',end);
}
