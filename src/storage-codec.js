import * as zlib from 'node:zlib';
import {assert} from './util.js';
import {isRevisionDelta,packRevision,unpackRevisions,packGraph,unpackGraph} from './revision-codec.js';

const magic=Buffer.from('GROVEZ1\0'),threshold=16*1024,maxBytes=512*1024*1024;
const isBytes=value=>value instanceof Uint8Array;
export function unpackStorage(value){
    if(typeof value==='string')return value;
    assert(isBytes(value),'Invalid packed storage value.');const data=Buffer.from(value.buffer,value.byteOffset,value.byteLength);
    assert(data.length>=12&&data.subarray(0,8).equals(magic),'Unsupported packed storage format.');
    const size=data.readUInt32LE(8);assert(size<=maxBytes,'Packed storage value exceeds its size limit.');
    assert(typeof zlib.zstdDecompressSync==='function','Packed storage requires Node.js 24 or later.');
    const raw=zlib.zstdDecompressSync(data.subarray(12),{maxOutputLength:Math.max(1,size)});assert(raw.length===size,'Packed storage length mismatch.');return raw.toString('utf8');
}
export function packStorage(text,{force=false}={}){
    if(!force&&text.length<threshold)return text;
    assert(typeof zlib.zstdCompressSync==='function','Storage optimization requires Node.js 24 or later.');
    const raw=Buffer.from(text);assert(raw.length<=maxBytes,'Storage value exceeds its size limit.');
    const packed=zlib.zstdCompressSync(raw,{params:{[zlib.constants.ZSTD_c_compressionLevel]:1,[zlib.constants.ZSTD_c_checksumFlag]:1}});
    if(!force&&packed.length+12>=raw.length*.9)return text;
    const header=Buffer.alloc(12);magic.copy(header);header.writeUInt32LE(raw.length,8);return Buffer.concat([header,packed]);
}
export const sameStorage=(a,b)=>typeof a==='string'&&typeof b==='string'?a===b:isBytes(a)&&isBytes(b)&&Buffer.from(a).equals(Buffer.from(b));
export function sameRevision(a,b){
    const keys=Object.keys(a).filter(k=>a[k]!==undefined),other=Object.keys(b).filter(k=>b[k]!==undefined);
    return keys.length===other.length&&keys.every((key,i)=>key===other[i]&&(key==='refs'?a.refs.length===b.refs.length&&a.refs.every((h,n)=>h===b.refs[n]):JSON.stringify(a[key])===JSON.stringify(b[key])));
}
export function packView(value){
    const undefinedPaths=[];
    const visit=(item,path=[])=>{if(item&&typeof item==='object')for(const key of Object.keys(item)){if(item[key]===undefined)undefinedPaths.push([...path,key]);else visit(item[key],[...path,key]);}};
    visit(value);return packStorage(JSON.stringify({value,undefinedPaths}));
}
export function unpackView(body){
    const {value,undefinedPaths}=JSON.parse(unpackStorage(body));assert(value&&Array.isArray(undefinedPaths),'Invalid conversation view.');
    for(const keys of undefinedPaths){let parent=value;for(const key of keys.slice(0,-1)){assert(parent&&Object.hasOwn(parent,key),'Invalid conversation view field.');parent=parent[key];}Object.defineProperty(parent,keys.at(-1),{value:undefined,writable:true,enumerable:true,configurable:true});}
    return value;
}

// Public Store reads remain canonical JSON/native bytes. Only SQLite's physical
// representation changes; each call returns independent mutable reference arrays.
export class StorageCodec{
    constructor(db){
        this.db=db;this.refs=new Map();this.refBytes=0;this.metadataCache=new Map();this.metadataBytes=0;
        this.read=db.prepare('SELECT body FROM entities WHERE kind=? AND id=?');
        const hasBases=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='revision_bases'").get();
        this.dependencies=hasBases?db.prepare('SELECT id FROM revision_bases WHERE base=?'):{all:()=>[]};
        this.setBase=hasBases?db.prepare('INSERT OR REPLACE INTO revision_bases(id,base) VALUES (?,?)'):null;this.removeBase=hasBases?db.prepare('DELETE FROM revision_bases WHERE id=?'):null;
        this.write=db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?');
    }
    clear(){this.refs.clear();this.refBytes=0;this.metadataCache.clear();this.metadataBytes=0;}
    metadata(id){
        if(this.metadataCache.has(id))return this.metadataCache.get(id).value;
        const saved=this.read.get('revision',id);assert(saved,'Missing revision metadata.');const row=JSON.parse(unpackStorage(saved.body)),value=isRevisionDelta(row)?row.data:row;
        const source=Object.fromEntries(['operation','deviceId','deviceName','deviceModel','devicePlatform','deviceKind'].filter(k=>value.source&&Object.hasOwn(value.source,k)).map(k=>[k,value.source[k]]));
        const text=JSON.stringify({id:value.id,parent:value.parent,source,createdAt:value.createdAt}),data=JSON.parse(text),bytes=text.length*2;
        if(bytes<=32*1024){while(this.metadataCache.size&&(this.metadataBytes+bytes>2*1024*1024||this.metadataCache.size>=4096)){const key=this.metadataCache.keys().next().value;this.metadataBytes-=this.metadataCache.get(key).bytes;this.metadataCache.delete(key);}this.metadataCache.set(id,{value:data,bytes});this.metadataBytes+=bytes;}
        return data;
    }
    remember(id,refs){
        const bytes=refs.length*80;if(bytes>4*1024*1024)return;
        if(this.refs.has(id)){this.refBytes-=this.refs.get(id).length*80;this.refs.delete(id);}
        while(this.refs.size&&(this.refBytes+bytes>4*1024*1024||this.refs.size>=32)){const key=this.refs.keys().next().value;this.refBytes-=this.refs.get(key).length*80;this.refs.delete(key);}
        this.refs.set(id,refs);this.refBytes+=bytes;
    }
    revision(id,stored){
        const raw=stored??this.read.get('revision',id)?.body;assert(raw!==undefined,'Missing revision encoding base.');
        const row=JSON.parse(unpackStorage(raw));
        if(!isRevisionDelta(row))return row;
        if(this.refs.has(id)){const cached=this.refs.get(id);this.refs.delete(id);this.refs.set(id,cached);return Object.fromEntries(row.fields.map(k=>[k,k==='refs'?cached.slice():Object.hasOwn(row.data,k)?row.data[k]:undefined]));}
        const stack=[],seen=new Set();let current=row;
        while(isRevisionDelta(current)){
            assert(!seen.has(current.data.id),'Revision encoding cycle.');seen.add(current.data.id);stack.push(current);
            if(this.refs.has(current.base)){current={id:current.base,refs:this.refs.get(current.base)};break;}
            const base=this.read.get('revision',current.base);assert(base,'Missing revision encoding base.');current=JSON.parse(unpackStorage(base.body));
        }
        // Apply a long append chain to one scratch vector, avoiding quadratic
        // intermediate allocations when only the final revision was requested.
        const refs=current.refs.slice();let result=current;
        while(stack.length){const delta=stack.pop();assert(Number.isSafeInteger(delta.prefix)&&delta.prefix>=0&&delta.prefix<=refs.length&&Array.isArray(delta.append),'Invalid revision prefix.');refs.length=delta.prefix;for(const h of delta.append){assert(typeof h==='string','Invalid revision reference.');refs.push(h);}result=Object.fromEntries(delta.fields.map(k=>[k,k==='refs'?refs:Object.hasOwn(delta.data,k)?delta.data[k]:undefined]));}
        this.remember(id,refs);return {...result,refs:refs.slice()};
    }
    entity(kind,id,raw){return kind==='revision'?this.revision(id,raw):JSON.parse(unpackStorage(raw));}
    entities(kind,rows){const values=rows.map(row=>JSON.parse(unpackStorage(row.body)));return kind==='revision'?unpackRevisions(values):values;}
    revisionGraph(seeds){
        const rows=new Map(),pending=seeds.filter(Boolean).reverse();
        while(pending.length){const id=pending.pop();if(rows.has(id))continue;const stored=this.read.get('revision',id);assert(stored,'Missing revision encoding base.');const row=JSON.parse(unpackStorage(stored.body));rows.set(id,row);const parent=isRevisionDelta(row)?row.data.parent:row.parent;if(parent)pending.push(parent);if(isRevisionDelta(row))pending.push(row.base);}
        return new Map(unpackRevisions([...rows.values()]).map(row=>[row.id,row]));
    }
    encodeEntity(kind,value,{base,standalone=false}={}){
        if(kind!=='revision')return packStorage(JSON.stringify(value));
        if(!standalone&&base===undefined&&value.parent&&value.parent!==value.id){const row=this.read.get('revision',value.parent);if(row)base=this.revision(value.parent,row.body);}
        const packed=standalone?value:packRevision(value,base);
        return packStorage(JSON.stringify(packed),{force:isRevisionDelta(packed)});
    }
    trackRevision(id,body){assert(this.setBase&&this.removeBase,'Initialize storage before writing revision encodings.');const row=JSON.parse(unpackStorage(body));if(isRevisionDelta(row))this.setBase.run(id,row.base);else this.removeBase.run(id);}
    detachDependents(id){
        for(const {id:child}of this.dependencies.all(id)){const value=this.revision(child);this.write.run(this.encodeEntity('revision',value,{standalone:true}),'revision',child);this.removeBase.run(child);}
    }
    local(key,body){const value=JSON.parse(unpackStorage(body));return isBytes(body)&&key.startsWith('git-undo:')&&value?.graph?{...value,graph:unpackGraph(value.graph)}:value;}
    encodeLocal(key,value){return key.startsWith('git-undo:')&&value?.graph?packStorage(JSON.stringify({...value,graph:packGraph(value.graph)}),{force:true}):JSON.stringify(value);}
}
