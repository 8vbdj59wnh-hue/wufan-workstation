import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore,catalog,statuses} from '../../server/contentCenter/store.mjs';
const draft={account:'4',column:'阿柚选品笔记',title:'半年后还喜欢的器物',copyText:'生活里的真实记录',date:'2026-09-12',time:'10:30',hashtags:'#半然'};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
function setup(t){const s=createStore(':memory:');t.after(()=>s.close());return s;}
test('五账号十七栏目、必填校验、四种状态与日期保留',t=>{const s=setup(t);assert.equal(catalog.accounts.length,5);assert.equal(catalog.accounts.flatMap(a=>a.columns).length,17);assert.throws(()=>s.save({...draft,column:'阿柚审美笔记'}),/已确认/);assert.throws(()=>s.save({...draft,account:'3'}),/已确认/);for(const key of ['title','date','time'])assert.throws(()=>s.save({...draft,[key]:''}),/请填写/);let n=s.save(draft);assert.equal(n.status,'草稿');for(const status of statuses){n=s.save({status,revision:n.revision},n.id);assert.equal(n.date,draft.date);assert.equal(n.status,status);}assert.throws(()=>s.save({...draft,status:'待审核'}),/状态/);});
test('非法日期时间、图片、事务回滚和并发覆盖保护',t=>{const s=setup(t);for(const date of ['2026-02-30','09/12/2026','2026-13-01'])assert.throws(()=>s.save({...draft,date}),/日期/);assert.throws(()=>s.save({...draft,time:'24:00'}),/时间/);assert.throws(()=>s.save({...draft,images:['missing']}),/参考图/);const a=s.save(draft),b=s.save(draft);assert.throws(()=>s.batch([{id:a.id,revision:1},{id:b.id,revision:2}],{status:'已确认'}),/其他窗口/);assert.equal(s.get(a.id).revision,1);const latest=s.save({title:'新的标题',revision:1},a.id);assert.throws(()=>s.save({title:'过期',revision:1},a.id),/其他窗口/);assert.equal(s.get(a.id).title,latest.title);});
test('多图上传、关联复用、移除关联不删除原图',t=>{const s=setup(t);const a=s.addImage({name:'一.png',data:png}),b=s.addImage({name:'二.png',data:png});let n=s.save({...draft,images:[a.id,b.id]});assert.equal(n.images.length,2);const other=s.save({...draft,images:[a.id]});n=s.save({images:[],revision:n.revision},n.id);assert.equal(s.get(other.id).images[0],a.id);assert.equal(s.listImages().length,2);assert.equal(s.backupImages()[0].data,png);assert.throws(()=>s.addImage({name:'假.png',data:'data:image/png;base64,YWJj'}),/不一致/);});
test('旧数据非破坏兼容、状态映射、正文话题分离、重启持久化',()=>{const folder=mkdtempSync(join(tmpdir(),'banran-legacy-')),path=join(folder,'data.sqlite');try{let s=createStore(path);const n=s.save(draft);s.close();const db=new DatabaseSync(path);const old={...n,title:'',initialTitle:'旧标题',copyText:'旧正文\\n\\n#半然 #生活',time:'',status:'已确认执行',reason:'原始推荐理由',executionNumber:'keep',unknownField:'保留'};delete old.hashtags;const body=JSON.stringify(old);db.prepare('UPDATE notes SET status=?,body=? WHERE id=?').run(old.status,body,n.id);db.close();s=createStore(path);const decoded=s.get(n.id);assert.equal(decoded.status,'已确认');assert.equal(decoded.title,'旧标题');assert.equal(decoded.copyText,'旧正文');assert.equal(decoded.hashtags,'#半然 #生活');assert.equal(decoded.time,'');assert.equal(s.rawNotes()[0].copyText,old.copyText);const updated=s.save({status:'已发布',revision:n.revision},n.id);assert.equal(updated.reason,old.reason);assert.equal(updated.unknownField,'保留');assert.equal(updated.legacyStatus,'已确认执行');s.close();s=createStore(path);assert.equal(s.get(n.id).executionNumber,'keep');assert.equal(s.get(n.id).status,'已发布');s.close();}finally{rmSync(folder,{recursive:true,force:true});}});

test('候选仅标题、可选账号栏目、三字段转排期原样保留',t=>{
 const s=setup(t),p=s.addReference('products',{name:'白瓷瓶',sku:'B001'}),p2=s.addReference('products',{name:'玻璃瓶',status:'停用'}),template=s.addReference('templates',{name:'器物图文',account:'4',column:'阿柚选品笔记',notes:'白底'});
 let n=s.save({pool:'candidate',title:'想法'});assert.equal(n.account,'');assert.equal(n.date,'');assert.equal(n.noteFormat,'');
 assert.throws(()=>s.save({pool:'candidate',title:'无账号栏目',column:'半然日志'}),/已确认/);
 const image=s.addImage({name:'参考.png',data:png});
 n=s.save({revision:n.revision,noteFormat:'视频',productIds:[p.id,p2.id,p.id],templateId:template.id,images:[image.id],hashtags:'#半然',notes:'保留',copyText:'想法正文'},n.id);
 assert.deepEqual(n.productIds,[p.id,p2.id]);
 assert.throws(()=>s.save({pool:'schedule',revision:n.revision},n.id),/请选择|请填写/);
 const scheduled=s.save({pool:'schedule',account:'4',column:'阿柚选品笔记',date:'2026-09-15',time:'10:00',status:'已排期',revision:n.revision},n.id);
 for(const key of ['id','createdAt','noteFormat','productIds','templateId','images','hashtags','notes','copyText'])assert.deepEqual(scheduled[key],n[key]);
 assert.equal(s.list().length,1);assert.equal(scheduled.pool,'schedule');
 assert.throws(()=>s.save({...draft,noteFormat:'直播'}),/笔记形式/);assert.throws(()=>s.save({...draft,productIds:['missing']}),/关联产品/);assert.throws(()=>s.save({...draft,templateId:'missing'}),/关联模板/);
 const empty=s.save({...draft,noteFormat:'',productIds:[],templateId:''});assert.equal(empty.noteFormat,'');
 assert.equal(s.save({revision:scheduled.revision,title:'修改标题'},scheduled.id).templateId,template.id);
});
test('产品模板与候选刷新持久化，旧候选状态兼容',()=>{
 const dir=mkdtempSync(join(tmpdir(),'banran-v12-')),path=join(dir,'data.sqlite');try{let s=createStore(path);const p=s.addReference('products',{name:'器物'}),t=s.addReference('templates',{name:'模板'}),n=s.save({pool:'candidate',title:'持久化',productIds:[p.id],templateId:t.id});s.close();s=createStore(path);assert.deepEqual(s.get(n.id).productIds,[p.id]);assert.equal(s.listProducts()[0].name,'器物');assert.equal(s.listTemplates()[0].id,t.id);s.close();const db=new DatabaseSync(path),legacy={...n,status:'候选'};delete legacy.pool;db.prepare('UPDATE candidates SET body=? WHERE id=?').run(JSON.stringify(legacy),n.id);db.close();s=createStore(path);assert.equal(s.get(n.id).pool,'candidate');assert.equal(s.rawNotes()[0].status,'候选');s.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
