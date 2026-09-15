import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createStore } from '../../server/contentCenter/store.mjs';
import { createContentCenterIntegration, getContentActionProgress } from '../../server/contentCenterIntegration.js';
import { hasPermission, createEmptyPermissions } from '../../shared/permissions.js';
const ACTION='task-template-publish-content-note';
function setup() {
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE erp_skus(id TEXT,currentState TEXT); INSERT INTO erp_skus VALUES('sku-1','active');
 CREATE TABLE templates(id TEXT,tags TEXT); INSERT INTO templates VALUES('template-1','{"platform":["小红书"],"usage":["笔记"]}');
 CREATE TABLE publishing_accounts(id TEXT,name TEXT,platform TEXT,status TEXT); INSERT INTO publishing_accounts VALUES('account-1','同名账号','小红书','active');
 CREATE TABLE launched(id TEXT PRIMARY KEY,body TEXT);`);
 const state={goals:[{id:'goal-1',status:'active'}],taskTemplates:[{id:ACTION,status:'active',defaultProcessTemplateId:'flow-1'}],processTemplateNodes:[{id:'node-1',templateId:'flow-1',status:'active'}],processInstances:[],tasks:[],people:[]};
 const integration=createContentCenterIntegration({getDatabase:()=>db,readAllData:()=>({...state,processInstances:db.prepare('SELECT body FROM launched').all().map(row=>JSON.parse(row.body))}),filterDataByScope:(data,user)=>user.hidden?{...data,goals:[],processInstances:[]}:data,hasPermission,getUserPersonId:user=>user.id,listActionProductOptions:()=>({rows:[]}),resolveActionProductOptions:()=>[{id:'sku-1',name:'粉钿流线瓶',erpSkuCode:'HP0944-1'}],uploadsDir:'/tmp/content-center-test-unused',launchWorkPlanWithProcess:(id,payload)=>{db.prepare('INSERT INTO launched VALUES(?,?)').run(payload.processInstance.id,JSON.stringify(payload.processInstance));if(payload.workPlan.fail)throw new Error('simulated failure');return{instance:payload.processInstance,workPlan:payload.workPlan};}});
 const user={id:'admin-1',role:'admin'};
 const note={id:'note-1',revision:1,title:'策划',noteFormat:'图文',date:'2026-09-20',time:'10:30',publishingAccountId:'account-1',workstationProductIds:['sku-1'],images:[]};
 const input={revision:1,payload:{workPlan:{id:'wp-1',taskTemplateId:ACTION,goalId:'goal-1',customFields:{title:'策划',contentType:'图文笔记',publishDate:'2026-09-20T10:30',account:'account-1',linkedTemplateIds:['template-1']}},processInstance:{id:'action-1',taskTemplateId:ACTION,templateId:'flow-1',goalId:'goal-1',status:'pending'},tasks:[{id:'task-1',processNodeId:'node-1',processInstanceId:'action-1'}],productIds:['sku-1']}};
 return{db,integration,user,note,input};
}
test('策划关联保持独立身份、发起后持久记录来源，重试不重复创建',()=>{
 const{db,integration,user,note,input}=setup();
 const preview=integration.prefill(user,note);assert.equal(preview.customFields.publishDate,'2026-09-20T10:30');assert.equal(preview.customFields.account,'account-1');
 assert.equal(integration.launch(user,{},note,input).success,true);
 assert.equal(integration.launch(user,{},note,input).duplicate,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM launched').get().n,1);
 const action=JSON.parse(db.prepare('SELECT body FROM launched').get().body);assert.equal(action.customFields.account,'同名账号');assert.equal(action.customFields.publishingAccountId,'account-1');assert.equal(action.customFields.contentCenterSource.noteId,note.id);
 assert.equal(integration.progress(user,{...note,revision:2}).changedSinceLaunch,true);
 assert.equal(integration.progress({...user,hidden:true},note).restricted,true);db.close();
});
test('版本冲突、权限、错误目标和流程阻止发起，失败事务不留孤立行动',()=>{
 const{db,integration,user,note,input}=setup();
 assert.throws(()=>integration.launch(user,{},note,{...input,revision:0}),/已被修改/);
 assert.throws(()=>integration.launch({id:'n',role:'member',permissions:createEmptyPermissions()}, {},note,input),/权限/);
 assert.throws(()=>integration.launch({...user,hidden:true},{},note,input),/目标/);
 const wrong=structuredClone(input);wrong.payload.tasks=[];assert.throws(()=>integration.launch(user,{},note,wrong),/步骤/);
 const fail=structuredClone(input);fail.payload.workPlan.fail=true;assert.throws(()=>integration.launch(user,{},note,fail),/simulated failure/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM launched').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM content_center_action_links').get().n,0);db.close();
});
test('外部关联校验不会接受迁移产品UUID或非笔记模板',()=>{
 const{db,integration,user}=setup();
 assert.throws(()=>integration.validateReferences(user,{workstationProductIds:['legacy-migration-uuid']}),/产品/);
 assert.throws(()=>integration.validateReferences(user,{workstationTemplateId:'missing'}),/模板/);
 assert.throws(()=>integration.validateReferences(user,{publishingAccountId:'missing'}),/账号/);db.close();
});
test('已发布依赖发布任务的完成凭证，不把行动完成直接当作发布',()=>{
 assert.equal(getContentActionProgress({status:'done'},[]).published,false);
 const result=getContentActionProgress({status:'running'},[{name:'提取素材并发布',status:'done',submitLinks:['https://example.com/note'],submitFormData:{publishTime:'2026-09-20T10:30'}}]);
 assert.equal(result.published,true);assert.equal(result.publishUrl,'https://example.com/note');assert.equal(result.publishedAt,'2026-09-20T10:30');
 assert.equal(getContentActionProgress({status:'canceled'},[]).status,'已取消');
});
test('策划保存工作站关联，兼容历史编码，不混用本地产品ID和模板ID',()=>{
 const store=createStore(':memory:');const note=store.save({pool:'candidate',title:'选题',productCodes:'旧编码',workstationProductIds:['sku-1'],workstationTemplateId:'template-1',publishingAccountId:'account-1'});
 assert.deepEqual(store.get(note.id).workstationProductIds,['sku-1']);assert.equal(store.get(note.id).workstationTemplateId,'template-1');assert.equal(store.get(note.id).templateId,'');assert.equal(store.get(note.id).productCodes,'旧编码');assert.throws(()=>store.save({pool:'candidate',title:'日期',preferredDate:'2026-02-30'}),/日期/);assert.throws(()=>store.save({pool:'candidate',title:'时间',preferredTime:'25:99'}),/时间/);store.close();
});

test('发起预填包含笔记正文、话题、产品文字和素材说明',()=>{
 const {db,integration,user,note}=setup();
 const fields=integration.prefill(user,{...note,copyText:'正文内容',hashtags:'#花瓶',notes:'需求说明',imageScript:'封面构图',materialNeeds:'产品照片'}).customFields;
 assert.equal(fields.title,'策划');
 assert.equal(fields.contentText,'正文内容');
 assert.equal(fields.hashtags,'#花瓶');
 assert.equal(fields.productName,'粉钿流线瓶 · HP0944-1');
 assert.equal(fields.remark,'需求说明\n\n画面脚本：\n封面构图\n\n素材需求：\n产品照片');
 db.close();
});
