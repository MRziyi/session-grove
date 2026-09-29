import fs from 'node:fs';
import path from 'node:path';
import { assert, hash, safePath } from './util.js';

export function auxiliarySnapshot(directory) {
    const files = []; let bytes = 0;
    function visit(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            assert(!entry.isSymbolicLink(), 'Claude companion symlinks cannot be captured.');
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile()) {
                const content = fs.readFileSync(file); bytes += content.length;
                assert(bytes <= 32 * 1024 * 1024 && files.length < 2000, 'Claude companion files exceed the supported snapshot size.');
                files.push({ path: path.relative(directory, file), sha256: hash(content), data: content.toString('base64') });
            }
        }
    }
    visit(directory); return files;
}
export function auxiliaryStamp(directory) {
    const stamps = [];
    function visit(dir) {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, e.name);
            assert(!e.isSymbolicLink(), 'Claude companion symlinks cannot be captured.');
            if (e.isDirectory()) visit(file);
            else { const s = fs.statSync(file); stamps.push([file, s.size, s.mtimeMs, s.ctimeMs]); }
        }
    }
    visit(directory); return hash(JSON.stringify(stamps));
}
export function auxiliaryWrites(root, directory, entries) {
    assert(Array.isArray(entries) && entries.length < 2000, 'Invalid companion snapshot.');
    let bytes = 0;
    return entries.map(entry => {
        assert(typeof entry.path === 'string' && entry.path.length && !path.isAbsolute(entry.path) && !entry.path.split(/[\\/]/).some(p => !p || p === '.' || p === '..'), 'Invalid companion path.');
        assert(typeof entry.data === 'string' && entry.data.length <= 44 * 1024 * 1024, 'Invalid companion content.');
        const content = Buffer.from(entry.data, 'base64'); bytes += content.length;
        assert(bytes <= 32 * 1024 * 1024 && hash(content) === entry.sha256, 'Companion integrity check failed.');
        return [safePath(root, path.join(directory, entry.path)), content];
    });
}
