import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {testPlan,browserFiles,platformFiles,gitFiles,browserCompatibilityFiles} from '../scripts/ci-plan.js';

test('Windows suites cover every file and every Git case exactly once',()=>{
 const files=fs.readdirSync('test').filter(f=>f.endsWith('.test.js')).map(f=>'test/'+f);
 const git='test/git-cloud.test.js',source=fs.readFileSync(git,'utf8');
 const tests=[...source.matchAll(/\btest\(\s*(['"])([^\r\n]+?)\1/g)].map(m=>({file:git,name:m[2]}));
 const core=testPlan(files,tests,'core'),native=testPlan(files,tests,'native'),parts=['git-1','git-2'].map(s=>testPlan(files,tests,s)[0]);
 assert.deepEqual([...core,...native,{file:git}].map(t=>t.file).sort(),files.sort());
 const selected=parts.flatMap(p=>p.names);assert.equal(new Set(selected).size,tests.length);assert.deepEqual(selected.sort(),tests.map(t=>t.name).sort());
 for(const part of parts){const pattern=new RegExp('^(?:'+part.names.map(RegExp.escape).join('|')+')$');assert.deepEqual(tests.filter(t=>pattern.test(t.name)).map(t=>t.name),part.names);}
 assert.deepEqual(testPlan(files,tests,'all').map(t=>t.file),files);
 assert.deepEqual(testPlan(files,tests,'browser').map(t=>t.file),browserFiles);
 assert.deepEqual(['browser-1','browser-2'].flatMap(s=>testPlan(files,tests,s)).map(t=>t.file),browserFiles);
 assert.throws(()=>testPlan(files,tests,'typo'));
});

test('full Windows unit and Git lanes cover every test file once',()=>{
 const files=fs.readdirSync('test').filter(f=>f.endsWith('.test.js')).map(f=>'test/'+f);
 const selected=['unit','git'].flatMap(suite=>testPlan(files,[],suite)).map(task=>task.file);
 assert.equal(new Set(selected).size,files.length);assert.deepEqual(selected.sort(),files.sort());
 assert.ok(gitFiles.includes('test/git-output.test.js'),'long-path and offline history checks remain mandatory');
});

test('daily platform lanes retain OS boundaries without repeating pure logic or every UI flow',()=>{
 const files=fs.readdirSync('test').filter(f=>f.endsWith('.test.js')).map(f=>'test/'+f);
 const selected=testPlan(files,[],'platform').map(task=>task.file);
 const conditional=files.filter(file=>/\bprocess\.platform\b/.test(fs.readFileSync(file,'utf8')));
 assert.ok(conditional.every(file=>selected.includes(file)),'platform-conditional tests must stay in daily desktop coverage');
 for(const name of ['autostart','windows','node-activation','service','trash-actions','storage-usage'])assert.ok(selected.includes('test/'+name+'.test.js'));
 assert.equal(new Set(selected).size,selected.length);assert.ok(selected.length<files.length/2);
 assert.ok(!selected.some(file=>gitFiles.includes(file)),'Git runs in its own lane');
 assert.ok(!selected.includes('test/intelligence.test.js'),'platform-independent scheduling logic stays in the complete Linux suite');
 assert.deepEqual(testPlan(files,[],'browser-compat').map(task=>task.file),browserCompatibilityFiles);
 assert.ok(browserCompatibilityFiles.includes('scripts/sync-browser-smoke.js'),'native-copy and Discard UI interactions remain covered on Windows');
 assert.ok(browserCompatibilityFiles.every(file=>browserFiles.includes(file)));
 assert.throws(()=>testPlan(files.filter(file=>file!==platformFiles[0]),[],'platform'),/missing/);
});
