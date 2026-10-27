import {assert,hash} from './util.js';
import {packRevisions,unpackGraph} from './revision-codec.js';

export const GIT_FILE_BYTES=95*1024*1024;
export const GRAPH_PART_BYTES=8*1024*1024;
export const isGraphManifest=value=>value?.format==='session-grove-graph-parts';

// Only the transport changes. Reassembly preserves field/row order, revision
// identities and the canonical graph digest used by sync and offline Discard.
export function writeGraphParts(graph,writePart,{targetBytes=GRAPH_PART_BYTES,compact=false}={}){
    assert(Number.isSafeInteger(targetBytes)&&targetBytes>0&&targetBytes<GIT_FILE_BYTES,'Invalid Git graph part size.');
    const fields=[],parts=[];let lines=[],bytes=0;
    const flush=()=>{if(!lines.length)return;const text=lines.join(''),part={hash:hash(text),bytes,rows:lines.length};writePart(part,text);parts.push(part);lines=[];bytes=0;};
    for(const [key,value]of Object.entries(graph)){
        if(value===undefined)continue;
        if(!Array.isArray(value)){fields.push({key,value});continue;}
        fields.push({key,array:true});
        for(const row of compact&&key==='revisions'?packRevisions(value):value){
            const line=JSON.stringify([key,row])+'\n',size=Buffer.byteLength(line);
            assert(size<GIT_FILE_BYTES,'One Git graph row exceeds the 95 MiB limit: '+key+'.');
            if(bytes&&bytes+size>targetBytes)flush();
            lines.push(line);bytes+=size;
        }
    }
    flush();return {format:'session-grove-graph-parts',schema:compact?2:1,fields,parts};
}

export function graphPartsReader(manifest){
    assert(isGraphManifest(manifest)&&[1,2].includes(manifest.schema)&&Array.isArray(manifest.fields)&&manifest.fields.length<=32&&Array.isArray(manifest.parts)&&manifest.parts.length<=100000,'Unsupported Git graph parts manifest.');
    const fields=new Map(),arrays=new Set();
    for(const field of manifest.fields){
        assert(field&&typeof field.key==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(field.key)&&!fields.has(field.key),'Invalid Git graph field.');
        assert(field.array===true||Object.hasOwn(field,'value'),'Invalid Git graph field.');
        fields.set(field.key,field.array?[]:field.value);if(field.array)arrays.add(field.key);
    }
    for(const part of manifest.parts)assert(part&&/^[a-f0-9]{64}$/.test(part.hash)&&Number.isSafeInteger(part.bytes)&&part.bytes>0&&part.bytes<GIT_FILE_BYTES&&Number.isSafeInteger(part.rows)&&part.rows>0,'Invalid Git graph part.');
    let index=0;
    return {
        append(part,text){
            assert(manifest.parts[index]===part&&typeof text==='string'&&Buffer.byteLength(text)===part.bytes&&hash(text)===part.hash,'Git graph part integrity check failed.');
            let rows=0;
            for(const line of text.split('\n'))if(line){const row=JSON.parse(line);assert(Array.isArray(row)&&row.length===2&&arrays.has(row[0]),'Invalid Git graph row.');fields.get(row[0]).push(row[1]);rows++;}
            assert(rows===part.rows,'Git graph part row count mismatch.');index++;
        },
        finish(){assert(index===manifest.parts.length,'Missing Git graph part.');const graph=Object.fromEntries(fields);return manifest.schema===2?unpackGraph(graph):graph;}
    };
}
