import test from 'node:test';import assert from 'node:assert/strict';
import {searchTree} from '../web/tree-search.js';import {pinnedAncestors} from '../web/graph-ancestors.js';import {graphLayout} from '../web/library-view.js';
const nodes=[{id:'root',name:'Shared setup',chatIds:['s'],branchIds:['a','b'],childIds:['left','right'],parentIds:[],endBranchIds:[]},{id:'left',name:'Left work',chatIds:['a'],branchIds:['a'],childIds:[],parentIds:['root'],endBranchIds:['a']},{id:'right',name:'Right work',chatIds:['b'],branchIds:['b'],childIds:[],parentIds:['root'],endBranchIds:['b']}];
const message=(id,text)=>({id,text,line:1,role:'user'});
const tree={nodes,edges:[{from:'root',to:'left'},{from:'root',to:'right'}],paths:[{branchId:'a',name:'Alpha',nodeIds:['root','left'],messages:[message('s','Shared needle'),message('a','Left phrase')],context:{compactions:[]}},{branchId:'b',name:'Beta',nodeIds:['root','right'],messages:[message('s','Shared needle'),message('b','Right <script>text</script>')],context:{compactions:[]}}]};
test('tree search covers all paths, deduplicates shared messages and prefers the current route',()=>{
 assert.equal(searchTree(tree,'needle','b').total,1);assert.equal(searchTree(tree,'needle','b').results[0].branchId,'b');assert.equal(searchTree(tree,'right','a').results[0].branchId,'b');assert.ok(searchTree(tree,'RIGHT','a').total>=1);assert.equal(searchTree(tree,'Shared setup','a').results[0].kind,'node');assert.equal(searchTree(tree,'Beta','a').results[0].kind,'path');assert.equal(searchTree(tree,'   ','a').total,0);assert.ok(searchTree(tree,'<script>','a').results[0].snippet.includes('<script>'));
 const limited=searchTree(tree,'','a',1);assert.equal(limited.results.length,0);const one=searchTree(tree,'work','a',1);assert.equal(one.total,2);assert.equal(one.results.length,1);
});
test('pinned ancestors contain only the visible branch ancestry and stay inside the viewport',()=>{
 const layout=graphLayout(tree,'b'),camera={x:-layout.positions.get('right').x+180,y:-layout.positions.get('right').y+50,zoom:1};
 const pinned=pinnedAncestors(tree,layout,camera,400,400,'b','right');assert.ok(pinned);assert.equal(pinned.branchId,'b');assert.deepEqual(pinned.items.map(i=>i.id),['root']);assert.ok(!pinned.items.some(i=>i.id==='left'));for(const item of pinned.items)assert.ok(item.x>=0&&item.y>=0&&item.x+item.width<=400&&item.y+item.height<=400);
 assert.equal(pinnedAncestors(tree,layout,{x:0,y:0,zoom:.5},800,800,'a','root'),null);
});
test('a long offscreen chain lists every ancestor in order within a scrollable rail',()=>{
 const chain=Array.from({length:30},(_,i)=>({id:String(i),name:'Node '+i,chatIds:[String(i)],branchIds:['p'],childIds:i<29?[String(i+1)]:[],parentIds:i?[String(i-1)]:[],endBranchIds:i===29?['p']:[]})),t={nodes:chain,edges:chain.slice(1).map((n,i)=>({from:String(i),to:n.id})),paths:[{branchId:'p',name:'Long',nodeIds:chain.map(n=>n.id),messages:[],context:{compactions:[]}}]},layout=graphLayout(t,'p');
 const pin=pinnedAncestors(t,layout,{x:150,y:50-layout.positions.get('29').y,zoom:1},400,400,'p','29');assert.ok(pin);assert.deepEqual(pin.items.map(i=>i.id),chain.slice(0,-1).map(n=>n.id));assert.ok(pin.items.every(i=>i.node&&!i.members));assert.ok(pin.rail.y+pin.rail.height<=400);assert.ok(pin.items.at(-1).y>pin.rail.height,'overflow is scrollable, not grouped or omitted');
});

test('ancestors cropped on the left attach at the upper right and vice versa',()=>{
 const positions=new Map([['root',{x:-180,y:-120}],['left',{x:-300,y:100}],['right',{x:80,y:100}]]),layout={positions};
 const right=pinnedAncestors(tree,layout,{x:0,y:0,zoom:1},400,400,'b','right');assert.equal(right.side,'right');assert.equal(right.rail.y,6);assert.ok(right.rail.x>200);
 positions.set('root',{x:440,y:-120});const left=pinnedAncestors(tree,layout,{x:0,y:0,zoom:1},400,400,'b','right');assert.equal(left.side,'left');assert.equal(left.rail.x,6);
});
