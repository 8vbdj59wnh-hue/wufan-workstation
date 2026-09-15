import { buildContentActionCalendar } from './contentCenterCalendar.js';
import { AppError, contentStageOf } from './contentCenter/store.mjs';
import { canLaunchActionTemplate, canAccessTemplateCenter } from '../shared/permissions.js';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const ACTION = 'task-template-publish-content-note';
const parse = (value, fallback = {}) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
export function ensureContentActionSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS content_center_action_links (
    noteId TEXT PRIMARY KEY, revision INTEGER NOT NULL, actionId TEXT NOT NULL UNIQUE,
    workPlanId TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL
  )`);
}
export function isContentNoteTemplate(template) {
  const tags = parse(template?.tags);
  return tags.platform?.includes('小红书') && tags.usage?.includes('笔记');
}
export function getContentActionProgress(instance, tasks = []) {
  if (['stopped', 'canceled'].includes(instance.status)) return { status: '已取消', published: false };
  const publishTask = tasks.find(task => /发布/.test(task.name || '') && ['done', 'completed'].includes(task.status) && parse(task.submitLinks, []).length);
  const links = parse(publishTask?.submitLinks, []);
  const result = links.map(link => typeof link === 'string' ? link : link.url || link.href || link.link).find(url => /^https?:\/\//i.test(url || '')) || '';
  const current = tasks.find(task => !['done', 'completed', 'canceled', 'waiting'].includes(task.status));
  return { status: result ? '已发布' : instance.status === 'done' ? '行动完成·待核对发布凭证' : current?.status === 'pending_acceptance' || /审核/.test(current?.name || '') ? '待审核' : /发布/.test(current?.name || '') ? '待发布' : current ? '执行中' : '待开始',
    published: Boolean(result), publishUrl: result, publishedAt: parse(publishTask?.submitFormData).publishTime || publishTask?.completedAt || '', currentTask: current?.name || '', executorId: current?.executorId || '' };
}
export function createContentCenterIntegration(deps) {
  const { getDatabase, readAllData, filterDataByScope, hasPermission, launchWorkPlanWithProcess, getUserPersonId, listActionProductOptions, resolveActionProductOptions, uploadsDir } = deps;
  const database = () => { const db = getDatabase(); ensureContentActionSchema(db); return db; };
  function refs(user, note = {}) {
    const db = getDatabase();
    const templates = canAccessTemplateCenter(user) ? db.prepare('SELECT * FROM templates').all().map(t => ({ ...t, tags: parse(t.tags), previewImage: parse(t.previewImage), sourceFile: parse(t.sourceFile) })).filter(isContentNoteTemplate) : [];
    const productOptions = hasPermission(user, 'products.view') ? resolveActionProductOptions((note.workstationProductIds || []).map(erpSkuId => ({ erpSkuId }))) : [];
    return { templates, productOptions, publishingAccounts: db.prepare("SELECT id,name,platform,status FROM publishing_accounts WHERE status='active' ORDER BY name,id").all(), canUseTemplates: canAccessTemplateCenter(user), canLaunch: hasPermission(user, 'contentCenter.manage') && canLaunchActionTemplate(user, ACTION) && hasPermission(user, 'goals.view') };
  }
  function validateReferences(user, input, previous = {}) {
    const db = getDatabase();
    if (Object.hasOwn(input, 'workstationProductIds') && JSON.stringify(input.workstationProductIds) !== JSON.stringify(previous.workstationProductIds || [])) {
      if (!hasPermission(user, 'products.view')) throw new AppError('没有产品查看权限，不能修改产品关联', 403);
      if (!Array.isArray(input.workstationProductIds) || input.workstationProductIds.length > 100 || input.workstationProductIds.some(id => typeof id !== 'string' || !db.prepare("SELECT id FROM erp_skus WHERE id=? AND currentState='active'").get(id))) throw new AppError('关联产品不存在或已停用，请重新选择产品中心的产品');
    }
    if (Object.hasOwn(input, 'workstationTemplateId') && input.workstationTemplateId !== (previous.workstationTemplateId || '')) {
      if (!canAccessTemplateCenter(user)) throw new AppError('没有模板查看权限', 403);
      if (input.workstationTemplateId && !isContentNoteTemplate(db.prepare('SELECT * FROM templates WHERE id=?').get(input.workstationTemplateId))) throw new AppError('请选择模板中心的小红书笔记模板');
    }
    if (input.publishingAccountId && input.publishingAccountId !== previous.publishingAccountId && !db.prepare("SELECT id FROM publishing_accounts WHERE id=? AND status='active'").get(input.publishingAccountId)) throw new AppError('发布账号不存在或已停用');
  }
  function progress(user, note) {
    const link = database().prepare('SELECT * FROM content_center_action_links WHERE noteId=?').get(note.id);
    if (!link) return { linked: false };
    if (!hasPermission(user, 'keyActions.view')) return { linked: true, restricted: true, status: '已关联行动·无查看权限' };
    const scoped = filterDataByScope(readAllData(), user);
    const instance = scoped.processInstances.find(item => item.id === link.actionId);
    if (!instance) return { linked: true, restricted: true, status: '已关联行动·不在可见范围' };
    const tasks = scoped.tasks.filter(task => task.processInstanceId === instance.id);
    const details = getContentActionProgress(instance, tasks);
    return { linked: true, actionId: instance.id, businessCode: instance.businessCode, revision: link.revision, changedSinceLaunch: note.revision !== link.revision, ...details,
      executorName: (scoped.people || []).find(person => person.id === details.executorId)?.name || '', dueDate: instance.dueDate || '', taskCount: tasks.length, completedTasks: tasks.filter(t => t.status === 'done').length };
  }
  function calendar(user,store){
    if(!hasPermission(user,'keyActions.view'))return {items:[],restricted:true};
    const scoped=filterDataByScope(readAllData(),user);
    const links=database().prepare('SELECT noteId,actionId FROM content_center_action_links').all();
    const items=buildContentActionCalendar(scoped,store.getCatalog(),store.list(),links);
    for(const item of items){const instance=scoped.processInstances.find(a=>a.id===item.actionId);const tasks=(scoped.tasks||[]).filter(t=>t.processInstanceId===item.actionId);item.actionStatus=getContentActionProgress(instance,tasks).status;}
    return {items};
  }
  function prefill(user, note) {
    if (!canLaunchActionTemplate(user, ACTION) || !hasPermission(user, 'goals.view')) throw new AppError('需要发布内容笔记发起权限和目标查看权限', 403);
    const existing = progress(user, note);
    if (existing.linked) return { existing };
    if (note.pool==='candidate' && contentStageOf(note)==='request') throw new AppError('请先补齐完整内容并存入内容候选，再发起发布行动');
    const options = refs(user, note);
    const account = options.publishingAccounts.find(a => a.id === note.publishingAccountId);
    // The native launch form lets the user select an account before submission.
    if (!note.title || !note.noteFormat || !(note.date || note.preferredDate) || !(note.time || note.preferredTime)) throw new AppError('请先补齐标题、笔记形式和计划发布时间');
    return { taskTemplateId: ACTION, launchImmediately: true, title: '从内容策划发起发布行动', actionTitle: note.title,
      description: note.notes || '', contentCenterSource: { noteId: note.id, revision: note.revision },
      productIds: note.workstationProductIds || [], productOptions: options.productOptions, linkedTemplateId: note.workstationTemplateId || '',
      customFields: { productName: options.productOptions.map(p => [p.name || p.erpSkuName || '', p.erpSkuCode || p.skuCode || ''].filter(Boolean).join(' · ')).filter(Boolean).join('、'), remark: [note.notes, note.imageScript ? '画面脚本：\n' + note.imageScript : '', note.materialNeeds ? '素材需求：\n' + note.materialNeeds : ''].filter(Boolean).join('\n\n'), title: note.title, contentText: note.copyText || '', hashtags: note.hashtags || '', contentType: note.noteFormat === '视频' ? '视频笔记' : '图文笔记', publishDate: `${note.date || note.preferredDate}T${note.time || note.preferredTime}`, account: account?.id || '', publishingAccountId: account?.id || '', contentCenterBrandId: note.unitId, contentCenterColumn: note.column } };
  }
  function launch(user, store, note, input) {
    if (!hasPermission(user, 'contentCenter.manage') || !canLaunchActionTemplate(user, ACTION)) throw new AppError('没有发起权限', 403);
    const db = database();
    const existing = db.prepare('SELECT * FROM content_center_action_links WHERE noteId=?').get(note.id);
    if (existing) return { success: true, duplicate: true, progress: progress(user, note) };
    if (input.revision !== note.revision) throw new AppError('策划笔记已被修改，请返回内容中心重新预览', 409);
    if (note.pool==='candidate' && contentStageOf(note)==='request') throw new AppError('请先补齐完整内容并存入内容候选，再发起发布行动');
    const payload = input.payload;
    const workPlan = payload?.workPlan;
    if (!workPlan || workPlan.taskTemplateId !== ACTION || payload.processInstance?.taskTemplateId !== ACTION) throw new AppError('只能发起发布内容笔记行动');
    const raw = readAllData(); const scoped = filterDataByScope(raw, user);
    if (!hasPermission(user, 'goals.view') || !scoped.goals.some(goal => goal.id === workPlan.goalId && !['inactive','closed'].includes(goal.status))) throw new AppError('目标不存在、已停用或无权访问', 403);
    const standard = raw.taskTemplates.find(t => t.id === ACTION && t.status === 'active');
    if (!standard || payload.processInstance.templateId !== standard.defaultProcessTemplateId || payload.processInstance.goalId !== workPlan.goalId) throw new AppError('行动标准或目标不一致');
    const nodes = raw.processTemplateNodes.filter(n => n.templateId === standard.defaultProcessTemplateId && n.status === 'active');
    if (!nodes.length) throw new AppError('发布内容笔记尚未配置启用的流程步骤，请先完成行动标准配置');
    if (!Array.isArray(payload.tasks) || payload.tasks.length !== nodes.length || new Set(payload.tasks.map(t=>t.processNodeId)).size !== nodes.length || payload.tasks.some(t => !nodes.some(n=>n.id===t.processNodeId))) throw new AppError('流程步骤已变化，请重新发起');
    const fields = workPlan.customFields || {};
    const linkedTemplateIds = fields.linkedTemplateIds || [];
    if (!Array.isArray(linkedTemplateIds) || linkedTemplateIds.length > 1) throw new AppError('最多关联一个模板');
    validateReferences(user, { workstationProductIds: payload.productIds || [], workstationTemplateId: linkedTemplateIds[0] || '', publishingAccountId: fields.account });
    if (!db.prepare("SELECT id FROM publishing_accounts WHERE id=? AND status='active'").get(fields.account)) throw new AppError('请选择有效工作站发布账号');
    if (!fields.title || !['图文笔记','视频笔记'].includes(fields.contentType) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fields.publishDate || '')) throw new AppError('请补齐标题、笔记形式和计划发布时间');
    const createdFiles = [];
    let committed = false;
    try {
      const attachments = [...(fields.standardWorkAttachments || [])];
      if (note.images?.length && !hasPermission(user, 'uploads.upload')) throw new AppError('携带参考图发起需要上传附件权限', 403);
      for (const id of note.images || []) {
        const image = store.getImage(id); if (!image) throw new AppError('参考图丢失，请返回内容中心检查');
        const ext = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif' }[image.mime];
        if (!ext) throw new AppError('参考图格式不支持');
        const name = createHash('sha256').update(image.bytes).digest('hex') + '.' + ext;
        const dir = path.join(uploadsDir, 'content-center'); mkdirSync(dir, { recursive: true }); const file = path.join(dir, name);
        if (!existsSync(file)) { writeFileSync(file, image.bytes, { flag:'wx' }); createdFiles.push(file); }
        attachments.push({ originalName: image.name, filePath: '/uploads/content-center/'+name, url:'/uploads/content-center/'+name, mimeType:image.mime, ext, uploadedAt:new Date().toISOString() });
      }
      const source = { noteId:note.id, revision:note.revision, brandId:note.unitId, accountId:note.account, column:note.column };
      const publishingAccount = db.prepare("SELECT * FROM publishing_accounts WHERE id=?").get(fields.account);
      const customFields = { ...fields, account: publishingAccount.name, publishingAccountId: publishingAccount.id, contentCenterSource: source, standardWorkAttachments:attachments };
      db.transaction(() => {
        const result = launchWorkPlanWithProcess(workPlan.id, { ...payload, workPlan:{...workPlan,customFields}, processInstance:{...payload.processInstance,customFields}, initiatorId:getUserPersonId(user) });
        db.prepare('INSERT INTO content_center_action_links VALUES (?,?,?,?,?,?,?)').run(note.id,note.revision,result.instance.id,result.workPlan.id,JSON.stringify(note),getUserPersonId(user),new Date().toISOString());
      })();
      committed = true;
      return { success:true, progress:progress(user,note) };
    } catch (error) { if (!committed) for (const file of createdFiles) unlinkSync(file); throw error; }
  }
  return { selectionProducts: ids => resolveActionProductOptions(ids.map(erpSkuId=>({erpSkuId}))), refs, validateReferences, progress, prefill, launch, calendar, productOptions: query => listActionProductOptions(query) };
}
