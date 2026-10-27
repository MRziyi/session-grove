import fs from 'node:fs';
import path from 'node:path';
import {jsonLines} from './jsonl.js';
import { setImmediate as yieldToLocal } from 'node:timers/promises';
import { CloudView, treeSnapshot, graphFingerprint } from './cloud-view.js';
import { GitRemote, gitRemote } from './git-remote.js';
import { assert, hash, now, atomic } from './util.js';
import { bodyRefs, retainedGraph } from './retention.js';
import { applyTrashState, deletedIds, trashState } from './trash.js';
import { changeSnapshot, sessionChanges, commitMessage } from './session-changes.js';
import { cloudProjectId } from './inbox.js';
import {organizationUndoKey,currentOrganization,organizationSnapshot,organizationSignature,hasOrganizationChanges} from './organization-undo.js';
import {GIT_FILE_BYTES,GRAPH_PART_BYTES,isGraphManifest,writeGraphParts,graphPartsReader} from './git-graph.js';
import {packRevisions,isRevisionDelta} from './revision-codec.js';
import {encodeRecord,decodeRecord,payloadTextCache} from './record-codec.js';
const digest = value => hash(JSON.stringify(value));

// Git owns history, content deduplication, packing and atomic ref publication.
// Grove owns graph semantics, modification clocks and local materialization.
export class GitCloud extends CloudView {
    constructor(store, readConfig, {graphSplitBytes=GIT_FILE_BYTES,graphPartBytes=GRAPH_PART_BYTES,graphCompact=true}={}) { super(store, readConfig); this.provider = 'git';this.graphSplitBytes=graphSplitBytes;this.graphPartBytes=graphPartBytes;this.graphCompact=graphCompact;store.localArchivesOnly=true;store.invalidate(); }
    useSavedCache() {
        this.cacheKey ||= 'cloud:git:' + hash(this.readConfig().url || '');
    }
    async connect() {
        const config = this.readConfig();
        const url = gitRemote(config.url, { allowLocal: config.allowLocal === true });
        if (this.connection) return this.connection;
        if (this.connecting) return this.connecting.promise;
        this.useSavedCache();
        const remote = new GitRemote(path.join(this.store.root, 'git-cache', hash(url)), url, p => this.onProgress?.(p));
        const promise=remote.init().then(()=>{
            remote.controller.signal.throwIfAborted();
            return this.connection={remote,controller:remote.controller};
        });
        this.connecting={remote,promise};
        try{return await promise;}finally{if(this.connecting?.promise===promise)this.connecting=null;}
    }
    lock() { this.connecting?.remote.controller.abort();this.connecting=null;this.connection?.remote.controller.abort(); super.lock(); }
    directory() { return this.connection?.remote.directory || path.join(this.store.root, 'git-cache', hash(this.readConfig().url || '')); }
    file(name) {
        const file = path.join(this.directory(), name);
        // Never follow repository-controlled symlinks outside our checkout.
        let current = this.directory();
        for (const part of name.split('/')) {
            current = path.join(current, part);
            if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'Invalid link in Git data repository.');
        }
        return file;
    }
    read(name, fallback = null) {
        const file = this.file(name);
        if (!fs.existsSync(file)) return fallback;
        assert(fs.statSync(file).size <= 128 * 1024 * 1024, 'Git session file exceeds size limit.');
        const value=JSON.parse(fs.readFileSync(file,'utf8'));
        if(!name.endsWith('/graph.json')||!isGraphManifest(value))return value;
        const reader=graphPartsReader(value),directory=name.slice(0,-'graph.json'.length)+'graph/';
        for(const part of value.parts){const partFile=this.file(directory+part.hash+'.jsonl');assert(fs.existsSync(partFile),'Missing Git graph part.');assert(fs.statSync(partFile).size===part.bytes,'Git graph part size mismatch.');reader.append(part,fs.readFileSync(partFile,'utf8'));}
        return reader.finish();
    }
    write(name, value) {
        if(name.endsWith('/graph.json')&&value&&typeof value==='object'&&!isGraphManifest(value))return this.writeGraph(name,value);
        return this.writeRaw(name,value);
    }
    writeRaw(name,value){
        const file = this.file(name); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
        const bytes=Buffer.byteLength(text);assert(bytes<GIT_FILE_BYTES, 'Git data file exceeds the 95 MiB limit: '+name+' ('+(bytes/1048576).toFixed(2)+' MiB).');
        // This checkout is reconstructable from SQLite or the fetched commit.
        // Keep atomic replacement without forcing a disk flush for every cache file.
        if (!fs.existsSync(file) || fs.statSync(file).size!==bytes || fs.readFileSync(file, 'utf8') !== text) atomic(file, text,{durable:false});
    }
    writeGraph(name,graph){
        assert(Number.isSafeInteger(this.graphSplitBytes)&&this.graphSplitBytes>0&&this.graphSplitBytes<=GIT_FILE_BYTES,'Invalid Git graph split threshold.');
        if(this.graphCompact){
            const rows=packRevisions(graph.revisions||[]);let saved=0;
            for(let i=0;i<rows.length;i++)if(isRevisionDelta(rows[i]))saved+=(graph.revisions[i].refs.length-rows[i].append.length)*67-JSON.stringify({...rows[i],append:[]}).length;
            if(saved>64*1024)return this.writeGraphManifest(name,graph,true);
        }
        const compact=JSON.stringify(graph)+'\n',size=Buffer.byteLength(compact),directory=name.slice(0,-'graph.json'.length)+'graph';
        if(size<this.graphSplitBytes){
            const pretty=size<GRAPH_PART_BYTES?JSON.stringify(graph,null,2)+'\n':compact;
            this.writeRaw(name,Buffer.byteLength(pretty)<GIT_FILE_BYTES?pretty:compact);
            fs.rmSync(this.file(directory),{recursive:true,force:true});return;
        }
        return this.writeGraphManifest(name,graph,false);
    }
    writeGraphManifest(name,graph,compact){
        const directory=name.slice(0,-'graph.json'.length)+'graph';
        const manifest=writeGraphParts(graph,(part,text)=>this.writeRaw(directory+'/'+part.hash+'.jsonl',text),{targetBytes:this.graphPartBytes,compact});
        // Parts are immutable and content addressed; replace the manifest last.
        this.writeRaw(name,manifest);const keep=new Set(manifest.parts.map(p=>p.hash+'.jsonl'));
        if(fs.existsSync(this.file(directory)))for(const file of fs.readdirSync(this.file(directory)))if(/^[a-f0-9]{64}\.jsonl$/.test(file)&&!keep.has(file))fs.rmSync(this.file(directory+'/'+file));
    }
    hasGraphParts(){
        const directory=this.file('trees');return fs.existsSync(directory)&&fs.readdirSync(directory).some(id=>/^[a-f0-9]{64}$/.test(id)&&fs.existsSync(this.file('trees/'+id+'/graph')));
    }
    dataSchema(){
        const directory=this.file('trees');let schema=1;if(!fs.existsSync(directory))return schema;
        for(const id of fs.readdirSync(directory).filter(id=>/^[a-f0-9]{64}$/.test(id))){
            if(fs.existsSync(this.file('trees/'+id+'/payloads')))return 3;
            if(fs.existsSync(this.file('trees/'+id+'/graph'))){schema=2;const manifest=JSON.parse(fs.readFileSync(this.file('trees/'+id+'/graph.json'),'utf8'));if(manifest.schema===2)return 3;}
        }return schema;
    }
    folder(id) { return 'trees/' + hash(id); }
    readPayload(id,key){
        assert(/^[a-f0-9]{64}$/.test(key),'Invalid native payload reference.');const file=this.file(this.folder(id)+'/payloads/'+key+'.bin');assert(fs.existsSync(file),'Missing native payload.');assert(fs.statSync(file).size<GIT_FILE_BYTES,'Native payload exceeds the Git file limit.');return fs.readFileSync(file);
    }
    writePayload(id,key,data){
        assert(/^[a-f0-9]{64}$/.test(key)&&data.length<GIT_FILE_BYTES,'Invalid native payload.');const file=this.file(this.folder(id)+'/payloads/'+key+'.bin');fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
        if(!fs.existsSync(file)||fs.statSync(file).size!==data.length||!fs.readFileSync(file).equals(data))atomic(file,data,{durable:false});
    }
    *records(id) {
        const dir = this.file(this.folder(id) + '/records'),cache=payloadTextCache();
        for (const name of fs.readdirSync(dir).filter(n => /^[0-9]{6}\.jsonl$/.test(n)).sort()) {
            const file = this.file(this.folder(id) + '/records/' + name);
            assert(fs.statSync(file).size < 95 * 1024 * 1024, 'Git record file exceeds size limit.');
            for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line){const [key,value]=JSON.parse(line);yield [key,decodeRecord(value,h=>this.readPayload(id,h),cache)];}
        }
    }
    async *streamRecords(id){
        const directory=this.file(this.folder(id)+'/records'),cache=payloadTextCache();
        for(const name of fs.readdirSync(directory).filter(n=>/^[0-9]{6}\.jsonl$/.test(n)).sort()){
            const file=this.file(this.folder(id)+'/records/'+name);
            assert(fs.statSync(file).size<95*1024*1024,'Git record file exceeds size limit.');
            const stream=fs.createReadStream(file,{encoding:'utf8'});
            try{for await(const [key,value]of jsonLines(stream))yield [key,decodeRecord(value,h=>this.readPayload(id,h),cache)];}finally{stream.destroy();}
        }
    }
    writeRecords(id, records) {
        const dir = this.folder(id) + '/records';
        fs.mkdirSync(this.file(dir), { recursive: true });
        let lines = [], bytes = 0, part = 0;const payloads=new Set(),cache=new Map();
        const flush = () => { this.write(dir + '/' + String(part++).padStart(6, '0') + '.jsonl', lines.join('')); lines = []; bytes = 0; };
        for (const [key,body] of records) {
            const value=encodeRecord(body,(h,data)=>{if(!payloads.has(h))this.writePayload(id,h,data);payloads.add(h);},cache);
            const line = JSON.stringify([key,value]) + '\n', size = Buffer.byteLength(line);
            if (bytes && bytes + size > 8 * 1024 * 1024) flush();
            lines.push(line); bytes += size;
        }
        if (bytes || !part) flush();
        for (const name of fs.readdirSync(this.file(dir))) if (/^[0-9]{6}\.jsonl$/.test(name) && Number(name.slice(0, 6)) >= part) fs.rmSync(this.file(dir + '/' + name));
        const directory=this.file(this.folder(id)+'/payloads');if(fs.existsSync(directory)){for(const name of fs.readdirSync(directory))if(/^[a-f0-9]{64}\.bin$/.test(name)&&!payloads.has(name.slice(0,-4)))fs.rmSync(this.file(this.folder(id)+'/payloads/'+name));if(!fs.readdirSync(directory).length)fs.rmdirSync(directory);}
    }
    *entryIterator() {
        const dir = this.file('trees');
        if (!fs.existsSync(dir)) return;
        for(const n of fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}$/.test(n))){
            const entry = this.read('trees/' + n + '/index.json');
            assert(entry && hash(entry.id) === n && Array.isArray(entry.sessions), 'Invalid Git session index.');
            yield entry;
        }
    }
    entries(){return [...this.entryIterator()];}
    async loadDirectory() {
        const format = this.read('grove.json');
        assert(format?.format === 'session-grove-git' && [1,2,3].includes(format.schema), 'Unsupported Grove Git data format. Update Grove on every device.');
        const projects = new Map(), indexes = {}, archiveEntries=[];let completed=0;
        for (const entry of this.entryIterator()) {
            const { project, ...item } = entry;
            item.sessions=item.sessions.filter(s=>!s.archived);item.sessionIds=item.sessions.map(s=>s.id);
            if(project?.archived||!item.sessions.length){archiveEntries.push(item.id);continue;}
            assert(project?.id === item.projectId && /^[a-f0-9]{64}$/.test(item.ref), 'Invalid Git project index.');
            if (!projects.has(project.id)) projects.set(project.id, { project, items: [] });
            const group = projects.get(project.id); group.items.push(item);
            if ((project.updatedAt || '') > (group.project.updatedAt || '')) group.project = project;
            if(++completed%8===0)await yieldToLocal();
        }
        const summaries = [...projects.values()].map(value => {
            const index = digest(value); indexes[index] = value;
            const treeIds = value.items.filter(i => !i.archived).map(i => i.id);
            return { ...value.project, index, treeIds, count: treeIds.length };
        });
        const c=this.cache();c.archiveEntries=archiveEntries;c.heads = { git: { projects: summaries } }; c.indexes = indexes; c.checkedAt = now();
        // Hydration records the verified baseline; don't read every graph twice.
        this.save(c);
        const state = this.read('trash.json', { schema: 1, events: [] });
        if (state.events.length) applyTrashState(this.store, state);
    }
    async catalog() {
        await this.connect(); this.report('Fetching Git changes');
        const previous = this.cache().gitHead;
        await this.connection.remote.fetch();
        const remoteChanged = (previous || null) !== (this.connection.remote.head || null);
        if (this.connection.remote.head) {
            if(remoteChanged || !this.cache().heads?.git)await this.loadDirectory();
            else {const c=this.cache();c.checkedAt=now();this.save(c);}
        }
        else { const c = this.cache(); c.heads = {}; c.indexes = {}; c.checkedAt = now(); this.save(c); }
        const cache = this.cache(); cache.gitHead = this.connection.remote.head; this.save(cache);
        return { projects: this.summaries().length, remoteChanged };
    }
    async project(projectId) { return this.items().filter(i => i.projectId === projectId); }
    async hydrate(treeId, { latest = true } = {}) {
        await this.connect();
        const item = this.items().find(i => i.id === treeId);
        if (!item || (this.cache().loaded[treeId] || []).includes(item.ref)) return;
        this.report('Importing session from Git cache', 0, 1, Date.now(), item.name);
        // Stream immutable records before comparing the latest local snapshot.
        let graph = this.read(this.folder(treeId) + '/graph.json');
        assert(graphFingerprint(graph) === item.ref && graph.branches.some(b => b.id === treeId), 'Git session integrity check failed.');
        const deleted = deletedIds(this.store, graph);
        const archivedProjects=new Set(graph.projects.filter(p=>p.archived).map(p=>p.id));
        for(const b of graph.branches)if(b.archived||archivedProjects.has(b.projectId))deleted.add(b.id);
        if (deleted.size) graph = retainedGraph(graph, deleted);
        const needed = new Set(bodyRefs(graph)), exists = this.store.db.prepare('SELECT 1 FROM objects WHERE hash=?');
        let batch = [], bytes = 0;
        const flush = () => { this.store.transaction(() => { for (const [h, body] of batch) this.store.insertObject.run(h, body); }); batch = []; bytes = 0; };
        for await (const [h, body] of this.streamRecords(treeId)) {
            assert(typeof body === 'string' && hash(body) === h, 'Git record integrity check failed.');
            if (needed.delete(h) && !exists.get(h)) { batch.push([h, body]); bytes += Buffer.byteLength(body); }
            if (batch.length >= 128 || bytes >= 4 * 1024 * 1024) {flush();await yieldToLocal();}
        }
        if (batch.length) flush();
        assert(!needed.size, 'Missing Git session record.');
        const currentDeleted=deletedIds(this.store,graph);if(currentDeleted.size)graph=retainedGraph(graph,currentDeleted);
        const before = treeSnapshot(this.store, treeId), c = this.cache();
        const wasDirty = before && graphFingerprint(before) !== c.ack[treeId];
        const result = this.store.merge(graph, {}, { latest });
        c.loaded[treeId] = [item.ref];
        (c.baselines ||= {})[treeId] = changeSnapshot(graph);
        const extraLocal = before?.branches.some(b => !graph.branches.some(r => r.id === b.id));
        if ((!wasDirty || !result.keptLocal && !extraLocal) && !(this.store.local('conflicts') || []).length) {const baseline=treeSnapshot(this.store,treeId);c.ack[treeId]=graphFingerprint(baseline);this.rememberBaseline(treeId,baseline);}
        this.save(c); this.report('Importing session from Git cache', 1, 1, Date.now(), item.name);
        await yieldToLocal();
    }
    async transferPlan() {
        await this.catalog();
        const downloadIds = this.items().filter(i => !(this.cache().loaded[i.id] || []).includes(i.ref)).map(i => i.id);
        return { pull: { trees: downloadIds.length, records: 0 }, push: { trees: this.dirtyIds().length, records: 0, bytes: 0 }, large: false, downloadIds };
    }
    archiveCleanupNeeded() {
        this.useSavedCache();const cache=this.cache();
        return !!cache.archiveEntries?.length||Object.keys(cache.ack).some(id=>{
            const branch=this.store.find('branch',id);
            return branch&&(branch.archived||branch.projectId&&this.store.find('project',branch.projectId)?.archived)&&!this.store.syncCollections().items.some(i=>i.id===id);
        });
    }
    undoKey(id) { return 'git-undo:'+hash(this.readConfig().url||'')+':'+id; }
    rememberBaseline(id,graph,ack=graphFingerprint(graph)) { this.store.local(this.undoKey(id),{ack,graph}); }
    async organizationBaseline(id){
        const cache=this.cache();let graph;try{graph=this.read(this.folder(id)+'/graph.json');}catch{}
        if(graph&&cache.loaded?.[id]?.includes(graphFingerprint(graph))&&cache.baselines?.[id]&&digest(changeSnapshot(graph))===digest(cache.baselines[id]))return graph;
        return this.undoBaseline(id);
    }
    async committedGraph(remote,commit,folder){
        const env={GIT_NO_LAZY_FETCH:'1'};
        const readBlob=async file=>{
            const tree=await remote.run(['ls-tree','-z','--full-tree',commit,'--',file],{accepted:[0,128],env});
            if(tree.code)return null;
            const entry=tree.stdout.split('\0').map(line=>/^100644 blob ([a-f0-9]{40,64})\t(.+)$/.exec(line)).find(row=>row?.[2]===file);
            if(!entry)return null;
            const result=await remote.run(['cat-file','blob',entry[1]],{accepted:[0,128],env,maxOutputBytes:128*1024*1024,trimOutput:false});
            return result.code?null:result.stdout;
        };
        const text=await readBlob(folder+'/graph.json');if(text===null)return null;
        const value=JSON.parse(text);if(!isGraphManifest(value))return value;
        const reader=graphPartsReader(value);
        for(const part of value.parts){const raw=await readBlob(folder+'/graph/'+part.hash+'.jsonl');assert(raw!==null,'Missing committed Git graph part.');reader.append(part,raw);}
        return reader.finish();
    }
    async undoBaseline(id) {
        this.useSavedCache();const ack=this.cache().ack[id];
        if(!ack)return null;
        const saved=this.store.local(this.undoKey(id));if(saved?.ack===ack&&graphFingerprint(saved.graph)===ack)return saved.graph;
        // Older libraries can reuse a verified local checkout. Never fetch just to undo.
        let graph;try{graph=this.read(this.folder(id)+'/graph.json');}catch{}
        if(graph&&graphFingerprint(graph)===ack)return graph;
        // A failed Push may have rewritten the working cache. Read committed local objects,
        // never fetch/push to make Discard work and never trust an unmatched snapshot.
        // Offline recovery must not initialize a checkout or write Git config.
        // Multiple baseline lookups may run together immediately after startup.
        const remote=this.connection?.remote||new GitRemote(this.directory(),this.readConfig().url),file=this.folder(id)+'/graph.json';
        const env={GIT_NO_LAZY_FETCH:'1'},head=this.cache().gitHead;
        const history=await remote.run(['log','--all','--max-count=64','--format=%H','--',file],{accepted:[0,128],env});
        for(const commit of new Set([head,...history.stdout.split(/\s+/)].filter(v=>/^[a-f0-9]{40,64}$/.test(v||'')))){
            // Resolve literal entries and all verified parts from the same
            // commit, even if a failed Push replaced/pruned the working files.
            try{const candidate=await this.committedGraph(remote,commit,this.folder(id));if(candidate&&graphFingerprint(candidate)===ack){this.rememberBaseline(id,candidate);return candidate;}}
            catch(error){if(error.code==='GIT_OUTPUT_LIMIT'||error.name==='AbortError'||error.gitExitCode!==undefined)throw error;}
        }
        // Old libraries can lack the acknowledged graph while a later Pull kept
        // newer local edits. Fall back only to a fully imported remote graph
        // whose content hash AND semantic baseline were already verified.
        const cache=this.cache();
        if(graph&&cache.loaded?.[id]?.includes(graphFingerprint(graph))&&cache.baselines?.[id]&&digest(changeSnapshot(graph))===digest(cache.baselines[id]))return graph;
        assert(false,'No verified local sync snapshot is available for this session. Its current data was kept.',409);
    }
    pendingItems() {
        this.useSavedCache();
        const c = this.cache(), dirty = new Set(this.dirtyIds());
        const items=this.store.syncCollections().items.filter(i=>dirty.has(i.id)).map(i => {
            const graph = treeSnapshot(this.store,i.id);
            let before = c.baselines?.[i.id];
            if (!before && c.ack[i.id]) before = this.store.memo('git-baseline:'+i.id+':'+c.ack[i.id],()=>changeSnapshot(this.read(this.folder(i.id)+'/graph.json')));
            const changes=sessionChanges(before,changeSnapshot(graph),this.store),checkpoint=this.store.local(organizationUndoKey(i.id));
            if(!before&&checkpoint){const localBefore=changeSnapshot({...checkpoint,revisions:checkpoint.branches.map(b=>this.store.find('revision',b.head)).filter(Boolean)});changes.push(...sessionChanges(localBefore,changeSnapshot(graph),this.store).filter(c=>!['session-added','session-removed','transcript-appended','transcript-updated','archive-changed','project-archive','metadata-changed'].includes(c.kind)));}
            const discardable=!!(before&&changes.some(c=>!['session-added','session-removed','transcript-appended','transcript-updated','archive-changed','project-archive','metadata-changed'].includes(c.kind))||checkpoint&&hasOrganizationChanges(checkpoint,currentOrganization(this.store,i.id)));
            return {id:i.id,name:i.name,project:graph.projects.find(p=>p.id===cloudProjectId(i.projectId))?.name || 'Ungrouped',updatedAt:i.updatedAt,action:'upload',discardable,changes};
        }).concat((this.store.local('trashPending') || []).map(e=>({id:e.id,name:(this.store.local('trashEntries')||[]).find(t=>t.id===e.id)?.names.join(', ') || 'Removed sessions',project:this.store.all('project').find(p=>p.id===this.store.find('branch',e.branchIds[0])?.projectId)?.name || 'Ungrouped',action:'remove',updatedAt:e.at,changes:[{kind:'session-removed',label:'Session removed'}]})));
        return items.map(item=>({...item,version:digest([this.readConfig().url||'',item.action==='remove'?(this.store.local('trashPending')||[]).find(e=>e.id===item.id):organizationSignature(currentOrganization(this.store,item.id)),c.ack[item.id]||null])}));
    }
    async publish(treeIds, { catalogFresh = false, rewriteStorage = false } = {}) {
        if (!catalogFresh) {
            await this.catalog();
            for (const item of this.items()) await this.hydrate(item.id);
        }
        assert(!(this.store.local('conflicts') || []).length, 'Resolve sync conflicts before pushing.');
        const remote = this.connection.remote;
        // Capture exactly what this commit will acknowledge before yielding to local edits.
        const changes = this.pendingItems();
        const snapshots = new Map((rewriteStorage?this.store.syncCollections().items.map(i=>i.id):this.dirtyIds()).map(id => [id, treeSnapshot(this.store, id)]));
        const items = new Map(this.store.syncCollections().items.map(i => [i.id, i]));
        const pending = structuredClone(this.store.local('trashPending') || []);
        const state = { schema: 1, cleanupComplete: true, events: [...new Map([...trashState(this.store).events, ...pending].map(e => [e.id, e])).values()] };
        this.write('trash.json', state);
        fs.mkdirSync(this.file('trees'), { recursive: true });
        // Retired roots and trashed paths disappear from HEAD; Git retains old commits.
        const retired = new Set([...items.values()].flatMap(i => i.sessionIds.filter(id => id !== i.id)));
        const archivedRemovals=[];
        for (const old of this.entries()) {
            const local=this.store.find('branch',old.id);
            if(old.archived||old.project?.archived||local&&(local.archived||local.projectId&&this.store.find('project',local.projectId)?.archived)&&!items.has(old.id)){fs.rmSync(this.file(this.folder(old.id)),{recursive:true});archivedRemovals.push(old.id);continue;}
            if (retired.has(old.id) || state.events.some(e => (e.treeIds || []).includes(old.id) || old.sessionIds.every(id => e.branchIds.includes(id)))) {
                fs.rmSync(this.file(this.folder(old.id)), { recursive: true });
            } else if (!snapshots.has(old.id) && old.sessionIds.some(id => state.events.some(e => e.branchIds.includes(id)))) {
                // A removed suffix only changes its own tree in the fetched checkout.
                const graph = retainedGraph(this.read(this.folder(old.id) + '/graph.json'), new Set(state.events.flatMap(e => e.branchIds)));
                const alive = new Set(graph.branches.filter(b => !b.synthetic).map(b => b.id));
                const item = { ...old, sessions: old.sessions.filter(s => alive.has(s.id)), sessionIds: old.sessionIds.filter(id => alive.has(id)), ref: graphFingerprint(graph) };
                this.write(this.folder(old.id) + '/graph.json', graph); this.write(this.folder(old.id) + '/index.json', item);
                const refs = new Set(bodyRefs(graph));
                const records=this.records(old.id);this.writeRecords(old.id,(function*(){for(const row of records)if(refs.has(row[0]))yield row;})());
            }
        }
        let completed = 0;const preparedSnapshots=new Map();
        for (const [id, graph] of snapshots) {
            if (!graph) continue;
            const item = items.get(id); if (!item) continue; const projectId = cloudProjectId(item.projectId);
            const entry = { ...item, projectId, sessions: item.sessions.map(s => ({ ...s, active: false })), ref: graphFingerprint(graph), ancestors: [], project: graph.projects.find(p => p.id === projectId) };
            const refs=bodyRefs(graph),recordsRef=digest([...refs].sort()),previous=this.read(this.folder(id)+'/index.json');
            this.report('Preparing Git commit',completed,snapshots.size,Date.now(),item.name);await yieldToLocal();
            this.write(this.folder(id) + '/graph.json', graph);
            const store = this.store;
            if(rewriteStorage||previous?.recordsCodec!==1||previous.recordsRef!==recordsRef)this.writeRecords(id, (function* () { for (const h of refs) { const body = store.objectStatement.get(h)?.body; assert(typeof body === 'string', 'Missing local record.'); yield [h, body]; } })());
            // Publish the content stamp only after all record chunks/assets exist.
            this.write(this.folder(id) + '/index.json', {...entry,recordsCodec:1,recordsRef});
            preparedSnapshots.set(id,{ref:entry.ref,organization:organizationSignature(organizationSnapshot(graph))});
            snapshots.set(id,null);
            this.report('Preparing Git commit', ++completed, snapshots.size, Date.now(), item.name);
            await yieldToLocal();
        }
        // Prepared files are the frozen upload snapshot. Do not retain the full
        // library's expanded reference vectors while Git packs/sends its data.
        for(const key of this.store.memoCache.keys())if(key==='exportGraph'||key==='cloud-snapshot-index'||key.startsWith('cloud-tree:'))this.store.memoCache.delete(key);
        this.write('grove.json',{format:'session-grove-git',schema:this.dataSchema()});
        this.report('Pushing Git commit');
        await remote.commitAndPush(archivedRemovals.length&&!changes.length?'Grove: keep previous archives local':commitMessage(changes));
        // A failed/non-fast-forward push never clears pending work or acknowledges data.
        const c = this.cache();
        for(const id of archivedRemovals){delete c.ack[id];delete c.loaded[id];if(c.baselines)delete c.baselines[id];}
        for (const [id, snapshot] of preparedSnapshots) {const graph=this.read(this.folder(id)+'/graph.json');assert(graphFingerprint(graph)===snapshot.ref,'Prepared Git snapshot changed during upload.');c.ack[id] = snapshot.ref; this.rememberBaseline(id,graph,snapshot.ref); (c.baselines ||= {})[id] = changeSnapshot(graph); c.loaded[id] = [snapshot.ref];
            if(organizationSignature(currentOrganization(this.store,id))===snapshot.organization)this.store.db.prepare('DELETE FROM local WHERE key=?').run(organizationUndoKey(id));
        }
        c.lastUpload = now(); c.gitHead = remote.head; this.save(c);
        if (state.events.length) applyTrashState(this.store, state); await this.loadDirectory(); this.saveDirectory();
        return { published: snapshots.size, uploaded: 0, commit: remote.head };
    }
}
