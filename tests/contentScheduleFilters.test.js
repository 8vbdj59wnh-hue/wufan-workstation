import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/scheduleBoardPage.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function contentRowFields'),source.indexOf('function isImprovementActionRow'));
test('内容排期按账号、栏目、形式和排期筛选，通用行动不受影响',()=>{
 const context=vm.createContext({contentSchedulePublishingAccounts:[],contentScheduleCatalog:{accounts:[],columns:[]},state:{publishingAccounts:[{id:'a',name:'半然'}]},filters:{scope:'all',initiatorId:'',status:'',overdue:''},hiddenProcessStatuses:new Set(['done']),publishContentNoteTemplateId:'publish',isContentScheduleRoute:()=>true,getActionIdentifierSearchTarget:()=>null,rowMatchesBaseFilters:()=>true,rowMatchesQuickFilter:()=>true,isNoDueDate:r=>!r.dueDate});
 vm.runInContext(code,context);
 const row={workPlan:{taskTemplateId:'publish',customFields:{publishingAccountId:'a',contentType:'图文笔记',contentCenterColumn:'半然日志'}},processInstance:{status:'running'},dueDate:'2026-09-15'};
 assert.equal(context.launchedRowMatchesFilters(row),true);
 for(const [key,value] of [['contentAccount','其他'],['contentColumn','其他'],['contentFormat','视频笔记'],['contentSchedule','unscheduled']]){
  context.filters[key]=value;assert.equal(context.launchedRowMatchesFilters(row),false);context.filters[key]='';
 }
 context.filters.contentAccount='a';context.filters.contentSchedule='scheduled';assert.equal(context.launchedRowMatchesFilters(row),true);
 assert.equal(context.launchedRowMatchesFilters({...row,processInstance:{status:'done'}}),false);
 context.contentScheduleCatalog.accounts=[{id:'content-a',name:'阿柚',publishingAccountId:'a'}];
 const sourced={...row,processInstance:{status:'running',customFields:{contentCenterSource:{accountId:'content-a'}}}};
 context.filters.contentAccount='a';assert.equal(context.launchedRowMatchesFilters(sourced),true);

 context.isContentScheduleRoute=()=>false;context.filters.contentAccount='其他';assert.equal(context.launchedRowMatchesFilters(row),true);
});
