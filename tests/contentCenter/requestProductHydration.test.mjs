import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../public/content-center/requests.js',import.meta.url),'utf8');
const hydrate=source.slice(source.indexOf('async function hydrateRequestProducts('),source.indexOf('async function matchRequestProduct('));
test('重复关联产品的所有需求均刷新缓存卡片，重新渲染也不残留读取中',async()=>{
 const notes=[{id:'a',revision:1,workstationProductIds:['p1']},{id:'b',revision:1,workstationProductIds:['p1']},{id:'c',revision:1,workstationProductIds:['p1','p2']}];
 const cache=new Map(),cells=new Map(notes.map(n=>[n.id,{innerHTML:'读取中'}]));let requests=0;
 const ctx=vm.createContext({window:{contentCenterPermissions:{products:true}},requestProductCache:cache,requestRefLoads:new Map(),
 requestRow:id=>({querySelector:()=>cells.get(id)}),requestProductTiles:n=>n.workstationProductIds.map(id=>cache.get(id)?.name||'读取中').join(','),
 api:async url=>{requests++;return {productOptions:(url.endsWith('a')?['p1']:['p1','p2']).map(id=>({erpSkuId:id,name:id+'名称'}))}}});
 vm.runInContext(hydrate+';globalThis.hydrate=hydrateRequestProducts;',ctx);
 await ctx.hydrate(notes);
 assert.equal(requests,2);assert.equal(cells.get('b').innerHTML,'p1名称');assert.equal(cells.get('c').innerHTML,'p1名称,p2名称');
 for(const cell of cells.values())cell.innerHTML='读取中';
 await ctx.hydrate(notes);assert.equal(requests,2);
 for(const cell of cells.values())assert.ok(!cell.innerHTML.includes('读取中'));
});
