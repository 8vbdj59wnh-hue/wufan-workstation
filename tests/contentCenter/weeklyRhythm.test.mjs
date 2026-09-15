import {Solar} from 'lunar-javascript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../../server/contentCenter/store.mjs';
test('阿柚每周25条，滚动两周生成，不覆盖或重复生成，暂停后停止新增',()=>{
 const s=createStore(':memory:');try{
 const a=s.getCatalog().accounts.find(a=>a.name==='阿柚');assert.ok(a);
 s.weeklyRhythm.seedAyYou();const rule=s.weeklyRhythm.get(a.id);assert.equal(rule.slots.length,25);
 const counts={};rule.slots.forEach(x=>counts[x.column]=(counts[x.column]||0)+1);
 assert.deepEqual(counts,{'阿柚选品笔记':13,'半然收藏家':4,'半然新品预告':5,'半然选择题':3});
 const now=new Date('2026-09-14T03:00:00Z');assert.equal(s.weeklyRhythm.generate(now).created,50);assert.equal(s.list().length,50);
 const first=s.list()[0];s.save({revision:first.revision,notes:'保留已填写的想法'},first.id);
 assert.equal(s.weeklyRhythm.generate(now).created,0);assert.equal(s.get(first.id).notes,'保留已填写的想法');
 assert.equal(s.weeklyRhythm.generate(new Date('2026-09-21T03:00:00Z')).created,25);
 s.weeklyRhythm.put(a.id,{...rule,enabled:false});assert.equal(s.weeklyRhythm.generate(new Date('2026-10-01T03:00:00Z')).created,0);
 assert.throws(()=>s.weeklyRhythm.put(a.id,rule),/更新/);
 }finally{s.close();}
});
test('占用时段保留手工需求，跨年仍为周一，非法重复时段拒绝',()=>{
 const s=createStore(':memory:');try{
 const a=s.getCatalog().accounts[0],column=a.columns[0].name;
 const rule=s.weeklyRhythm.put(a.id,{revision:0,enabled:true,slots:[{weekday:1,time:'09:00',column}]});
 const n=s.save({account:a.id,column,pool:'candidate',contentStage:'request',notes:'已有需求',preferredDate:'2027-01-04',preferredTime:'09:00'});
 assert.equal(s.weeklyRhythm.generate(new Date('2026-12-31T08:00:00Z')).created,1);assert.equal(s.get(n.id).notes,'已有需求');
 assert.throws(()=>s.weeklyRhythm.put(a.id,{...rule,slots:[...rule.slots,...rule.slots]}),/同一时段/);
 }finally{s.close();}
});

test('小茉沿用现有栏目，每周25条，两账号独立生成且保留用户修改',()=>{
 const s=createStore(':memory:');try{
 const a=s.getCatalog().accounts.find(a=>a.name==='小茉');assert.ok(a);
 s.weeklyRhythm.seedXiaoMo();const rule=s.weeklyRhythm.get(a.id);
 assert.equal(rule.slots.length,25);
 const expected=[['半然插花日记','半然使用说明书','半然插花日记','半然试花间'],['半然使用说明书','半然插花日记','半然使用说明书'],['半然插花日记','半然试花间','半然使用说明书','半然插花日记'],['半然使用说明书','半然插花日记','半然试花间'],['半然插花日记','半然使用说明书','半然插花日记','半然试花间'],['半然插花日记','半然使用说明书','半然使用日记','半然试花间'],['半然插花日记','半然使用说明书','半然使用日记']];
 for(let weekday=1;weekday<=7;weekday++){
  const slots=rule.slots.filter(x=>x.weekday===weekday);
  assert.deepEqual(slots.map(x=>x.column),expected[weekday-1]);
  assert.deepEqual(slots.map(x=>x.time),['09:00','12:30','18:30','21:30'].slice(0,slots.length));
 }
 s.weeklyRhythm.seedAyYou();const now=new Date('2026-09-14T03:00:00Z');
 assert.equal(s.weeklyRhythm.generate(now).created,100);
 assert.equal(s.list().filter(n=>n.account===a.id).length,50);
 assert.equal(s.weeklyRhythm.generate(now).created,0);
 const updated=s.weeklyRhythm.put(a.id,{...rule,enabled:false,slots:rule.slots.slice(1)});
 s.weeklyRhythm.seedXiaoMo();assert.deepEqual(s.weeklyRhythm.get(a.id),updated);
 }finally{s.close();}
});

test('BANRAN常规每周7条，秋分替换周三，保存节奏和跨周刷新保留节气规则',()=>{
 const s=createStore(':memory:');try{
 const a=s.getCatalog().accounts.find(a=>a.fullName==='半然BANRAN');
 s.weeklyRhythm.seedBanran();const rule=s.weeklyRhythm.get(a.id);
 assert.deepEqual(rule.slots.map(x=>[x.weekday,x.time,x.column]),[[1,'20:30','半然日志'],[2,'11:30','半然上新'],[3,'20:30','半然日志'],[4,'20:30','半然日志'],[5,'11:30','半然上新'],[6,'20:30','半然日志'],[7,'20:00','半然日志']]);
 const now=new Date('2026-09-14T03:00:00Z');assert.equal(s.weeklyRhythm.generate(now).created,14);
 const autumn=s.list().filter(n=>n.preferredDate==='2026-09-23');
 assert.equal(autumn.length,1);assert.equal(autumn[0].preferredTime,'08:00');assert.equal(autumn[0].column,'半然四季');assert.match(autumn[0].notes,/秋分/);
 assert.equal(s.weeklyRhythm.generate(now).created,0);
 const updated=s.weeklyRhythm.put(a.id,{revision:rule.revision,enabled:true,slots:rule.slots});assert.deepEqual(updated.solarTerm,rule.solarTerm);
 assert.equal(s.weeklyRhythm.generate(new Date('2026-09-21T03:00:00Z')).created,7);
 assert.throws(()=>s.weeklyRhythm.put(a.id,{...updated,solarTerm:{column:'不存在',time:'08:00'}}),/节气/);
 }finally{s.close();}
});
test('节气日期与香港天文台2026公农历对照表一致，使用中国日期不依赖服务器时区',()=>{
 // https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
 const expected=['01-05','01-20','02-04','02-18','03-05','03-20','04-05','04-20','05-05','05-21','06-05','06-21','07-07','07-23','08-07','08-23','09-07','09-23','10-08','10-23','11-07','11-22','12-07','12-22'];
 const actual=[];
 for(let m=1;m<=12;m++)for(let d=1;d<=new Date(Date.UTC(2026,m,0)).getUTCDate();d++)if(Solar.fromYmd(2026,m,d).getLunar().getJieQi())actual.push(`${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
 assert.deepEqual(actual,expected);
 const s=createStore(':memory:');try{
 s.weeklyRhythm.seedBanran();s.weeklyRhythm.generate(new Date('2026-12-27T16:30:00Z'));
 const winter=s.list().filter(n=>n.preferredDate==='2027-01-05');
 assert.equal(winter.length,1);assert.equal(winter[0].column,'半然四季');assert.equal(winter[0].preferredTime,'08:00');
 }finally{s.close();}
});

test('家的片段每周17条，角色随时段生成，编辑节奏不丢角色或覆盖已填写需求',()=>{
 const s=createStore(':memory:');try{
 const a=s.getCatalog().accounts.find(a=>a.name==='半然家的片段');s.weeklyRhythm.seedHomeFragments();const rule=s.weeklyRhythm.get(a.id);
 assert.equal(rule.slots.length,17);
 assert.deepEqual(Array.from({length:7},(_,i)=>rule.slots.filter(x=>x.weekday===i+1).map(x=>x.time)),[['10:00','20:30'],['10:00','20:30'],['10:00','17:00','20:30'],['10:00','20:30'],['10:00','17:00','20:30'],['10:00','17:00','20:30'],['10:00','20:30']]);
 const counts={};rule.slots.forEach(x=>counts[x.column]=(counts[x.column]||0)+1);assert.deepEqual(counts,{'半然家的片段':9,'半然灵感':5,'半然摆放手册':3});
 const now=new Date('2026-09-14T03:00:00Z');assert.equal(s.weeklyRhythm.generate(now).created,34);
 const notes=s.list();assert.equal(notes.find(n=>n.preferredDate==='2026-09-26'&&n.preferredTime==='17:00').notes,'周末收藏型实用内容');
 assert.equal(notes.find(n=>n.preferredDate==='2026-09-27'&&n.preferredTime==='20:30').notes,'周末空间灵感');
 for(const n of notes){const weekday=(new Date(n.preferredDate+'T00:00:00Z').getUTCDay()+6)%7+1;const slot=rule.slots.find(x=>x.weekday===weekday&&x.time===n.preferredTime);assert.equal(n.column,slot.column);assert.equal(n.notes,slot.role);}
 const first=notes[0];s.save({revision:first.revision,notes:'已填写的具体策划'},first.id);assert.equal(s.weeklyRhythm.generate(now).created,0);assert.equal(s.get(first.id).notes,'已填写的具体策划');
 const updated=s.weeklyRhythm.put(a.id,{...rule,slots:rule.slots.map(({role,...slot})=>slot)});assert.deepEqual(updated.slots,rule.slots);
 s.weeklyRhythm.seedHomeFragments();assert.equal(s.weeklyRhythm.get(a.id).revision,updated.revision);
 assert.throws(()=>s.weeklyRhythm.put(a.id,{...updated,slots:[{...updated.slots[0],role:123}]}),/内容角色/);
 }finally{s.close();}
});

test('南屿移除四宫格新增7栏目，每周20条且历史内容不丢失、重复初始化不重置节奏',()=>{
 const s=createStore(':memory:');try{
 const unit=s.addConfiguration('units',{name:'南屿',kind:'品牌'}).id;
 const id=s.addConfiguration('accounts',{name:'南屿nanyu',unitId:unit,columns:['四宫格']}).id;
 const old=s.save({account:id,column:'四宫格',pool:'candidate',contentStage:'request',notes:'保留原需求'});
 s.weeklyRhythm.seedNanyu();
 const a=s.getCatalog().accounts.find(a=>a.id===id);
 assert.deepEqual(a.columns.map(c=>c.name),['单品分享','多品分享','插花搭配','主理人与经营片段','送礼场景','季节与情绪','互动选择']);
 assert.equal(s.get(old.id).notes,'保留原需求');assert.equal(s.get(old.id).column,'');
 const rule=s.weeklyRhythm.get(id);assert.equal(rule.slots.length,20);
 const expected=[['单品分享','多品分享','单品分享'],['单品分享','插花搭配','主理人与经营片段'],['单品分享','多品分享','送礼场景'],['单品分享','插花搭配','单品分享'],['单品分享','多品分享','季节与情绪'],['单品分享','插花搭配','互动选择'],['单品分享','单品分享']];
 for(let weekday=1;weekday<=7;weekday++){
 const slots=rule.slots.filter(x=>x.weekday===weekday);assert.deepEqual(slots.map(x=>x.column),expected[weekday-1]);assert.deepEqual(slots.map(x=>x.time),weekday===7?['10:30','20:30']:['10:30','15:30','20:30']);
 }
 const now=new Date('2026-09-15T03:00:00Z');assert.equal(s.weeklyRhythm.generate(now).created,40);assert.equal(s.weeklyRhythm.generate(now).created,0);
 const changed=s.weeklyRhythm.put(id,{...rule,enabled:false});s.weeklyRhythm.seedNanyu();assert.deepEqual(s.weeklyRhythm.get(id),changed);assert.equal(s.get(old.id).notes,'保留原需求');
 }finally{s.close();}
});

test('点意新增6栏目并保留新品，每周14条、两周28条且不重置用户修改',()=>{
 const s=createStore(':memory:');try{
 const unit=s.getCatalog().units.find(u=>u.name==='点意')?.id||s.addConfiguration('units',{name:'点意',kind:'品牌'}).id;
 const id=s.getCatalog().accounts.find(a=>a.name==='点意dianyi')?.id||s.addConfiguration('accounts',{name:'点意dianyi',unitId:unit,columns:['点意新品']}).id;
 const old=s.save({account:id,column:'点意新品',pool:'candidate',contentStage:'request',notes:'保留原需求'});
 s.weeklyRhythm.seedDianyi();
 assert.ok(s.getCatalog().accounts.find(a=>a.id===id).columns.some(c=>c.name==='点意新品'));
 const rule=s.weeklyRhythm.get(id);assert.equal(rule.slots.length,14);
 const expected=[['点意选瓶建议','点意单品解析'],['点意空间搭配','点意插花参考'],['点意选瓶建议','点意单品解析'],['点意材质与细节','点意空间搭配'],['点意选瓶建议','点意礼赠与需求场景'],['点意插花参考','点意空间搭配'],['点意单品解析','点意选瓶建议']];
 for(let weekday=1;weekday<=7;weekday++){
 const slots=rule.slots.filter(x=>x.weekday===weekday);assert.deepEqual(slots.map(x=>x.column),expected[weekday-1]);assert.deepEqual(slots.map(x=>x.time),['12:30','20:30']);
 }
 const now=new Date('2026-09-15T03:00:00Z');assert.equal(s.weeklyRhythm.generate(now).created,28);assert.equal(s.weeklyRhythm.generate(now).created,0);
 const changed=s.weeklyRhythm.put(id,{...rule,enabled:false});s.weeklyRhythm.seedDianyi();assert.deepEqual(s.weeklyRhythm.get(id),changed);assert.equal(s.get(old.id).notes,'保留原需求');
 }finally{s.close();}
});
