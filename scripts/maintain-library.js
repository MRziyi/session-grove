// Offline, explicitly targeted maintenance. Never modifies native session files.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { Store } from '../src/store.js';
import { Native } from '../src/native.js';
import { metadata, treeMembers } from '../src/organization.js';
import { assert } from '../src/util.js';
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
assert(args.includes('--root') && (args.includes('--refresh') || args.includes('--plan')), 'Usage: node scripts/maintain-library.js --root LIBRARY [--refresh] [--plan FILE]');
const root = path.resolve(value('--root'));
assert(fs.existsSync(path.join(root, 'grove.sqlite')), 'Existing library required.');
try { const pid = Number(fs.readFileSync(path.join(root, 'server.lock'), 'utf8')); try { process.kill(pid, 0); throw new Error('Stop the library server before maintenance.'); } catch (e) { if (e.code !== 'ESRCH') throw e; } } catch (e) { if (e.code !== 'ENOENT') throw e; }
const destination = path.join(root, 'recovery-snapshots', new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
const original = new DatabaseSync(path.join(root, 'grove.sqlite'), { readOnly: true }); await backup(original, destination); original.close(); fs.chmodSync(destination, 0o600);
const store = new Store(root);
try {
    if (args.includes('--refresh')) {
        const result = new Native(store).refreshLocal();
        console.log(JSON.stringify({ action: 'refresh', discovered: result.discovered, updated: result.updates.length, grouped: result.grouped, timings: result.timings, errors: result.errors }));
        assert(!result.errors.length, 'Resolve import errors before applying a project plan.');
    }
    if (args.includes('--plan')) {
        const plan = JSON.parse(fs.readFileSync(value('--plan'), 'utf8'));
        assert(Array.isArray(plan.groups), 'Invalid plan.');
        const seen = new Set();
        store.transaction(() => {
            for (const group of plan.groups) {
                assert(typeof group.name === 'string' && Array.isArray(group.items) && group.items.length, 'Invalid project group.');
                let project = store.all('project').find(p => p.name === group.name);
                if (!project) project = store.project(group.name, group.description || '');
                assert(!project.archived, 'Destination project is archived.');
                for (const item of group.items) {
                    assert(!seen.has(item.id), 'A tree appears in multiple groups.'); seen.add(item.id);
                    const members = treeMembers(store, item.id);
                    assert(JSON.stringify(members.map(b => b.id).sort()) === JSON.stringify([...item.members].sort()), 'Tree membership changed. Regenerate the plan.');
                    for (const b of members) { assert(!b.projectId || b.projectId === project.id, 'Refusing to replace an existing project assignment.'); store.put('branch', metadata(b, { projectId: project.id })); }
                }
            }
        });
        console.log(JSON.stringify({ action: 'projects', projects: plan.groups.length, trees: seen.size }));
    }
    console.log(JSON.stringify({ backup: destination }));
} finally { store.close(); }
