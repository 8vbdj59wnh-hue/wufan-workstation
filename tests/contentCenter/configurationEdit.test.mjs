import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../../server/contentCenter/store.mjs';
test('编辑账号和栏目保持原身份，同步需求、候选和排期并防止过期覆盖',()=>{
 const s=createStore(':memory:');try{
 const a=s.getCatalog().accounts[0],old=a.columns[0].name;
 const scheduled=s.save({account:a.id,column:old,title:'排期',copyText:'正文',date:'2026-09-20',time:'10:30',pool:'schedule'});
 const candidate=s.save({account:a.id,column:old,title:'候选',pool:'candidate'});
 const t=s.addReference('templates',{name:'旧模板',account:a.id,column:old});
 s.editConfiguration('columns',a.id,{oldName:old,name:'新栏目'});
 for(const n of [scheduled,candidate]){assert.equal(s.get(n.id).column,'新栏目');assert.equal(s.get(n.id).revision,n.revision+1);}
 assert.equal(s.listTemplates().find(x=>x.id===t.id).column,'新栏目');
 assert.throws(()=>s.save({revision:candidate.revision,title:'过期修改'},candidate.id),/更新/);
 assert.throws(()=>s.editConfiguration('columns',a.id,{oldName:old,name:'另一个'}),/已被修改/);
 const target=s.addConfiguration('units',{name:'新品牌',kind:'品牌'}).id;
 s.editConfiguration('accounts',a.id,{name:'新账号',unitId:target,expectedName:a.name,expectedUnitId:a.unitId});
 assert.equal(s.getCatalog().accounts.find(x=>x.id===a.id).name,'新账号');
 assert.equal(s.get(scheduled.id).unitId,target);assert.equal(s.get(candidate.id).account,a.id);
 assert.throws(()=>s.editConfiguration('accounts',a.id,{name:'过期',unitId:target,expectedName:a.name,expectedUnitId:a.unitId}),/已被修改/);
 assert.throws(()=>s.editConfiguration('columns',a.id,{oldName:'新栏目',name:a.columns[1].name}),/同名/);
 assert.equal(s.get(scheduled.id).column,'新栏目');
 }finally{s.close();}
});
