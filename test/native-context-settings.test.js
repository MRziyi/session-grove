import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {NativeContextSettings,patchContextToml} from '../src/native-context-settings.js';
import {privateFile} from '../src/private-file.js';
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'grove-context-settings-')),roots={codex:path.join(root,'codex'),claude:path.join(root,'claude')};for(const dir of Object.values(roots))fs.mkdirSync(dir);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,roots,settings:new NativeContextSettings(root,roots)};};
test('context editor preserves Codex comments, nested providers and multiline instructions',()=>{
    const original='# native preferences\r\nmodel_context_window = 128_000 # budget\r\nmodel_auto_compact_token_limit = 100000\r\ndeveloper_instructions = """\r\nmodel_context_window = 999\r\n[not.a.section]\r\n"""\r\n[model_providers.private]\r\nmodel_context_window = 7\r\n';
    const edited=patchContextToml(original,{model_context_window:1000000,model_auto_compact_token_limit:900000});
    assert.match(edited,/1000000 # budget/);assert.match(edited,/model_auto_compact_token_limit = 900000/);assert.ok(edited.includes('model_context_window = 999\r\n[not.a.section]'));assert.ok(edited.endsWith('[model_providers.private]\r\nmodel_context_window = 7\r\n'));
    const cleared=patchContextToml(edited,{model_context_window:null,model_auto_compact_token_limit:null});assert.ok(cleared.includes('# budget'));assert.ok(!cleared.includes('900000'));assert.ok(cleared.includes('model_context_window = 999'));
    const array='commands = [\n["one", "two"]\n]\nmodel_context_window = 100000\n';
    assert.equal(patchContextToml(array,{model_context_window:200000}),array.replace('100000','200000'));
    assert.throws(()=>patchContextToml('"model_context_window" = 100000\n',{model_context_window:200000}),/nonstandard/);
    assert.throws(()=>patchContextToml('instructions = """unfinished',{model_context_window:200000}),/unfinished/);
});
test('Codex settings edit the selected profile, preserve unrelated settings and reject stale forms',t=>{
    const f=fixture(t),base=path.join(f.roots.codex,'config.toml'),profile=path.join(f.roots.codex,'research.config.toml');fs.writeFileSync(base,'profile = "research"\nmodel_context_window = 200000\n[profiles.research]\nmodel_auto_compact_token_limit = 150000\n');fs.writeFileSync(profile,'model = "test-model"\n');
    const before=f.settings.read('codex');assert.equal(before.profile,'research');assert.equal(before.window,200000);assert.equal(before.compactAt,150000);
    f.settings.save({...before,window:1000000,compactAt:900000});assert.equal(f.settings.read('codex').window,1000000);assert.match(fs.readFileSync(profile,'utf8'),/model = "test-model"/);assert.match(fs.readFileSync(base,'utf8'),/model_context_window = 200000/);
    assert.throws(()=>f.settings.save({...before,window:300000,compactAt:null}),error=>error.status===409);
    const backup=path.join(f.root,'context-backups',fs.readdirSync(path.join(f.root,'context-backups'))[0]);assert.equal(fs.readFileSync(backup,'utf8'),'model = "test-model"\n');assert.ok(privateFile(backup));
    f.settings.save({...f.settings.read('codex'),window:null,compactAt:null});assert.equal(f.settings.read('codex').window,200000);
});
test('Claude context changes preserve other settings and restore inherited defaults on clear',t=>{
    const f=fixture(t),file=path.join(f.roots.claude,'settings.json');fs.writeFileSync(file,JSON.stringify({model:'test-model',env:{KEEP:'unchanged',CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:'80'},permissions:{allow:['Read']}}));
    const before=f.settings.read('claude');assert.equal(before.compactPercent,80);assert.ok(!JSON.stringify(before).includes('KEEP'));
    assert.throws(()=>f.settings.save({...before,window:99999}),/100000/);
    f.settings.save({...before,window:500000});let config=JSON.parse(fs.readFileSync(file));assert.equal(config.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,'500000');assert.equal(config.env.KEEP,'unchanged');assert.deepEqual(config.permissions,{allow:['Read']});
    f.settings.save({...f.settings.read('claude'),window:null});config=JSON.parse(fs.readFileSync(file));assert.ok(!('CLAUDE_CODE_AUTO_COMPACT_WINDOW' in config.env));assert.equal(config.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,'80');
});
test('invalid native settings and token ranges fail without rewriting configuration',t=>{
    const f=fixture(t),file=path.join(f.roots.claude,'settings.json');fs.writeFileSync(file,'{broken');assert.match(f.settings.status().claude.error,/invalid/);assert.equal(fs.readFileSync(file,'utf8'),'{broken');
    const c=f.settings.read('codex');assert.throws(()=>f.settings.save({...c,window:10000,compactAt:20000}),/must not exceed/);assert.throws(()=>f.settings.save({...c,window:1.5,compactAt:null}),/positive token/);
});

test('context presets use selected model metadata and preserve custom current values',t=>{
    const f=fixture(t);
    fs.writeFileSync(path.join(f.roots.codex,'config.toml'),'model = "example"\nmodel_context_window = 321000\n');
    fs.writeFileSync(path.join(f.roots.codex,'models_cache.json'),JSON.stringify({models:[{slug:'example',context_window:272000,max_context_window:872000}]}));
    const c=f.settings.read('codex');assert.equal(c.defaultWindow,272000);assert.equal(c.maxWindow,872000);assert.equal(c.window,321000);
    assert.equal(c.windowOptions[0],872000);assert.ok(c.windowOptions.includes(272000));assert.ok(c.windowOptions.every(n=>n<=872000));
});
