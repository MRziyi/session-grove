import { randomBytes, scryptSync } from 'node:crypto';
import { seal, unseal, WebDAV } from './sync.js';
import { assert, hash, mapConcurrent } from './util.js';
export const APP_FOLDER = '/Session-Grove';
export function connectionConfig(input, previous = {}) {
    let value = String(input.url || '').trim();
    if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/Session-Grove(?:\/session-grove-v1)?$/i, '') + APP_FOLDER + '/';
    const config = { url: url.href, username: String(input.username || '').trim(), password: input.password === undefined ? previous.password || '' : String(input.password) };
    new WebDAV(config); assert(config.username && config.password, 'Enter the WebDAV username and password.');
    return config;
}
export const baseUrl = config => (config.url || '').replace(/\/Session-Grove\/?$/i, '').replace(/\/$/, '');
export function createVault(passphrase, generation) {
    assert(typeof passphrase === 'string' && (!passphrase.length || passphrase.length >= 12), 'Use at least 12 characters, or leave encryption off.');
    const salt = randomBytes(16).toString('hex'), key = passphrase ? scryptSync(passphrase, salt, 32) : null;
    return { vault: { schema: 2, mode: key ? 'encrypted' : 'plain', salt, ...(generation ? { generation } : {}), check: seal('session-grove', key).toString('base64') }, key };
}
export function vaultKey(vault, passphrase) {
    assert([1, 2].includes(vault.schema) && /^[a-f0-9]{32}$/.test(vault.salt), 'Unsupported cloud vault.');
    assert(!vault.generation || /^[a-f0-9]{32}$/.test(vault.generation), 'Invalid cloud generation.');
    assert(vault.schema === 1 || ['encrypted', 'plain'].includes(vault.mode), 'Unsupported encryption mode.');
    const key = vault.schema === 2 && vault.mode === 'plain' ? null : scryptSync(passphrase, vault.salt, 32);
    assert(unseal(Buffer.from(vault.check, 'base64'), key) === 'session-grove', 'Incorrect encryption passphrase.');
    return key;
}
export async function verifyConnection(config) {
    const dav = new WebDAV(config), app = Object.create(dav); app.base = config.url.replace(/\/$/, '') + '/';
    await app.mkdir(); await dav.mkdir();
    const name = 'connection-check-' + randomBytes(12).toString('hex'), bytes = randomBytes(32);
    try { assert(await dav.put(name, bytes, true), 'Verification file already exists.'); assert((await dav.get(name))?.equals(bytes), 'WebDAV read-back verification failed.'); }
    finally { const r = await dav.request('DELETE', name); assert(r.ok || r.status === 404, 'WebDAV cannot remove the verification file.'); }
    const bytesVault = await dav.get('vault.json');
    return { vault: bytesVault ? JSON.parse(bytesVault.toString()) : null };
}
const dirs = ['objects/', 'trees/', 'projects/', 'heads/', 'commits/'];
async function files(dav) {
    const result = [];
    for (const dir of dirs) { const r = await dav.request('PROPFIND', dir, undefined, { Depth: '1' }); if (r.status === 404) continue; assert(r.ok, 'Could not list cloud objects.');
        const xml = (await dav.readResponse(r)).toString();
        for (const m of xml.matchAll(/<(?:[\w-]+:)?href[^>]*>([^<]+)<\/(?:[\w-]+:)?href>/g)) { const name = decodeURIComponent(m[1].split('/').at(-1)); if (/^[a-f0-9T-]+\.bin$/.test(name)) result.push(dir + name); }
    } return [...new Set(result)].sort();
}
// Stage all objects in a new namespace, verify every read-back, then publish one
// conditional vault pointer. Until that switch, the previous vault stays readable.
export async function migrateVault(sourceConfig, destinationConfig, oldPassphrase, newPassphrase, progress = () => {}) {
    const source = new WebDAV(sourceConfig), target = new WebDAV(destinationConfig), same = source.base === target.base;
    const response = await source.request('GET', 'vault.json'); assert(response.ok, 'Source vault is missing.');
    const sourceBytes = await source.readResponse(response), oldVault = JSON.parse(sourceBytes), oldKey = vaultKey(oldVault, oldPassphrase);
    const etag = response.headers.get('etag');
    if (!same) assert(!await target.get('vault.json'), 'Destination already has a vault. Choose an empty application folder.');
    const lease = Buffer.from(JSON.stringify({ id: randomBytes(16).toString('hex'), startedAt: new Date().toISOString() }));
    assert(await source.put('migration.json', lease, true), 'Another migration is in progress.');
    const generation = randomBytes(16).toString('hex'), { vault, key } = createVault(newPassphrase, generation);
    const from = oldVault.generation ? source.scoped('generations/' + oldVault.generation + '/') : source;
    let committed = false, lockToken = null;
    try {
        await target.mkdir('generations/'); await target.mkdir('generations/' + generation + '/');
        const to = target.scoped('generations/' + generation + '/'); for (const dir of dirs) await to.mkdir(dir);
        const keys = await files(from), fingerprints = new Map(); let completed = 0;
        progress({ phase: 'copying', completed, total: keys.length });
        await mapConcurrent(keys, async name => { const bytes = await from.get(name); assert(bytes, 'Source changed during migration.'); const value = unseal(bytes, oldKey); fingerprints.set(name, hash(bytes));
            await to.put(name, seal(value, key), true); const read = await to.get(name); assert(read && JSON.stringify(unseal(read, key)) === JSON.stringify(value), 'Migrated object verification failed.');
            progress({ phase: 'copying', completed: ++completed, total: keys.length });
        });
        progress({ phase: 'verifying', completed, total: keys.length });
        assert(JSON.stringify(await files(from)) === JSON.stringify(keys), 'Source changed during migration; original vault is unchanged.');
        for (const name of keys.filter(n => n.startsWith('heads/'))) assert(hash(await from.get(name)) === fingerprints.get(name), 'Another device published during migration.');
        let headers = same ? { 'If-Match': etag } : { 'If-None-Match': '*' };
        if (same && (!etag || etag.startsWith('W/'))) {
            // Weak ETags cannot satisfy If-Match. Acquire the DAV write lock only
            // for the short publication phase, then recheck the old pointer under it.
            const locked = await target.request('LOCK', 'vault.json', '<?xml version="1.0"?><d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype><d:owner>Session Grove migration</d:owner></d:lockinfo>', { 'Content-Type': 'application/xml', Depth: '0', Timeout: 'Second-120' });
            await target.readResponse(locked, 1024 * 1024);
            lockToken = locked.headers.get('lock-token');
            assert(locked.ok && /^<[^<>\r\n]+>$/.test(lockToken || ''), 'Provider requires strong ETags or WebDAV locks for safe migration.');
            headers = { If: '(' + lockToken + ')' };
        }
        const fresh = await source.get('vault.json'); assert(fresh?.equals(sourceBytes), 'Cloud encryption settings changed.');
        const r = await target.request('PUT', 'vault.json', Buffer.from(JSON.stringify(vault)), headers);
        await target.readResponse(r, 1024 * 1024); assert(r.ok, `Cloud publication failed (${r.status}); original vault is unchanged.`); committed = true;
        progress({ phase: 'cleanup', completed: 0, total: same ? keys.length : 0 });
        // Delete only individually enumerated old objects after verified publication.
        // When changing providers, retain the old provider as a recoverable source.
        let cleanupPending = 0, cleaned = 0;
        if (same) await mapConcurrent(keys, async name => { try { const r = await from.request('DELETE', name); await from.readResponse(r, 1024 * 1024); if (!r.ok && r.status !== 404) cleanupPending++; } catch { cleanupPending++; } progress({ phase: 'cleanup', completed: ++cleaned, total: keys.length }); });
        progress({ phase: 'complete', completed, total: keys.length, cleanupPending });
        return { vault, cleanupPending };
    } catch (e) { if (!committed) { try { await target.request('DELETE', 'generations/' + generation + '/'); } catch {} } throw e; }
    finally { if (lockToken) { try { const r = await target.request('UNLOCK', 'vault.json', undefined, { 'Lock-Token': lockToken }); await target.readResponse(r, 1024 * 1024); } catch {} } try { if ((await source.get('migration.json'))?.equals(lease)) await source.request('DELETE', 'migration.json'); } catch {} }
}
