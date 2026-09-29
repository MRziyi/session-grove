import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeTitle } from '../src/claude-title.js';
import { sessionExclusion } from '../src/session-kind.js';
const user=(text,extra={})=>({type:'user',message:{content:[{type:'text',text}]},...extra});
test('Claude title ignores IDE wrappers and local commands without hiding real human work',()=>{
 const rows=[user('<command-name>/model</command-name>'),user('<ide_opened_file>/some/file</ide_opened_file>\nRevise the figure',{origin:{kind:'human'}}),{type:'assistant',message:{content:'Done'}}];
 assert.equal(claudeTitle(rows).title,'Revise the figure');assert.equal(claudeTitle(rows).initialization,false);
 assert.equal(claudeTitle([...rows,{type:'custom-title',customTitle:'My name'}]).title,'My name');
 assert.equal(claudeTitle([user('<custom>Keep my XML</custom>')]).title,'<custom>Keep my XML</custom>');
});
test('command-only initialization is recoverable through the background filter',()=>{
 const value=claudeTitle([user('<command-name>/model</command-name>')]);assert.equal(value.initialization,true);
 assert.equal(sessionExclusion({agent:'claude',initialization:true,chats:1}),'background');assert.equal(sessionExclusion({agent:'claude',initialization:true,chats:1,showScheduled:true}),null);
 assert.equal(claudeTitle([user('<command-name>/model</command-name>'),{type:'assistant',message:{content:'Actual answer'}}]).initialization,false);
});
