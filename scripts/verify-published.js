// Independent read-back of the published directory and every immutable manifest.
// Record packs were already decrypted/hash-checked after upload; this also checks
// that all published record references are covered by those verified packs.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { unseal, WebDAV } from '../src/sync.js';
import { vaultKey } from '../src/vault.js';
import { decodeRevisionRefs } from '../src/revision-wire.js';
import { hash, assert, mapConcurrent } from '../src/util.js';
const root=path.resolve(process.argv[2]||''),expectedHost=process.argv[3];
assert(process.argv[2]&&expectedHost,'Usage: node scripts/verify-published.js LIBRARY EXPECTED_URL');
const config=JSON.parse(fs.readFileSync(path.join(root,'webdav.json'),'utf8'));assert(config.url===expectedHost&&config.verified&&config.encrypted!==false,'Verified encrypted destination changed.');
const passphrase=fs.readFileSync(path.join(root,'sync-key.txt'),'utf8').replace(/\r?\n$/,'');
const db=new DatabaseSync(path.join(root,'grove.sqlite'),{readOnly:true}),local=k=>JSON.parse(db.prepare('SELECT body FROM local WHERE key=?').get(k)?.body||'null');
const cacheKey=local('cloudCacheKey'),cache=local(cacheKey),manual=local('lastManualSync'),device=JSON.parse(fs.readFileSync(path.join(root,'device.json'),'utf8'));db.close();
assert(manual?.state==='success'&&cache.lastUpload,'The full sync has not completed.');
const expected=cache.heads[device.id+'.bin'];assert(expected,'Published head is missing locally.');
const rootDav=new WebDAV(config),vaultBytes=await rootDav.get('vault.json');assert(vaultBytes,'Existing vault is missing.');const vault=JSON.parse(vaultBytes),key=vaultKey(vault,passphrase);assert(key&&cacheKey==='cloud:'+hash(rootDav.base+vault.salt),'Vault identity or encryption differs.');const dav=vault.generation?rootDav.scoped('generations/'+vault.generation+'/'):rootDav;
{
 const head=unseal(await dav.get('heads/'+device.id+'.bin'),key);
 const {etag,...expectedHead}=expected;assert(hash(JSON.stringify(head))===hash(JSON.stringify(expectedHead)),'Published directory differs.');
 const verified=new Map((cache.packs||[]).map(p=>[p.ref,p])),legacy=new Set(),sessions=new Map(),records=new Set(),trees=new Set();let checked=0;
 for(const project of head.projects){const index=unseal(await dav.get('projects/'+project.index+'.bin'),key);assert(hash(JSON.stringify(index))===project.index,'Project index differs.');
  await mapConcurrent(index.items,async item=>{if(trees.has(item.ref))return;trees.add(item.ref);const encoded=unseal(await dav.get('trees/'+item.ref+'.bin'),key);assert(hash(JSON.stringify(encoded))===item.ref,'Tree manifest differs.');const graph=decodeRevisionRefs(encoded),covered=new Set();
   for(const pack of graph.packs||[]){const known=verified.get(pack.ref);assert(known&&JSON.stringify(known.refs)===JSON.stringify(pack.refs),'A pack has not passed upload read-back verification.');for(const h of pack.refs)covered.add(h);}
   for(const rev of graph.revisions)for(const h of rev.refs){records.add(h);if(!covered.has(h))legacy.add(h);}
   for(const b of graph.branches)if(!b.synthetic&&!b.excluded)sessions.set(b.id,b);checked++;console.log(JSON.stringify({phase:'manifest-verified',checked}));
  });
 }
 let legacyDone=0;await mapConcurrent([...legacy],async h=>{const body=unseal(await dav.get('objects/'+h+'.bin'),key);assert(typeof body==='string'&&hash(body)===h,'Legacy record integrity check failed.');legacyDone++;if(legacyDone%128===0||legacyDone===legacy.size)console.log(JSON.stringify({phase:'legacy-records-verified',completed:legacyDone,total:legacy.size}));});
 const report={at:new Date().toISOString(),lastUpload:cache.lastUpload,schema:head.schema,projects:head.projects.filter(p=>p.id!=='00000000-0000-4000-8000-000000000001').length,trees:trees.size,sessions:sessions.size,archived:[...sessions.values()].filter(b=>b.archived).length,records:records.size,packs:verified.size,legacyRecordsVerified:legacy.size,encrypted:true,directoryAndManifestsVerified:true,recordPacksReadBackVerified:true};
 fs.writeFileSync('test-results/published-verification.json',JSON.stringify(report,null,2),{mode:0o600});console.log(report);
}
