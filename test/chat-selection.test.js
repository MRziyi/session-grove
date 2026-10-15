import test from 'node:test';import assert from 'node:assert/strict';
import {turnMessages,selectChats} from '../web/chat-selection.js';
import {defaults,savePreferences} from '../src/preferences.js';
const messages=['user','user','assistant','assistant','assistant','assistant','user','assistant'].map((role,i)=>({id:String(i),line:i+1,role}));
test('any input or reply selects the whole multi-message turn and toggles it off',()=>{
 for(let i=0;i<6;i++){
  const selected=selectChats(messages,new Set(),i,'turn',null,null,false,[{end:6},{end:8}]);assert.deepEqual([...selected.chats],['0','1','2','3','4','5']);
  assert.equal(selectChats(messages,selected.chats,(i+2)%6,'turn',null,null,false,[{end:6},{end:8}]).chats.size,0);
 }
 assert.equal(selectChats(messages,new Set(['0']),0,'turn',null,null,false,[{end:6}]).chats.size,0,'clicking a selected message cancels its turn even after more replies arrive');
 assert.deepEqual(turnMessages(messages,7,[{end:6}]).map(m=>m.id),['6','7']);
 assert.deepEqual(turnMessages(messages,3).map(m=>m.id),['0','1','2','3','4','5']);
});
test('native boundaries keep steering messages and assistant updates in one turn',()=>{
 const m=['user','assistant','user','assistant','user','assistant'].map((role,i)=>({id:String(i),role,line:i+1}));
 assert.deepEqual(turnMessages(m,2,[{end:4},{end:6}]).map(m=>m.id),['0','1','2','3']);
 assert.deepEqual(turnMessages(m,4,[{end:4},{end:6}]).map(m=>m.id),['4','5']);
});
test('individual selection fills gaps and trims the trailing fragment; range mode preserves start/end and shift extension',()=>{
 let r=selectChats(messages,new Set(),0,'single');r=selectChats(messages,r.chats,3,'single');assert.deepEqual([...r.chats],['0','1','2','3']);r=selectChats(messages,r.chats,1,'single');assert.deepEqual([...r.chats],['0']);r=selectChats(messages,r.chats,0,'single');assert.equal(r.chats.size,0);
 r=selectChats(messages,new Set(),4,'range');assert.equal(r.end,null);r=selectChats(messages,r.chats,1,'range',r.start,r.end);assert.deepEqual([...r.chats],['1','2','3','4']);r=selectChats(messages,r.chats,6,'range',r.start,r.end,true);assert.deepEqual([...r.chats],['4','5','6']);
});
test('message selection defaults to whole turn and validates saved modes',()=>{
 let saved={};const store={local:(key,v)=>v===undefined?saved:(saved=v),invalidate:()=>{}};
 assert.equal(defaults.chatSelectionMode,'turn');for(const mode of ['single','range','turn'])assert.equal(savePreferences(store,{chatSelectionMode:mode}).chatSelectionMode,mode);
 assert.throws(()=>savePreferences(store,{chatSelectionMode:'invalid'}));assert.equal(saved.chatSelectionMode,'turn');
});

test('whole-turn selection fills skipped turns and keeps the prefix after an interior removal',()=>{
 const m=Array.from({length:8},(_,i)=>({id:String(i),line:i+1,role:i%2?'assistant':'user'})),checkpoints=[2,4,6,8].map(end=>({end}));
 const click=(r,i)=>selectChats(m,r.chats,i,'turn',r.start,r.end,false,checkpoints);
 let r=click({chats:new Set()},0);r=click(r,4);assert.deepEqual([...r.chats],['0','1','2','3','4','5']);
 r=click(r,3);assert.deepEqual([...r.chats],['0','1']);
 r=click(r,6);assert.equal(r.chats.size,8);r=click(r,0);assert.deepEqual([...r.chats],['2','3','4','5','6','7']);
 r=click(r,7);assert.deepEqual([...r.chats],['2','3','4','5']);
 r=click({chats:new Set()},6);r=click(r,0);assert.deepEqual([...r.chats],['0','1','2','3','4','5','6','7'],'backward extension also fills gaps');
});
