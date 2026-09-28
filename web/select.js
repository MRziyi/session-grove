// Native select semantics/form values, with a consistent keyboard-accessible popover.
let opened = null;
function close() { if (opened) { opened.popup.hidePopover?.(); opened.popup.hidden = true; opened.trigger.setAttribute('aria-expanded', 'false'); opened = null; } }
document.addEventListener('pointerdown', e => { if (opened && !opened.root.contains(e.target)) close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && opened) { const button = opened.trigger; close(); button.focus(); e.preventDefault(); } });
export function enhanceSelect(select) {
    if (select._groveSelect) { select._groveSelect.update(); return; }
    const root = document.createElement('div'); root.className = 'select-control';
    select.before(root); root.append(select); select.hidden = true; select.tabIndex = -1;
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.id);
    const label = document.createElement('span'); trigger.append(label);
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); arrow.setAttribute('viewBox', '0 0 16 16'); arrow.setAttribute('aria-hidden', 'true');
    const chevron = document.createElementNS(arrow.namespaceURI, 'path'); chevron.setAttribute('d', 'm4 6 4 4 4-4'); arrow.append(chevron); trigger.append(arrow);
    const popup = document.createElement('div'); popup.className = 'select-popup'; popup.hidden = true; popup.setAttribute('popover', 'manual'); popup.setAttribute('role', 'listbox');
    root.append(trigger, popup);
    const component = { root, trigger, popup, update: () => {
        if (opened?.root === root) close();
        label.textContent = select.selectedOptions[0]?.textContent || ''; trigger.title = label.textContent; trigger.disabled = select.disabled;
        popup.replaceChildren();
        [...select.options].forEach(option => {
            const item = document.createElement('button'); item.type = 'button'; item.className = 'select-option'; item.textContent = option.textContent; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected)); item.disabled = option.disabled;
            item.onclick = () => { select.value = option.value; close(); component.update(); select.dispatchEvent(new Event('change', { bubbles: true })); if (trigger.isConnected) trigger.focus(); };
            popup.append(item);
        });
    } };
    const show = () => {
        if (opened?.root === root) return;
        close(); opened = component; popup.hidden = false; popup.showPopover?.(); trigger.setAttribute('aria-expanded', 'true');
        const rect = trigger.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 210), innerWidth - 20);
        popup.style.width = width + 'px'; popup.style.left = Math.max(10, Math.min(rect.left, innerWidth - width - 10)) + 'px';
        popup.style.top = Math.max(8, rect.bottom + popup.offsetHeight + 6 > innerHeight ? rect.top - popup.offsetHeight - 6 : rect.bottom + 6) + 'px';
        popup.querySelector('[aria-selected=true]')?.focus();
    };
    trigger.onclick = () => opened?.root === root ? close() : show();
    let typed = '', reset;
    root.onkeydown = e => {
        const items = [...popup.querySelectorAll('button:not(:disabled)')];
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault(); if (opened?.root !== root) { show(); return; }
            const current = items.indexOf(document.activeElement), next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && e.key !== ' ') {
            clearTimeout(reset); typed += e.key.toLocaleLowerCase(); reset = setTimeout(() => typed = '', 600); show(); items.find(i => i.textContent.toLocaleLowerCase().startsWith(typed))?.focus();
        }
    };
    select.addEventListener('change', component.update); select._groveSelect = component; component.update();
}
