import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { createContentCenterRouter, matchContentProductCodes } from '../../server/contentCenterRouter.js';
import { createStore } from '../../server/contentCenter/store.mjs';
import { hasPermission, canAccessModule, createEmptyPermissions } from '../../shared/permissions.js';

test('接口登录、查看、写入、导出、产品授权和冲突保护', async t => {
 const store = createStore(':memory:'); const db = new Database(':memory:');
 db.exec('CREATE TABLE erp_goods(id TEXT,goodsCode TEXT,goodsName TEXT,currentState TEXT)');
 const user = (view, manage=false) => ({role:'member', permissions:{...createEmptyPermissions(),contentCenter:{view,manage,export:false}}});
 const users={reader:user(true),editor:user(true,true),denied:user(false),admin:{role:'admin'}};
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user=users[req.get('Authorization')];if(!req.user)return res.sendStatus(401);next();});
 const requirePermission=key=>(req,res,next)=>hasPermission(req.user,key)?next():res.sendStatus(403);
 app.use('/api/content-center',createContentCenterRouter({requirePermission,hasPermission,getDatabase:()=>db,dataDir:'/tmp',store}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>{server.close();store.close();db.close();});
 const call=(url,user='',method='GET',body)=>fetch(`http://127.0.0.1:${server.address().port}/api/content-center${url}`,{method,headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal(canAccessModule(users.reader,'contentCenter'),true);assert.equal(canAccessModule(users.denied,'contentCenter'),false);
 for(const url of ['/meta','/notes','/images','/images/missing','/templates','/requests','/backup','/product-matches?codes=X']){assert.equal((await call(url)).status,401);assert.equal((await call(url,'denied')).status,403);}
 assert.equal((await call('/notes','reader')).status,200);
 for(const [url,method] of [['/notes','POST'],['/notes/nope','PATCH'],['/batch','POST'],['/requests/batch','POST'],['/requests/nope','PATCH'],['/requests/nope/schedule','POST'],['/images','POST'],['/templates','POST'],['/configuration/units','POST']])assert.equal((await call(url,'reader',method,{})).status,403);
 assert.equal((await call('/backup','reader')).status,403);assert.equal((await call('/product-matches?codes=X','reader')).status,403);
 const created=await call('/notes','editor','POST',{pool:'candidate',title:'测试',account:'',column:''});assert.equal(created.status,201);const note=await created.json();
 assert.equal((await call(`/notes/${note.id}`,'editor','PATCH',{title:'更新',revision:note.revision})).status,200);
 assert.equal((await call(`/notes/${note.id}`,'editor','PATCH',{title:'覆盖',revision:note.revision})).status,409);
 assert.equal((await call('/requests/batch','editor','POST',{items:[{account:'missing'}]})).status,404);assert.equal(store.list().length,1);
 assert.equal((await call('/configuration/units','editor','POST',{name:'部门',kind:'部门'})).status,400);
 assert.equal((await call('/products','admin','POST',{})).status,404);
 const backup=await call('/backup','admin');assert.equal(backup.status,200);assert.equal((await backup.json()).notes[0].id,note.id);
});

test('编码精确匹配，未知和歧义保留输入',()=>{
 const db=new Database(':memory:');db.exec("CREATE TABLE erp_goods(id TEXT,goodsCode TEXT,goodsName TEXT,currentState TEXT);INSERT INTO erp_goods VALUES ('1','ABC','花瓶','active'),('2','DUP','一','active'),('3','DUP','二','active')");
 const result=matchContentProductCodes(db,'ABC、abc、UNKNOWN、DUP、ABC');
 assert.deepEqual(result.map(x=>x.status),['matched','unknown','unknown','ambiguous']);assert.equal(result[0].matches[0].goodsName,'花瓶');assert.equal(result[2].code,'UNKNOWN');db.close();
});
