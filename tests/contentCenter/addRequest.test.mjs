import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const app=fs.readFileSync(new URL('../../public/content-center/app.js',import.meta.url),'utf8');
const requests=fs.readFileSync(new URL('../../public/content-center/requests.js',import.meta.url),'utf8');
test('新增需要具体日期、栏目、管理权限并能唯一识别账号',()=>{
 const c=vm.createContext({window:{contentCenterPermissions:{manage:true}},requestDay:'2026-09-14',filters:{column:'栏目'},nextRequestWeek:()=>[{date:'2026-09-14'}],visibleAccounts:()=>[{id:'a',columns:[{name:'栏目'}]}]});
 vm.runInContext(app.slice(app.indexOf('function newRequestContext'),app.indexOf('function nextRequestWeek')),c);
 assert.equal(c.newRequestContext().accountId,'a');c.requestDay='';assert.equal(c.newRequestContext(),null);c.requestDay='2026-09-14';c.filters.column='';assert.equal(c.newRequestContext(),null);c.filters.column='栏目';c.window.contentCenterPermissions.manage=false;assert.equal(c.newRequestContext(),null);
});
test('局域网HTTP没有randomUUID仍能生成不同本地需求ID',()=>{
 const c=vm.createContext({crypto:{},Date});vm.runInContext(requests.slice(requests.indexOf('let localRequestSequence'),requests.indexOf("$('#workspace').addEventListener('click',e=>{\nif(!e.target.closest('[data-add-request]')")),c);
 assert.notEqual(c.createLocalRequestId(),c.createLocalRequestId());
});
