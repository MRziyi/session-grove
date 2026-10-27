import {assert,hash} from './util.js';
import {createHash} from 'node:crypto';
export const payloadTextCache=()=>({values:new Map(),bytes:0,limit:8*1024*1024});

const format='grove-native-payloads',minPayload=8*1024,maxRecord=128*1024*1024,maxPayload=95*1024*1024;
export const isPayloadRecord=value=>value?.format===format;

// Work on exact native text spans, never parse/re-serialize a native record.
// IDs, whitespace, number spelling, escapes and trailing LF all survive intact.
export function encodeRecord(body,writePayload,cache){
    if(body.length<minPayload)return body;
    const spans=[];
    for(const match of body.matchAll(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/]+={0,2}/gi)){
        const comma=match[0].indexOf(',')+1,encoded=match[0].slice(comma);if(encoded.length<minPayload)continue;
        spans.push({start:match.index,end:match.index+match[0].length,encoded,encoding:'base64',prefix:match[0].slice(0,comma)});
    }
    for(const match of body.matchAll(/"(?:encrypted_content|signature)"\s*:\s*"([A-Za-z0-9+/_=-]+)"/g)){
        if(match[1].length<minPayload)continue;const start=match.index+match[0].lastIndexOf(match[1]);spans.push({start,end:start+match[1].length,encoded:match[1],encoding:'utf8'});
    }
    if(!spans.length)return body;
    assert(Buffer.byteLength(body)<=maxRecord,'Native payload record exceeds its size limit.');
    spans.sort((a,b)=>a.start-b.start);const segments=[];let offset=0;
    for(const span of spans){
        if(span.start<offset)continue;
        const fingerprint=cache&&createHash('sha256').update(span.encoding).update(span.encoded).digest('hex');let reference=cache?.get(fingerprint);
        if(!reference){const raw=Buffer.from(span.encoded,span.encoding==='base64'?'base64':'utf8');if(span.encoding==='base64'&&raw.toString('base64')!==span.encoded)continue;assert(raw.length<maxPayload,'Native payload exceeds the Git file limit.');const key=hash(raw);writePayload(key,raw);reference={hash:key,bytes:raw.length,encoding:span.encoding};if(cache){if(cache.size>=2048)cache.delete(cache.keys().next().value);cache.set(fingerprint,reference);}}
        segments.push(body.slice(offset,span.start),{...reference,...(span.prefix?{prefix:span.prefix}:{})});offset=span.end;
    }
    if(!segments.length)return body;segments.push(body.slice(offset));return {format,schema:1,bytes:Buffer.byteLength(body),segments};
}
export function decodeRecord(value,readPayload,cache){
    if(typeof value==='string')return value;
    assert(isPayloadRecord(value)&&value.schema===1&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=maxRecord&&Array.isArray(value.segments)&&value.segments.length<=65536,'Unsupported native payload record.');
    const parts=[];let bytes=0;
    for(const part of value.segments){
        let text;
        if(typeof part==='string')text=part;
        else{
            assert(part&&/^[a-f0-9]{64}$/.test(part.hash)&&Number.isSafeInteger(part.bytes)&&part.bytes>=0&&part.bytes<maxPayload&&['base64','utf8'].includes(part.encoding),'Invalid native payload reference.');
            const key=part.hash+':'+part.encoding;let saved=cache?.values.get(key),payload;
            if(saved){assert(saved.bytes===part.bytes,'Native payload integrity check failed.');payload=saved.text;cache.values.delete(key);cache.values.set(key,saved);}
            else{
                const data=readPayload(part.hash);assert(data instanceof Uint8Array,'Missing native payload.');const raw=Buffer.from(data.buffer,data.byteOffset,data.byteLength);assert(raw.length===part.bytes&&hash(raw)===part.hash,'Native payload integrity check failed.');payload=raw.toString(part.encoding==='base64'?'base64':'utf8');
                const cost=payload.length*2;if(cache&&cost<=cache.limit){while(cache.values.size&&cache.bytes+cost>cache.limit){const oldest=cache.values.keys().next().value;cache.bytes-=cache.values.get(oldest).cost;cache.values.delete(oldest);}cache.values.set(key,{text:payload,bytes:part.bytes,cost});cache.bytes+=cost;}
            }
            if(part.encoding==='base64'){assert(typeof part.prefix==='string'&&/^data:[a-z0-9.+/-]+;base64,$/i.test(part.prefix),'Invalid native payload encoding.');text=part.prefix+payload;}
            else text=payload;
        }
        bytes+=Buffer.byteLength(text);assert(bytes<=value.bytes,'Native payload record exceeds declared length.');parts.push(text);
    }
    assert(bytes===value.bytes,'Native payload record length mismatch.');return parts.join('');
}
