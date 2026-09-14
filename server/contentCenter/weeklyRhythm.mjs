import {Solar} from 'lunar-javascript';
import {AppError} from './store.mjs';
export function createWeeklyRhythm(db,{getCatalog,list,save}){
 db.exec(`CREATE TABLE IF NOT EXISTS weekly_rhythms(account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS weekly_rhythm_occurrences(account_id TEXT NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL,note_id TEXT NOT NULL,PRIMARY KEY(account_id,date,time));`);
 const get=id=>{const r=db.prepare('SELECT * FROM weekly_rhythms WHERE account_id=?').get(id);return r?{accountId:id,revision:r.revision,...JSON.parse(r.body)}:{accountId:id,revision:0,enabled:false,slots:[]};};
 function put(id,input){
  const account=getCatalog().accounts.find(a=>a.id===id);
  if(!account||account.status==='inactive')throw new AppError('请选择有效账号');
  if(typeof input.enabled!=='boolean'||!Array.isArray(input.slots)||input.slots.length>140)throw new AppError('发布节奏格式不正确');
  const previous=get(id);
  const seen=new Set();
  const slots=input.slots.map(s=>{
   if(!Number.isInteger(s.weekday)||s.weekday<1||s.weekday>7||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)||!account.columns.some(c=>c.name===s.column))throw new AppError('请填写有效的星期、时间和本账号栏目');
   const key=s.weekday+'/'+s.time;if(seen.has(key))throw new AppError('同一账号同一时段只能设置一个栏目');seen.add(key);
   const role=s.role===undefined?(previous.slots.find(old=>old.weekday===s.weekday&&old.time===s.time&&old.column===s.column)?.role||''):s.role;
   if(typeof role!=='string'||role.length>1000)throw new AppError('内容角色请填写1000字以内的文字');
   return {weekday:s.weekday,time:s.time,column:s.column,...(role?{role}: {})};
  }).sort((a,b)=>a.weekday-b.weekday||a.time.localeCompare(b.time));
  return db.transaction(()=>{const old=get(id);const solarTerm=input.solarTerm===undefined?(old.solarTerm||null):input.solarTerm;
   if(solarTerm&&(!account.columns.some(c=>c.name===solarTerm.column)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(solarTerm.time)))throw new AppError('节气栏目或时间无效');
   if(input.revision!==old.revision)throw new AppError('节奏已更新，请重新打开后编辑',409);
   db.prepare('INSERT INTO weekly_rhythms VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(id,old.revision+1,JSON.stringify({enabled:input.enabled,slots,...(solarTerm?{solarTerm:{column:solarTerm.column,time:solarTerm.time}}:{})}));return get(id);
  })();
 }
 function seedAyYou(){
  const catalog=getCatalog();const accounts=catalog.accounts.filter(a=>a.name==='阿柚'&&catalog.units.find(u=>u.id===a.unitId)?.name==='半然');
  if(accounts.length!==1)return;
  const a=accounts[0];if(get(a.id).revision)return;
  const names=['阿柚选品笔记','半然收藏家','半然选择题','半然新品预告'];if(!names.every(n=>a.columns.some(c=>c.name===n)))return;
  const slots=[];
  for(let day=1;day<=7;day++){
   slots.push({weekday:day,time:'09:00',column:names[0]},{weekday:day,time:'12:30',column:names[day%2?1:2]},{weekday:day,time:'18:30',column:names[day===7?3:0]});
   if([1,3,5,6].includes(day))slots.push({weekday:day,time:'21:30',column:names[3]});
  }
  put(a.id,{revision:0,enabled:true,slots});
 }
 function seedXiaoMo(){
  const catalog=getCatalog();const accounts=catalog.accounts.filter(a=>a.name==='小茉'&&catalog.units.find(u=>u.id===a.unitId)?.name==='半然');
  if(accounts.length!==1)return;
  const a=accounts[0];if(get(a.id).revision)return;
  // Confirmed aliases: 一只花瓶的日常 → 半然使用说明书; 小茉使用日记 → 半然使用日记.
  const names=['半然插花日记','半然使用说明书','半然试花间','半然使用日记'];
  if(!names.every(n=>a.columns.some(c=>c.name===n)))return;
  const days=[[0,1,0,2],[1,0,1,null],[0,2,1,0],[1,0,2,null],[0,1,0,2],[0,1,3,2],[0,1,3,null]];
  const times=['09:00','12:30','18:30','21:30'];
  const slots=days.flatMap((row,index)=>row.flatMap((column,i)=>column===null?[]:[{weekday:index+1,time:times[i],column:names[column]}]));
  put(a.id,{revision:0,enabled:true,slots});
 }
 function seedBanran(){
  const catalog=getCatalog();const accounts=catalog.accounts.filter(a=>(a.name==='半然BANRAN'||a.fullName==='半然BANRAN')&&catalog.units.find(u=>u.id===a.unitId)?.name==='半然');
  if(accounts.length!==1)return;
  const a=accounts[0];if(get(a.id).revision)return;
  if(!['半然日志','半然上新','半然四季'].every(n=>a.columns.some(c=>c.name===n)))return;
  const slots=Array.from({length:7},(_,i)=>({weekday:i+1,time:[2,5].includes(i+1)?'11:30':i===6?'20:00':'20:30',column:[2,5].includes(i+1)?'半然上新':'半然日志'}));
  put(a.id,{revision:0,enabled:true,slots,solarTerm:{column:'半然四季',time:'08:00'}});
 }
 function seedHomeFragments(){
  const catalog=getCatalog();const accounts=catalog.accounts.filter(a=>a.name==='半然家的片段'&&catalog.units.find(u=>u.id===a.unitId)?.name==='半然');
  if(accounts.length!==1)return;
  const a=accounts[0];if(get(a.id).revision)return;
  if(!['半然家的片段','半然灵感','半然摆放手册'].every(n=>a.columns.some(c=>c.name===n)))return;
  const slots=[];
  for(let weekday=1;weekday<=7;weekday++){
   slots.push({weekday,time:'10:00',column:'半然家的片段',role:'轻场景、生活瞬间'});
   if([3,5].includes(weekday))slots.push({weekday,time:'17:00',column:'半然家的片段',role:'轻量加更、另一空间片段'});
   if(weekday===6)slots.push({weekday,time:'17:00',column:'半然摆放手册',role:'周末收藏型实用内容'});
   const practical=[2,4].includes(weekday);
   slots.push({weekday,time:'20:30',column:practical?'半然摆放手册':'半然灵感',role:practical?'实用摆放/尺寸/位置建议':weekday===7?'周末空间灵感':'完整空间搭配参考'});
  }
  put(a.id,{revision:0,enabled:true,slots});
 }
 function generate(now=new Date()){
  // Fixed business timezone; Sunday still targets the following Monday.
  const date=new Date(now.getTime()+8*3600000);date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()+7-((date.getUTCDay()+6)%7));
  return db.transaction(()=>{
   const notes=list();let created=0,existing=0;
   for(const r of db.prepare('SELECT account_id FROM weekly_rhythms').all()){
    const config=get(r.account_id),a=getCatalog().accounts.find(a=>a.id===r.account_id);if(!config.enabled||!a||a.status==='inactive')continue;
    for(let offset=0;offset<14;offset++){
     const d=new Date(date);d.setUTCDate(d.getUTCDate()+offset);const key=d.toISOString().slice(0,10);
     // Solar's calendar date and JieQi are defined in China standard time.
     const term=config.solarTerm?Solar.fromYmd(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()).getLunar().getJieQi():'';
     const slots=term?[config.solarTerm]:config.slots.filter(slot=>slot.weekday===offset%7+1);
     for(const slot of slots){
     if(!a.columns.some(c=>c.name===slot.column))continue;
     if(db.prepare('SELECT 1 FROM weekly_rhythm_occurrences WHERE account_id=? AND date=? AND time=?').get(a.id,key,slot.time)){existing++;continue;}
     const match=notes.find(n=>n.account===a.id&&(n.preferredDate||n.date)===key&&(n.preferredTime||n.time)===slot.time);
     const note=match||save({account:a.id,column:slot.column,pool:'candidate',contentStage:'request',noteFormat:'图文',preferredDate:key,preferredTime:slot.time,notes:term?`${term} · ${slot.column}`:(slot.role||''),title:'',requestKind:'bulk',generationStatus:'待生成'});
     db.prepare('INSERT INTO weekly_rhythm_occurrences VALUES (?,?,?,?)').run(a.id,key,slot.time,note.id);
     if(match)existing++;else{notes.push(note);created++;}
    }
   }
   }
   return {created,existing};
  })();
 }
 return {get,put,generate,seedAyYou,seedXiaoMo,seedBanran,seedHomeFragments};
}
