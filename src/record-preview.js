// Bound browser work without changing the immutable native record. Opaque blobs
// are not readable reasoning; retain only their size in this display projection.
export function recordPreview(value, offset = 0) {
    let opaque = false;
    const text = JSON.stringify(value, (key, v) => {
        if (['encrypted_content', 'encryptedContent', 'signature', 'data'].includes(key) && typeof v === 'string' && (key !== 'data' || v.length > 1000)) {
            opaque = true; return `[preserved opaque content: ${v.length} characters]`;
        }
        return v;
    }, 2);
    const pageSize = 12000;
    offset = Number.isSafeInteger(offset) ? Math.max(0, Math.min(offset, Math.max(0,text.length-1))) : 0;
    return { text: text.slice(offset,offset+pageSize), total:text.length, pageSize, next:offset+pageSize<text.length?offset+pageSize:null, opaque };
}
