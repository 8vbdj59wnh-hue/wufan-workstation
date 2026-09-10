import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../../server/contentCenter/store.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
const formal={account:'1',column:'半然四季',title:'保留的正式笔记',copyText:'原正文',date:'2026-09-23',time:'10:00',status:'已确认'};
const isCandidate=n=>n.status==='候选'||n.pool==='candidate';
test('候选：仅标题新增、可选账号栏目、编辑与无排期',t=>{
 const s=createStore(':memory:');t.after(()=>s.close());
 let n=s.save({status:'候选',pool:'candidate',title:'一个想法',account:'',column:''});
 assert.ok(isCandidate(n));assert.equal(n.account,'');assert.equal(n.column,'');assert.equal(n.date,'');assert.equal(n.time,'');
 assert.throws(()=>s.save({status:'候选',pool:'candidate',title:'   '}),/标题/);
 assert.throws(()=>s.save({status:'候选',pool:'candidate',title:'错误关联',account:'',column:'半然四季'}),/栏目/);
 n=s.save({account:'1',column:'',copyText:'先写几句话',revision:n.revision},n.id);
 assert.equal(n.column,'');assert.equal(n.copyText,'先写几句话');
 n=s.save({column:'半然四季',revision:n.revision},n.id);assert.equal(n.column,'半然四季');
 assert.throws(()=>s.save({account:'4',revision:n.revision},n.id),/栏目/);
 assert.ok(n.createdAt);assert.ok(n.updatedAt);
});
test('候选转排期：同一记录、原文图片时间戳保留、失败与重复提交保护、正式状态切换',t=>{
 const s=createStore(':memory:');t.after(()=>s.close());const original=s.save(formal);
 const image=s.addImage({name:'参考.png',data:png});
 let n=s.save({status:'候选',pool:'candidate',account:'',column:'',title:'候选工作标题',copyText:'第一段\n\n第二段',hashtags:'#半然 #生活',notes:'保留备注',images:[image.id]});
 const first={...n};
 assert.throws(()=>s.save({status:'已排期',pool:'schedule',revision:n.revision},n.id));
 assert.deepEqual(s.get(n.id),n);assert.equal(s.list().length,2);
 n=s.save({title:'完善后的标题',revision:n.revision},n.id);
 const candidate={...n};
 n=s.save({account:'1',column:'半然四季',status:'已排期',pool:'schedule',date:'2026-09-24',time:'14:30',revision:n.revision},n.id);
 assert.equal(n.id,first.id);assert.equal(n.createdAt,first.createdAt);assert.equal(n.status,'已排期');assert.equal(isCandidate(n),false);
 for(const k of ['title','copyText','hashtags','notes','images'])assert.deepEqual(n[k],candidate[k]);
 assert.equal(s.list().filter(x=>x.id===n.id).length,1);assert.equal(s.list().filter(isCandidate).length,0);
 assert.throws(()=>s.save({status:'已排期',pool:'schedule',date:'2026-09-24',time:'14:30',revision:candidate.revision},n.id),/其他窗口/);
 for(const status of ['已确认','已发布']){n=s.save({status,revision:n.revision},n.id);assert.equal(n.status,status);assert.equal(n.date,'2026-09-24');assert.deepEqual(n.images,[image.id]);}
 assert.deepEqual(s.get(original.id),original);assert.equal(s.backupImages()[0].data,png);
});
test('候选重启与旧候选兼容：原始记录不因读取改写',()=>{
 const folder=mkdtempSync(join(tmpdir(),'banran-candidate-'));const file=join(folder,'test.sqlite');
 try{let s=createStore(file);let n=s.save({status:'候选',pool:'candidate',title:'重启保留',account:'',column:''});const old=s.save(formal);s.close();
 const db=new DatabaseSync(file);const legacy={...old,status:'候选',date:'',time:'',title:'旧候选',reason:'历史字段保留'};delete legacy.pool;const raw=JSON.stringify(legacy);db.prepare('UPDATE notes SET status=?,planned_date=?,body=? WHERE id=?').run('候选','',raw,old.id);db.close();
 s=createStore(file);assert.ok(isCandidate(s.get(n.id)));assert.ok(isCandidate(s.get(old.id)));assert.equal(s.rawNotes().find(x=>x.id===old.id).reason,'历史字段保留');
 n=s.save({title:'旧候选已编辑',date:'',time:'',revision:old.revision},old.id);assert.ok(isCandidate(n));assert.equal(n.reason,'历史字段保留');s.close();
 }finally{rmSync(folder,{recursive:true,force:true});}
});
