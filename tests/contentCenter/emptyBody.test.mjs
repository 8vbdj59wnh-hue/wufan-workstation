import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createStore,contentStageOf} from '../../server/contentCenter/store.mjs';
import {saveContentRequestPlans,reviseContentRequestCopy,reviseContentRequestTopics} from '../../server/contentCenterRouter.js';
import {isContentNoteBodyField,mapContentNotePrefill} from '../../src/contentNotePrefill.js';
const integration={progress:()=>({linked:false})},user={id:'planner'};
function setup(t){const dir=mkdtempSync(join(tmpdir(),'empty-body-')),file=join(dir,'content.sqlite');let store=createStore(file);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return {get store(){return store},reopen(){store.close();store=createStore(file)}};}
function request(s){const a=s.getCatalog().accounts[0];return s.createRequests([{account:a.id,column:a.columns[0].name,notes:'需求',noteFormat:'图文',preferredDate:'2026-09-21',preferredTime:'10:30',workstationProductIds:['product-1']}])[0];}
const item=(n,copyText='')=>({id:n.id,revision:n.revision,title:'新标题',copyText});
function plan(s,n,copyText=''){return saveContentRequestPlans(s,integration,user,{idempotencyKey:'initial-'+n.id,items:[{...item(n,copyText),hashtags:'#花瓶',imageScript:'画面',materialNeeds:'素材'}]}).items[0];}
function unchanged(a,b,allowed){for(const k of Object.keys(a).filter(k=>!allowed.includes(k)))assert.deepEqual(b[k],a[k],k);}
test('首次无正文策划持久化、保留候选状态，继续修订标题话题并可进入排期',t=>{
 const env=setup(t),n=request(env.store),p=plan(env.store,n);assert.equal(p.copyText,'');assert.equal(contentStageOf(p),'candidate');env.reopen();assert.equal(env.store.get(p.id).copyText,'');assert.equal(env.store.rawNotes().find(v=>v.id===p.id).copyText,'');
 const revised=reviseContentRequestCopy(env.store,integration,user,{idempotencyKey:'empty-revise-title',items:[{...item(p),title:'再改标题'}]}).items[0];
 const tagged=reviseContentRequestTopics(env.store,integration,user,{idempotencyKey:'empty-revise-topic',items:[{id:p.id,revision:revised.revision,hashtags:'#美物'}]}).items[0];assert.equal(tagged.copyText,'');assert.equal(tagged.title,'再改标题');
 const scheduled=env.store.save({revision:tagged.revision,pool:'schedule',generationStatus:'已生成'},p.id);assert.equal(scheduled.copyText,'');assert.equal(scheduled.date,'2026-09-21');
});
test('25篇混合修订16空9短：清空旧正文、非目标字段保留、审计、原子幂等',t=>{
 const {store:s}=setup(t),before=Array.from({length:25},()=>plan(s,request(s),'原长正文'.repeat(100)));
 const payload={idempotencyKey:'mixed-25-empty-short',items:before.map((n,i)=>item(n,i<16?'':'短正文'))};
 const out=reviseContentRequestCopy(s,integration,user,payload);assert.equal(out.items.length,25);
 for(let i=0;i<25;i++){const saved=s.get(before[i].id);assert.equal(saved.copyText,i<16?'':'短正文');assert.equal(saved.title,'新标题');unchanged(before[i],saved,['title','copyText','revision','updatedAt']);assert.equal(out.items[i].copyRevisionAudit.previous.copyText,before[i].copyText);assert.equal(out.items[i].copyRevisionAudit.updated.copyText,saved.copyText);}
 const retry=reviseContentRequestCopy(s,integration,user,payload);assert.equal(retry.duplicate,true);assert.deepEqual(retry.items,out.items);assert.equal(s.get(before[0].id).revision,before[0].revision+1);
 assert.throws(()=>reviseContentRequestCopy(s,integration,user,{...payload,items:[item(before[0],'不同正文')]}),e=>e.status===409);
});
test('两个接口均拒绝缺失、null、非字符串、空白、空标题及超长正文，整批无写入',t=>{
 const {store:s}=setup(t);
 for(const fn of [saveContentRequestPlans,reviseContentRequestCopy]){
  const make=()=>fn===saveContentRequestPlans?request(s):plan(s,request(s),'旧正文');
  const a=make(),b=make();let key=0;
  for(const value of [undefined,null,12,{},[],true,' ','\n\t','x'.repeat(20001)]){
   const bad=item(b,value);if(value===undefined)delete bad.copyText;
   assert.throws(()=>fn(s,integration,user,{idempotencyKey:'invalid-'+fn.name+'-'+key++,items:[item(a),bad]}));assert.deepEqual(s.get(a.id),a);assert.deepEqual(s.get(b.id),b);
  }
  for(const title of ['', ' \n'])assert.throws(()=>fn(s,integration,user,{idempotencyKey:'title-'+fn.name+'-'+key++,items:[{...item(a),title}]}),/标题/);
  assert.throws(()=>fn(s,integration,user,{idempotencyKey:'white-'+fn.name,items:[item(a,'\n ')]}),/明确传入空字符串/);
  assert.throws(()=>fn(s,integration,user,{idempotencyKey:'stale-'+fn.name,items:[item(a),{...item(b),revision:99}]}),/版本/);assert.deepEqual(s.get(a.id),a);
  assert.throws(()=>fn(s,{progress:(_,n)=>({linked:n.id===b.id})},user,{idempotencyKey:'linked-'+fn.name,items:[item(a),item(b)]}),/关联行动/);assert.deepEqual(s.get(a.id),a);
  assert.throws(()=>fn(s,{progress:(_,n)=>{if(n.id===b.id)throw Object.assign(Error('无权限'),{status:403});return {linked:false}}},user,{idempotencyKey:'scope-'+fn.name,items:[item(a),item(b)]}),/权限/);assert.deepEqual(s.get(a.id),a);
  assert.throws(()=>fn(s,integration,user,{idempotencyKey:'extra-'+fn.name,items:[{...item(a),notes:'覆盖'}]}),/仅允许/);
 }
});
test('前端区分尚未填写和明确无正文，历史未完成记录不自动晋级',()=>{
 const source=readFileSync(new URL('../../public/content-center/requests.js',import.meta.url),'utf8');const start=source.indexOf('function requestPlanningReady('),end=source.indexOf('function requestProductTiles',start);const c=vm.createContext({contentStageOf});vm.runInContext(source.slice(start,end),c);
 const blank={title:'标题',copyText:'',contentStage:'request',noteFormat:'图文'};
 assert.equal(c.requestPlanningReady(blank,{}),false);assert.equal(c.requestPlanningReady(blank,{copyText:''}),true);assert.equal(c.requestPlanningReady({...blank,contentStage:'candidate'},{}),true);assert.equal(c.requestPlanningReady(blank,{copyText:' \n'}),false);assert.equal(contentStageOf({title:'旧标题',copyText:'',noteFormat:'图文'}),'request');
 assert.match(source,/已选择不设正文/);assert.match(source,/正文尚未填写/);
 const fields=[{key:'dynamic-body',label:'内容文案',required:true},{key:'title',label:'标题',required:true},{key:'images',label:'图片',required:true},{key:'account',label:'账号',required:true}];
 assert.deepEqual(fields.map(isContentNoteBodyField),[true,false,false,false]);assert.equal(mapContentNotePrefill(fields,{contentText:''})['dynamic-body'],'');
});

test('发布笔记字段放行空正文，但其他模板及标题账号图片必填保持',()=>{
 const source=readFileSync(new URL('../../server/keyActionLaunchService.js',import.meta.url),'utf8');
 const start=source.indexOf('function readFormFields('),end=source.indexOf('\nfunction isEmpty',start);
 const fields=[{key:'body-id',label:'内容文案',required:true},{key:'title',label:'标题',required:true},{key:'account',label:'账号',required:true},{key:'image',label:'图片',required:true}];
 const c=vm.createContext({isContentNoteBodyField,parseJson:JSON.parse,normalizeField:x=>x});vm.runInContext(source.slice(start,end),c);
 const db={prepare:()=>({get:()=>({formSchema:JSON.stringify({fields})})})};
 const actual=c.readFormFields(db,{id:'task-template-publish-content-note'});assert.deepEqual(Array.from(actual,f=>f.required),[false,true,true,true]);
 assert.deepEqual(Array.from(c.readFormFields(db,{id:'other-template'}),f=>f.required),[true,true,true,true]);
});

test('历史隐式候选清空正文后持久记录已有候选状态，空白需求不会自动晋级',t=>{
 const {store:s}=setup(t),n=request(s);
 const legacy=s.save({revision:n.revision,title:'旧标题',copyText:'旧正文',hashtags:'#旧话题',generationStatus:'已生成'},n.id);
 assert.equal(legacy.contentStage,'');assert.equal(contentStageOf(legacy),'candidate');
 const saved=reviseContentRequestCopy(s,integration,user,{idempotencyKey:'legacy-clear-body',items:[item(legacy)]}).items[0];
 assert.equal(saved.contentStage,'candidate');assert.equal(saved.copyText,'');
 assert.equal(reviseContentRequestTopics(s,integration,user,{idempotencyKey:'legacy-empty-topics',items:[{id:saved.id,revision:saved.revision,hashtags:'#新话题'}]}).items[0].copyText,'');
});
