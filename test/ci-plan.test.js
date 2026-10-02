import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {testPlan,browserFiles} from '../scripts/ci-plan.js';

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
 assert.throws(()=>testPlan(files,tests,'typo'));
});
