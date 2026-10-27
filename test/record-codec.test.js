import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {encodeRecord,decodeRecord} from '../src/record-codec.js';import {hash} from '../src/util.js';

test('shared media and opaque fields roundtrip exact native bytes without rewriting numbers or escapes',()=>{
 const image=randomBytes(12000),url='data:image/png;base64,'+image.toString('base64'),opaque=randomBytes(9000).toString('base64');
 const raw=' {"n":18014398509481993,"path":"x\\\\y","label":"汉字\u2028\u2029","images":['+JSON.stringify(url)+','+JSON.stringify(url)+'],"encrypted_content":'+JSON.stringify(opaque)+'}\n',payloads=new Map(),encoded=encodeRecord(raw,(h,data)=>payloads.set(h,data));
 assert.equal(payloads.size,2);assert.equal(decodeRecord(encoded,h=>payloads.get(h)),raw);assert.equal(hash(decodeRecord(encoded,h=>payloads.get(h))),hash(raw));assert.ok(JSON.stringify(encoded).length<raw.length*.1);
 const damaged=structuredClone(encoded);damaged.bytes--;assert.throws(()=>decodeRecord(damaged,h=>payloads.get(h)),/length/);
 const broken=new Map(payloads),key=broken.keys().next().value,data=Buffer.from(broken.get(key));data[0]^=1;broken.set(key,data);assert.throws(()=>decodeRecord(encoded,h=>broken.get(h)),/integrity/);assert.throws(()=>decodeRecord(encoded,()=>undefined),/Missing/);
});
test('small records and media-like text retain the original representation',()=>{
 for(const raw of ['\n','{"type":"user","message":"hello"}\n','data:image/png;base64,invalid-encoding']){assert.equal(encodeRecord(raw,()=>assert.fail('No payload expected')),raw);assert.equal(decodeRecord(raw,()=>{}),raw);}
});
