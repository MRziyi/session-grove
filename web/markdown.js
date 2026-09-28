// A deliberately small Markdown renderer: raw HTML is always text, remote images
// never load, and links accept only http(s), mailto or local document anchors.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(value) {
    const saved=[]; const hold=html=>`\u0000${saved.push(html)-1}\u0000`;
    let text=String(value).replace(/\u0000/g,'').replace(/`([^`\n]+)`/g,(_,v)=>hold('<code>'+escapeHtml(v)+'</code>'));
    text=text.replace(/!?\[([^\]\n]+)\]\(([^\s)]+)\)/g,(all,label,url)=>{
        const safe=/^(https?:\/\/|mailto:|#)/i.test(url);
        return hold(all.startsWith('!') ? '<span class="markdown-image">'+escapeHtml(label)+' · '+escapeHtml(url)+'</span>' : safe?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`:escapeHtml(label));
    });
    text=escapeHtml(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_\n]+)__/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/~~([^~\n]+)~~/g,'<del>$1</del>');
    return text.replace(/\u0000(\d+)\u0000/g,(_,i)=>saved[Number(i)]);
}
export function markdown(value) {
    const lines=String(value??'').replace(/\r\n/g,'\n').split('\n'),out=[];let i=0;
    const special=line=>/^\s*$|^\s*```|^#{1,6}\s|^\s*>|^\s*(?:[-*+] |\d+\. )|^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);
    while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
        const fence=line.match(/^\s*(```+|~~~+)([\w+-]*)\s*$/);if(fence){i++;const body=[];while(i<lines.length&&!lines[i].startsWith(fence[1]))body.push(lines[i++]);i++;out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);continue;}
        const heading=line.match(/^(#{1,6})\s+(.*)$/);if(heading){out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);i++;continue;}
        if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){out.push('<hr>');i++;continue;}
        if(/^\s*>/.test(line)){const block=[];while(i<lines.length&&/^\s*>/.test(lines[i]))block.push(lines[i++].replace(/^\s*>\s?/,''));out.push('<blockquote>'+markdown(block.join('\n'))+'</blockquote>');continue;}
        if(/^\s*(?:[-*+] |\d+\. )/.test(line)){const tag=/^\s*\d+\./.test(line)?'ol':'ul',items=[];while(i<lines.length&&/^\s*(?:[-*+] |\d+\. )/.test(lines[i]))items.push('<li>'+inline(lines[i++].replace(/^\s*(?:[-*+] |\d+\. )/,''))+'</li>');out.push(`<${tag}>${items.join('')}</${tag}>`);continue;}
        if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-+:?\s*\|/.test(lines[i+1])){const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());const head=cells(line);i+=2;const rows=[];while(i<lines.length&&lines[i].includes('|')&&lines[i].trim())rows.push(cells(lines[i++]));out.push('<div class="markdown-table"><table><thead><tr>'+head.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');continue;}
        const paragraph=[line];i++;while(i<lines.length&&!special(lines[i])&&!/^\s*~~~/.test(lines[i]))paragraph.push(lines[i++]);out.push('<p>'+paragraph.map(inline).join('<br>')+'</p>');
    }return out.join('');
}
