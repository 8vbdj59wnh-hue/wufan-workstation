import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../../server/contentCenter/store.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('品牌选品独立持久化，支持备注及删除，冲突与无效输入不覆盖已确认数据',()=>{
 const dir=mkdtempSync(join(tmpdir(),'selection-'));let s=createStore(join(dir,'content.sqlite'));
 try{
 const brands=s.getCatalog().units.filter(u=>u.kind==='品牌');const first=brands[0].id;
 const other=s.addConfiguration('units',{name:'选品测试品牌',kind:'品牌'}).id;
 const groups={primary:[{productId:'sku-a',remark:'重点讲解尺寸'}],secondary:[],new:[{productId:'sku-b',remark:''}]};
 const saved=s.productSelection.put(first,{revision:0,groups});
 assert.equal(saved.revision,1);assert.equal(s.productSelection.get(other).groups.primary.length,0);
 assert.throws(()=>s.productSelection.put(first,{revision:0,groups}),/已被他人更新/);
 assert.throws(()=>s.productSelection.put(first,{revision:1,groups:{...groups,primary:[groups.primary[0],groups.primary[0]]}}),/同组重复/);
 assert.throws(()=>s.productSelection.put('missing',{revision:0,groups}),/有效品牌/);
 s.close();s=createStore(join(dir,'content.sqlite'));assert.deepEqual(s.productSelection.get(first).groups,groups);
 const cleared=s.productSelection.put(first,{revision:1,groups:{primary:[],secondary:[],new:[]}});assert.equal(cleared.revision,2);assert.equal(cleared.groups.primary.length,0);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('选品接口校验查看/管理/产品权限，拒绝不存在的产品并保护版本',async t=>{
 const {default:express}=await import('express');
 const {createContentCenterRouter}=await import('../../server/contentCenterRouter.js');
 const s=createStore(':memory:');const brand=s.getCatalog().units.find(u=>u.kind==='品牌').id;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=req.get('Authorization');next();});
 const hasPermission=(u,key)=>u==='admin'||(u==='reader'&&['contentCenter.view','products.view'].includes(key))||(u==='editor'&&key.startsWith('contentCenter.'));
 const requirePermission=key=>(req,res,next)=>hasPermission(req.user,key)?next():res.sendStatus(403);
 app.use(createContentCenterRouter({store:s,dataDir:'/tmp',getDatabase:()=>null,hasPermission,requirePermission,integration:{selectionProducts:ids=>ids.filter(id=>id==='known').map(id=>({erpSkuId:id,name:'花瓶'}))}}));
 const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});t.after(()=>{server.close();s.close();});
 const call=(who,method='GET',body)=>fetch(`http://127.0.0.1:${server.address().port}/product-selection/${brand}`,{method,headers:{Authorization:who,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data={revision:0,groups:{primary:[{productId:'known',remark:'主推'}],secondary:[],new:[]}};
 assert.equal((await call('reader')).status,200);assert.equal((await call('editor')).status,403);assert.equal((await call('reader','PUT',data)).status,403);assert.equal((await call('editor','PUT',data)).status,403);
 assert.equal((await call('admin','PUT',{...data,groups:{...data.groups,primary:[{productId:'missing',remark:''}]}})).status,400);
 assert.equal((await call('admin','PUT',data)).status,200);assert.equal((await call('admin','PUT',data)).status,409);
 const read=await (await call('reader')).json();assert.equal(read.products[0].erpSkuId,'known');assert.equal(read.groups.primary[0].remark,'主推');
});
