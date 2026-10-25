import test from 'node:test';import assert from 'node:assert/strict';import {jsonLines} from '../src/jsonl.js';
test('JSONL preserves Unicode separators, escaped newlines and long records across arbitrary chunks',async()=>{
 const values=[['hash','before\u2028\u2028after\u2029\n\r中文'],['large','a'.repeat(70000)+'\u2028tail'],{last:true}];
 const raw=values.map(JSON.stringify).join('\r\n');
 for(const size of [1,127,65536]){
  async function* chunks(){for(let i=0;i<raw.length;i+=size)yield raw.slice(i,i+size);}
  assert.deepEqual(await Array.fromAsync(jsonLines(chunks())),values);
 }
});
test('JSONL rejects genuinely truncated records instead of exposing partial JSON',async()=>{
 await assert.rejects(Array.fromAsync(jsonLines(['["complete"]\n["partial'])),SyntaxError);
 assert.deepEqual(await Array.fromAsync(jsonLines(['\n{}\n\r\n'])),[{}]);
});
