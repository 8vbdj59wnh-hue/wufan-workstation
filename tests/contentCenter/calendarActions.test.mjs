import test from 'node:test';import assert from 'node:assert/strict';
import {buildContentActionCalendar} from '../../server/contentCenterCalendar.js';
const template='task-template-publish-content-note';
const action=(id,extra={})=>({id,taskTemplateId:template,status:'running',customFields:{publishDate:'2026-09-20T10:30',account:'小茉',title:'内容'},...extra});
test('汇集所有入口的未完成发布行动，排除完成取消及无排期行动',()=>{
 const data={processInstances:[action('outside'),action('done',{status:'done'}),action('stopped',{status:'stopped'}),action('cancel',{status:'canceled'}),action('other',{taskTemplateId:'other'}),action('no-date',{customFields:{}}),action('renamed',{taskTemplateId:'custom-standard'})],taskTemplates:[{id:'custom-standard',name:'发布内容笔记'}]};
 const result=buildContentActionCalendar(data,{accounts:[]});assert.deepEqual(result.map(n=>n.actionId),['outside','renamed']);assert.equal(result[0].time,'10:30');
});
test('读取工作计划和跟随截止时间模式，日期未定小时仍保留',()=>{
 const data={processInstances:[action('deadline',{customFields:{publishTimeMode:'deadline',publishDate:'2026-01-01'},dueDate:'2026-09-22T18:00'}),action('plan',{customFields:{}}),action('date-only',{customFields:{publishDate:'2026-09-23'}})],workPlans:[{processInstanceId:'plan',customFields:{publishDate:'2026-09-24T08:45'}}]};
 const r=buildContentActionCalendar(data,{accounts:[]});assert.equal(r[0].date,'2026-09-22');assert.equal(r[0].time,'18:00');assert.equal(r[1].time,'08:45');assert.equal(r[2].time,'');
});
test('来源ID用于日历去重，账号身份优先沿用策划关联；拒绝非法日期',()=>{
 const notes=[{id:'source',account:'content-account',column:'固定栏目',unitId:'brand'}];const catalog={accounts:[{id:'content-account',name:'策划账号',unitId:'brand'}]};
 const rows=buildContentActionCalendar({processInstances:[action('linked'),action('bad',{customFields:{publishDate:'2026-02-30'}})]},catalog,notes,[{noteId:'source',actionId:'linked'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].sourceNoteId,'source');assert.equal(rows[0].account,'content-account');assert.equal(rows[0].column,'固定栏目');
});
