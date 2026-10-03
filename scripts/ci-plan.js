import assert from 'node:assert/strict';
export const browserFiles=['scripts/node-browser-smoke.js','scripts/sync-browser-smoke.js','scripts/session-drag-browser-smoke.js','scripts/inline-name-browser-smoke.js','scripts/tree-loading-browser-smoke.js','scripts/onboarding-browser-smoke.js'];
export function testPlan(files,tests,suite='all'){
    assert.ok(['all','core','native','git-1','git-2','browser'].includes(suite),'Unknown test suite');
    if(suite==='browser')return browserFiles.map(file=>({file}));
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
