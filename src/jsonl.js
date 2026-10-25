// JSONL records are separated by LF, not Unicode line/paragraph separators.
// Those characters are legal inside JSON strings and must survive intact.
export async function* jsonLines(chunks){
    let parts=[];
    for await(const chunk of chunks){
        let start=0,end;
        while((end=chunk.indexOf('\n',start))!==-1){
            parts.push(chunk.slice(start,end));const line=parts.join('');parts=[];
            if(line.trim())yield JSON.parse(line);
            start=end+1;
        }
        if(start<chunk.length)parts.push(chunk.slice(start));
    }
    const last=parts.join('');if(last.trim())yield JSON.parse(last);
}
