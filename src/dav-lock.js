import { davStatuses, davSucceeded } from './sync.js';
import { assert, id } from './util.js';
// A depth-infinity DAV lock protects even clients that do not know our lease
// convention. Unsupported providers fail before any destructive operation.
export async function withVaultLock(rootDav, fn, { renewMs = 30000 } = {}) {
    if (rootDav.lockContext?.active) return fn(() => {});
    const r = await rootDav.request(
        'LOCK',
        '',
        '<?xml version="1.0"?><d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype><d:owner>Session Grove retention</d:owner></d:lockinfo>',
        { 'Content-Type': 'application/xml', Depth: 'infinity', Timeout: 'Second-120' },
    );
    const lockBody = await rootDav.readResponse(r, 1048576);
    const token = r.headers.get('lock-token');
    if (!davSucceeded(r, lockBody) && token) {
        const unlock = await rootDav.request('UNLOCK', '', undefined, { 'Lock-Token': token });
        await rootDav.readResponse(unlock, 1048576);
    }
    assert(
        davSucceeded(r, lockBody) && /^<[^<>\r\n]+>$/.test(token || ''),
        'This provider needs collection WebDAV locking for Trash cleanup.',
    );
    const context = { token, uri: rootDav.base, active: true };
    rootDav.lockContext = context;
    let lost = null,
        renewal = null;
    const assertHeld = () => {
        if (lost) throw lost;
    };
    const granted = Number(r.headers.get('timeout')?.match(/Second-(\d+)/i)?.[1]) || 120;
    const timer = setInterval(
        () => {
            if (renewal) return;
            renewal = (async () => {
                try {
                    const r = await rootDav.request('LOCK', '', undefined, {
                        If: '(' + token + ')',
                        Timeout: 'Second-120',
                    });
                    const body = await rootDav.readResponse(r, 1048576);
                    assert(davSucceeded(r, body), 'Trash write lock expired.');
                } catch (e) {
                    lost = e;
                } finally {
                    renewal = null;
                }
            })();
        },
        Math.max(10, Math.min(renewMs, (granted * 1000) / 3)),
    );
    timer.unref();
    try {
        if (!rootDav.collectionLockVerified) {
            const probe = Object.create(rootDav);
            probe.lockContext = null;
            const name = 'trash-lock-probe-' + id(),
                original = Buffer.from('verified lock coverage');
            try {
                const denied = await probe.request('PUT', name, Buffer.from('must not write'));
                const response = await probe.readResponse(denied, 1048576);
                assert(
                    davStatuses(denied, response).includes(423) && !(await rootDav.get(name)),
                    'Provider did not block a new concurrent write; cleanup was not started.',
                );
                assert(
                    await rootDav.put(name, original, true),
                    'Lock owner creation precondition failed.',
                );
                const check = await rootDav.request('GET', name),
                    checked = await rootDav.readResponse(check, 1048576);
                assert(
                    checked.equals(original),
                    'Lock owner read-back failed (HTTP ' +
                        check.status +
                        ', DAV ' +
                        davStatuses(check, checked).join(',') +
                        ', ' +
                        checked.length +
                        ' bytes).',
                );
                const overwrite = await probe.request(
                    'PUT',
                    name,
                    Buffer.from('must not overwrite'),
                );
                const body = await probe.readResponse(overwrite, 1048576);
                assert(
                    davStatuses(overwrite, body).includes(423) &&
                        (await rootDav.get(name))?.equals(original),
                    'Provider did not block a concurrent overwrite; cleanup was not started.',
                );
                rootDav.collectionLockVerified = true;
            } finally {
                const r = await rootDav.request('DELETE', name);
                const body = await rootDav.readResponse(r, 1048576);
                assert(r.status === 404 || davSucceeded(r, body), 'Lock test cleanup failed.');
            }
        }
        return await fn(assertHeld);
    } finally {
        clearInterval(timer);
        await renewal;
        try {
            const r = await rootDav.request('UNLOCK', '', undefined, { 'Lock-Token': token });
            await rootDav.readResponse(r, 1048576);
        } finally {
            context.active = false;
            delete rootDav.lockContext;
        }
    }
}
