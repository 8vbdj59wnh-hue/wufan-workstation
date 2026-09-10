import {getEffectivePublishTime} from '../src/data/contentPublishTime.js';
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value||{};}catch{return {};}};
// Build calendar projections without creating or modifying content records.
export function buildContentActionCalendar(data,catalog,notes=[],links=[]){
 const templates=new Map((data.taskTemplates||[]).map(t=>[t.id,t]));
 const plans=new Map((data.workPlans||[]).map(p=>[p.processInstanceId,p]));
 const sourceLinks=new Map(links.map(l=>[l.actionId,l.noteId]));
 const noteMap=new Map(notes.map(n=>[n.id,n]));
 return (data.processInstances||[]).filter(a=>!['done','completed','stopped','canceled','cancelled'].includes(a.status)&&
  (a.taskTemplateId==='task-template-publish-content-note'||templates.get(a.taskTemplateId)?.name==='发布内容笔记')).flatMap(a=>{
   const plan=plans.get(a.id),fields={...parse(plan?.customFields),...parse(a.customFields)};
   const when=String(getEffectivePublishTime(fields,a.dueDate||plan?.dueDate||'')||'');
   // Preserve business wall-clock dates; old date-only schedules remain visible in the pending-time area.
   const match=when.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]([01]\d|2[0-3]):([0-5]\d))?(?:$|:|\.)/);
   if(!match||!Number.isFinite(Date.parse(match[1]))||new Date(match[1]).toISOString().slice(0,10)!==match[1])return [];
   const sourceId=sourceLinks.get(a.id)||fields.contentCenterSource?.noteId||'',source=noteMap.get(sourceId);
   const publishing=(data.publishingAccounts||[]).find(p=>p.id===fields.publishingAccountId||p.id===fields.account);
   const accountName=publishing?.name||String(fields.account||'未指定发布账号');
   const matches=(catalog.accounts||[]).filter(p=>p.name===accountName);
   const contentAccount=(catalog.accounts||[]).find(p=>p.id===source?.account)||(matches.length===1?matches[0]:null);
   return [{id:'action:'+a.id,actionId:a.id,sourceNoteId:sourceId,pool:'schedule',isAction:true,
    account:contentAccount?.id||'action-account:'+(publishing?.id||accountName),accountName:contentAccount?.name||accountName,
    unitId:contentAccount?.unitId||source?.unitId||'',column:source?.column||'',title:fields.title||a.displayTitle||a.name||plan?.title||'发布内容笔记',
    date:match[1],time:match[2]?match[2]+':'+match[3]:'',noteFormat:fields.contentType==='视频笔记'?'视频':'图文',status:'已排期',
    businessCode:a.businessCode||'',actionStatus:'进行中',updatedAt:a.updatedAt||a.createdAt||'',images:[]}];
 });
}
