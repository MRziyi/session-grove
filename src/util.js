import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = value => createHash('sha256').update(value).digest('hex');
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function assert(test, message, status) { if (!test)
    fail(message, status); }
export function text(value, label = '名称', max = 200) {
    assert(typeof value === 'string' && value.trim() && value.length <= max, `${label}不能为空，最多 ${max} 字符`);
    return value.trim();
}
export function atomic(file, content, {durable=true} = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${id()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, content);
        if(durable)fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
}
export function json(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return fallback;
        throw e;
    }
}
export function inside(root, file) {
    const rel = path.relative(path.resolve(root), path.resolve(file));
    return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export function safePath(root, file) {
    assert(inside(root, file), '路径超出配置的数据目录');
    let current = path.resolve(file);
    while (inside(root, current)) {
        if (fs.existsSync(current))
            assert(!fs.lstatSync(current).isSymbolicLink(), '不向符号链接写入原生记录');
        if (current === path.resolve(root))
            break;
        current = path.dirname(current);
    }
    return file;
}
export function walk(root, limit = 20000) {
    const out = [];
    function visit(dir) {
        if (!fs.existsSync(dir))
            return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isSymbolicLink())
                continue;
            const file = path.join(dir, e.name);
            if (e.isDirectory())
                visit(file);
            else if (e.isFile() && e.name.endsWith('.jsonl'))
                out.push(file);
            assert(out.length <= limit, '记录数量过多，请缩小数据目录');
        }
    }
    visit(root);
    return out;
}

// Bound provider concurrency and drain in-flight requests before reporting errors.
export async function mapConcurrent(values, operation, limit = 4) {
    let cursor = 0, failure;
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
        while (!failure) {
            const index = cursor++; if (index >= values.length) return;
            try { await operation(values[index], index); } catch (e) { failure ||= e; }
        }
    }));
    if (failure) throw failure;
}
