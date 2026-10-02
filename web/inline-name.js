// One editor for every displayed project, session and node title.
// The portal avoids nesting inputs/buttons inside navigation or graph buttons.
export function installInlineNames({describe,saved,onError,translate=x=>x}) {
    let current=null,clickTimer=null;
    const clearClick=()=>{clearTimeout(clickTimer);clickTimer=null;};
    const close=()=>{if(!current)return;current.anchor.classList.remove('inline-name-editing');current.box.remove();current=null;};
    const position=()=>{
        if(!current)return;if(!current.anchor.isConnected){close();return;}
        const range=document.createRange();range.selectNodeContents(current.anchor);const r=range.getBoundingClientRect(),style=getComputedStyle(current.anchor),width=Math.min(Math.max(r.width+42,150),innerWidth-16);
        current.input.style.font=style.font;current.input.style.letterSpacing=style.letterSpacing;current.input.style.lineHeight=r.height+'px';
        Object.assign(current.box.style,{left:Math.max(8,Math.min(r.left-7,innerWidth-width-8))+'px',top:Math.max(4,r.top-4)+'px',width:width+'px',height:(r.height+8)+'px',boxSizing:'border-box'});
    };
    const begin=anchor=>{
        clearClick();if(current?.saving)return;close();const edit=describe(anchor);if(!edit)return;
        const box=document.createElement('form');box.className='inline-name-editor';box.setAttribute('popover','manual');box.setAttribute('aria-label',edit.label);box.noValidate=true;
        const input=document.createElement('input');input.value=edit.value||'';input.maxLength=200;input.setAttribute('aria-label',edit.label);input.autocomplete='off';
        const confirm=document.createElement('button');confirm.type='submit';confirm.textContent='✓';confirm.title=translate('Save name');confirm.setAttribute('aria-label',translate('Save name'));
        const error=document.createElement('span');error.className='inline-name-error';error.setAttribute('role','alert');
        box.append(input,confirm,error);document.body.append(box);box.showPopover();anchor.classList.add('inline-name-editing');current={anchor,box,input,saving:false};position();input.focus();input.select();
        input.onkeydown=e=>{if(e.key==='Enter'&&(e.isComposing||e.keyCode===229)){e.preventDefault();e.stopPropagation();return;}if(e.key==='Escape'){e.preventDefault();const target=current.anchor;close();target.closest('button')?.focus();}e.stopPropagation();};
        box.onsubmit=async e=>{
            e.preventDefault();if(!current||current.saving||e.isComposing)return;const name=input.value.trim();if(!name){error.textContent=translate('Enter a name.');input.focus();return;}
            current.saving=true;input.disabled=true;confirm.disabled=true;box.setAttribute('aria-busy','true');
            try{await edit.save(name);close();await saved();}catch(reason){if(current){current.saving=false;input.disabled=false;confirm.disabled=false;box.removeAttribute('aria-busy');error.textContent=reason.message;input.focus();}else onError?.(reason);}
        };
    };
    document.addEventListener('pointerdown',e=>{clearClick();if(current&&!current.box.contains(e.target)&&!current.saving)close();},true);
    document.addEventListener('click',e=>{
        if(current?.box.contains(e.target)){e.stopPropagation();return;}
        const anchor=e.target.closest?.('[data-name-kind]');if(!anchor)return;
        // Keyboard/programmatic clicks keep their ordinary single-click behavior.
        if(!e.detail)return;
        e.preventDefault();e.stopImmediatePropagation();clearClick();
        if(e.detail===1)clickTimer=setTimeout(()=>{anchor.closest('[data-open],[data-scope],[data-node],[data-rail],[data-focus-node]')?.click();},200);
    },true);
    document.addEventListener('dblclick',e=>{const anchor=e.target.closest?.('[data-name-kind]');if(anchor){e.preventDefault();e.stopImmediatePropagation();begin(anchor);}},true);
    document.addEventListener('keydown',e=>{if(e.key==='F2'){const anchor=e.target.closest?.('[data-name-kind]')||e.target.querySelector?.('[data-name-kind]');if(anchor){e.preventDefault();begin(anchor);}}},true);
    document.addEventListener('dragstart',e=>{if(current||e.target.closest?.('[data-name-kind]')){clearClick();if(current)e.preventDefault();}},true);
    window.addEventListener('scroll',position,true);window.addEventListener('resize',position);
    return {begin,cancel:close,get editing(){return !!current;}};
}
