import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebDAV } from '../src/sync.js';
test('idempotent reads recover from a closed keep-alive socket without retrying missing objects or cancellation',async t=>{
 let requests=0;const server=http.createServer((req,res)=>{requests++;if(req.url.endsWith('/missing')){res.writeHead(404);return res.end();}if(requests===1){req.socket.destroy();return;}res.end('verified');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.close();await once(server,'close');});
 const dav=new WebDAV({url:'http://127.0.0.1:'+server.address().port});assert.equal((await dav.get('objects/example')).toString(),'verified');assert.equal(requests,2);assert.equal(await dav.get('missing'),null);assert.equal(requests,3);dav.controller.abort();await assert.rejects(dav.get('objects/example'));assert.equal(requests,3);
});
