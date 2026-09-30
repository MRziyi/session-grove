import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Store} from '../src/store.js';
test('native baselines are stored once, survive reopen and roll back with instance metadata',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-baselines-'));let store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const baseline='private transcript\n'.repeat(10000);store.local('instances',[{id:'one',baseline,desired:true},{id:'two',baseline,desired:false}]);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM instance_baselines').get().n,1);assert.ok(store.localRead.get('instances').body.length<500);
 const updated=store.instances();updated[0].desired=false;store.local('instances',updated);store.close();store=new Store(root);assert.equal(store.instances()[0].baseline,baseline);assert.equal(store.instances()[0].desired,false);
 assert.throws(()=>store.transaction(()=>{store.local('instances',[{id:'one',baseline:'changed'}]);throw Error('rollback');}),/rollback/);assert.equal(store.instances().length,2);assert.equal(store.instances()[0].baseline,baseline);
 store.local('instances',[{...store.instances()[0],baseline:null}]);assert.equal(store.db.prepare('SELECT count(*) AS n FROM instance_baselines').get().n,0);
});
test('legacy inline native baselines migrate only on a changed write',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-baseline-legacy-')),store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 store.localWrite.run('instances',JSON.stringify([{id:'old',baseline:'original bytes',applied:true}]));
 const instances=store.instances();assert.equal(instances[0].baseline,'original bytes');instances[0].applied=false;store.local('instances',instances);
 assert.equal(store.instances()[0].baseline,'original bytes');assert.ok(JSON.parse(store.localRead.get('instances').body)[0].baselineRef);
});
