import assert from 'node:assert/strict';
export const browserFiles=['scripts/node-browser-smoke.js','scripts/sync-browser-smoke.js','scripts/session-drag-browser-smoke.js','scripts/inline-name-browser-smoke.js','scripts/tree-loading-browser-smoke.js','scripts/onboarding-browser-smoke.js','scripts/conflict-browser-smoke.js','scripts/reconnect-browser-smoke.js','scripts/detail-tools-browser-smoke.js'];
// Repeat OS/filesystem/client boundaries on each supported desktop platform.
// Pure logic and the complete UI suite run on Linux for every change.
export const platformFiles=['activation-diagnostics','autostart','client-refresh','conversion','instance-baselines','native-context-settings','native-readiness','node-activation','prefix-titles','quick-update','record-fidelity','recovery-storage','service','storage-usage','transcription-rename','transcription-titles','trash-actions','windows'].map(name=>'test/'+name+'.test.js');
export const gitFiles=['test/git-cloud.test.js','test/git-output.test.js'];
export const browserCompatibilityFiles=['scripts/sync-browser-smoke.js'];
export function testPlan(files,tests,suite='all'){
    assert.ok(['all','unit','platform','git','core','native','git-1','git-2','browser','browser-compat','browser-1','browser-2'].includes(suite),'Unknown test suite');
    if(suite==='platform'||suite==='git'){
        const selected=suite==='platform'?platformFiles:gitFiles;
        assert.ok(selected.every(file=>files.includes(file)),'A compatibility test file is missing');
        return selected.map(file=>({file}));
    }
    if(suite==='unit')return files.filter(file=>!gitFiles.includes(file)).map(file=>({file}));
    if(suite==='browser-compat')return browserCompatibilityFiles.map(file=>({file}));
    if(suite==='browser')return browserFiles.map(file=>({file}));
    // The main interaction smoke is about as expensive as the other eight
    // flows together. Keep it isolated; each flow owns its server and profile.
    if(suite.startsWith('browser-'))return (suite==='browser-1'?browserFiles.slice(0,1):browserFiles.slice(1)).map(file=>({file}));
    const native='test/autostart.test.js',git='test/git-cloud.test.js';
    if(suite.startsWith('git-')){
        // Each top-level Git case owns its disposable remote and devices.
        // Split cases, not assertions; keep the existing per-process watchdog.
        const names=tests.filter(t=>t.file===git).map(t=>t.name),part=Number(suite.slice(-1))-1;
        assert.ok(names.length>=2&&new Set(names).size===names.length,'Git cases need unique literal names');
        return [{file:git,names:names.filter((_,i)=>i%2===part)}];
    }
    return files.filter(file=>suite==='all'||(suite==='native'?file===native:file!==native&&file!==git)).map(file=>({file}));
}
