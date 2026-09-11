import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore,catalog} from '../../server/contentCenter/store.mjs';
test('统一账号保留历史引用，双入口改名同步，重复迁移不创建账号',()=>{
 const dir=mkdtempSync(join(tmpdir(),'account-registry-'));const file=join(dir,'main.db');const db=new Database(file);
 db.exec('CREATE TABLE publishing_accounts(id TEXT PRIMARY KEY,name TEXT,platform TEXT,ownerId TEXT,status TEXT,createdAt TEXT,updatedAt TEXT)');
 db.prepare('INSERT INTO publishing_accounts(id,name,status) VALUES (?,?,?)').run('existing',catalog.accounts[0].name,'active');
 let store;
 try{
 store=createStore(join(dir,'content.db'),{accountRegistryPath:file});
 const first=store.getCatalog().accounts.find(a=>a.id===catalog.accounts[0].id);
 assert.equal(first.publishingAccountId,'existing');assert.ok(first.columns.length);
 const count=db.prepare('SELECT count(*) n FROM publishing_accounts').get().n;
 store.syncAccounts();assert.equal(db.prepare('SELECT count(*) n FROM publishing_accounts').get().n,count);
 const created=store.addConfiguration('accounts',{name:'统一新增账号',unitId:'banran',columns:['新栏目']});
 const account=store.getCatalog().accounts.find(a=>a.id===created.id);assert.equal(db.prepare('SELECT name FROM publishing_accounts WHERE id=?').get(account.publishingAccountId).name,'统一新增账号');
 store.editConfiguration('accounts',account.id,{name:'内容改名',unitId:'banran',expectedName:account.name,expectedUnitId:'banran'});
 assert.equal(db.prepare('SELECT name FROM publishing_accounts WHERE id=?').get(account.publishingAccountId).name,'内容改名');
 db.prepare('UPDATE publishing_accounts SET name=? WHERE id=?').run('系统改名',account.publishingAccountId);store.syncAccounts();assert.equal(store.getCatalog().accounts.find(a=>a.id===account.id).name,'系统改名');
 db.prepare('INSERT INTO publishing_accounts(id,name,status) VALUES (?,?,?)').run('from-main','系统新增','active');store.syncAccounts();assert.ok(store.getCatalog().accounts.some(a=>a.publishingAccountId==='from-main'));
 }finally{store?.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
