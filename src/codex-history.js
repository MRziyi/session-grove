import fs from 'node:fs';
import { assert, walk } from './util.js';
// Paginated forks reference immutable byte prefixes of earlier rollout segments.
// Keep the original records (including metadata), never reconstruct them from chats.
export function readCodexHistory(file, files, stack = new Set()) {
    assert(!stack.has(file), 'Cyclic native history reference.');
    const bytes = fs.readFileSync(file); if (!bytes.length) return ''; assert(bytes.length <= 100 * 1024 * 1024, 'Native history segment exceeds 100 MB.');
    return resolve(bytes, file, files, stack);
}
function resolve(bytes, file, files, stack) {
    const raw = bytes.toString('utf8'), firstLine = raw.indexOf('\n');
    let header; try { header = JSON.parse(raw.slice(0, firstLine < 0 ? undefined : firstLine)); } catch { throw new Error('Incomplete native history header.'); }
    const base = header.payload?.history_base;
    if (!base) return raw;
    assert(typeof base.thread_id === 'string' && /^[a-f0-9-]{36}$/.test(base.thread_id) && Number.isSafeInteger(base.end_byte_offset) && base.end_byte_offset > 0 && Number.isSafeInteger(base.end_ordinal_exclusive), 'Unsupported native history reference.');
    assert(base.end_byte_offset <= 100 * 1024 * 1024 && stack.size < 64, 'Native history reference exceeds the supported bounds.');
    const next = new Set(stack); next.add(file);
    const candidates = files.filter(candidate => candidate !== file && !next.has(candidate) && candidate.includes(base.thread_id));
    for (const candidate of candidates) {
        const stat = fs.statSync(candidate); if (stat.size < base.end_byte_offset) continue;
        const fd = fs.openSync(candidate, 'r'), prefix = Buffer.alloc(base.end_byte_offset);
        try { assert(fs.readSync(fd, prefix, 0, prefix.length, 0) === prefix.length, 'Native history prefix changed while reading.'); } finally { fs.closeSync(fd); }
        if (prefix.at(-1) !== 10) continue;
        let first, last; try { const text = prefix.toString('utf8'); first = JSON.parse(text.slice(0,text.indexOf('\n'))); last = JSON.parse(text.slice(text.lastIndexOf('\n',text.length-2)+1)); } catch { continue; }
        if (last.ordinal !== base.end_ordinal_exclusive - 1 || !(first.payload?.id === base.thread_id || candidate.endsWith('_' + base.thread_id + '.jsonl'))) continue;
        const before = resolve(prefix, candidate, files, next);
        assert(Buffer.byteLength(before) + bytes.length <= 100 * 1024 * 1024, 'Resolved native history exceeds 100 MB.');
        return before + raw;
    }
    throw new Error('Native history prefix is missing. Keep the earlier rollout segments available.');
}
export const codexFiles = root => ['sessions','archived_sessions'].flatMap(dir => walk(root + '/' + dir));
export function supportedHistory(parsed) {
    if (!parsed.meta?.history_mode || parsed.meta.history_mode === 'legacy') return true;
    if (parsed.meta.history_mode !== 'paginated') return false;
    const rows = parsed.records.filter(r => r.value);
    return rows.length > 0 && rows[0].value.ordinal === 0 && rows.every((r,i) => Number.isSafeInteger(r.value.ordinal) && (i === 0 || r.value.ordinal > rows[i-1].value.ordinal));
}
