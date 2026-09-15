import express from 'express';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createStore, statuses, priorities, copyStatuses, AppError } from './contentCenter/store.mjs';

export function matchContentProductCodes(database, input) {
  const codes = [...new Set(String(input ?? '').split(/[、，,\n]+/).map(code => code.trim()).filter(Boolean))];
  if (codes.length > 100 || codes.some(code => code.length > 200)) throw new AppError('每次最多查询 100 个货品编码，每个最多 200 字');
  return codes.map(code => {
    const matches = database.prepare('SELECT id, goodsCode, goodsName, currentState FROM erp_goods WHERE goodsCode = ? COLLATE BINARY').all(code);
    return { code, status: matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'unknown', matches };
  });
}

function cleanPlanningText(value, label, maximum = 200) {
  const text = String(value ?? '').trim();
  if (text.length > maximum) throw new AppError(`${label}过长`);
  return text;
}

function cleanPlanningDate(value, label) {
  const text = cleanPlanningText(value, label, 10);
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) throw new AppError(`${label}必须使用 YYYY-MM-DD`);
  return text;
}

function resolvePlanningBrand(store, identifier) {
  const value = cleanPlanningText(identifier, '品牌', 120);
  if (!value) throw new AppError('请提供品牌ID或精确名称');
  const brands = store.getCatalog().units.filter(unit => unit.kind === '品牌' && (unit.id === value || unit.name === value));
  if (brands.length !== 1) throw new AppError(brands.length ? '品牌名称不唯一，请使用品牌ID' : '未找到品牌', 404);
  return brands[0];
}

export function getContentPlanningProductSelection(store, integration, brandIdentifier) {
  const brand = resolvePlanningBrand(store, brandIdentifier);
  const catalog = store.getCatalog();
  const selection = store.productSelection.get(brand.id);
  const ids = [...new Set(Object.values(selection.groups).flat().map(item => item.productId))];
  return {
    brand,
    accounts: catalog.accounts
      .filter(account => account.unitId === brand.id && account.status !== 'inactive')
      .map(account => ({ id: account.id, name: account.name, fullName: account.fullName, columns: account.columns.map(column => column.name) })),
    ...selection,
    products: integration?.selectionProducts(ids) || [],
  };
}

export function listContentPlanningSchedule(store, query = {}) {
  const startDate = cleanPlanningDate(query.startDate, '开始日期');
  const endDate = cleanPlanningDate(query.endDate, '结束日期');
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (end < start || end - start >= 62 * 24 * 60 * 60 * 1000) throw new AppError('排期查询范围必须是 1–62 个自然日');
  const brandId = cleanPlanningText(query.brandId, '品牌ID', 120);
  const accountId = cleanPlanningText(query.accountId, '账号ID', 120);
  const column = cleanPlanningText(query.column, '栏目', 120);
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(query.pageSize) || 50)));
  const catalog = store.getCatalog();
  if (brandId && !catalog.units.some(unit => unit.id === brandId && unit.kind === '品牌')) throw new AppError('品牌不存在', 404);
  if (accountId && !catalog.accounts.some(account => account.id === accountId)) throw new AppError('账号不存在', 404);
  const rows = store.list()
    .map(item => ({
      ...item,
      planningBrandId: item.unitId || catalog.accounts.find(account => account.id === item.account)?.unitId || '',
      planningDate: item.date || item.preferredDate || '',
      planningTime: item.time || item.preferredTime || '',
    }))
    .filter(item => item.planningDate >= startDate && item.planningDate <= endDate)
    .filter(item => !brandId || item.planningBrandId === brandId)
    .filter(item => !accountId || item.account === accountId)
    .filter(item => !column || item.column === column)
    .sort((left, right) => left.planningDate.localeCompare(right.planningDate) || left.planningTime.localeCompare(right.planningTime) || left.column.localeCompare(right.column));
  const offset = (page - 1) * pageSize;
  return { items: rows.slice(offset, offset + pageSize), total: rows.length, page, pageSize, startDate, endDate };
}

function normalizeContentPlanningRequests(store, integration, user, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['idempotencyKey', 'items'].includes(key))) {
    throw new AppError('下周需求批次格式不正确');
  }
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw new AppError('请一次提交 1–100 条下周需求');
  const catalog = store.getCatalog();
  const normalized = input.items.map((item, index) => {
    const allowed = ['accountId', 'column', 'workstationProductIds', 'noteFormat', 'preferredDate', 'preferredTime', 'notes'];
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !allowed.includes(key))) throw new AppError(`第 ${index + 1} 条需求字段不正确`);
    const accountId = cleanPlanningText(item.accountId, `第 ${index + 1} 条账号`, 120);
    const column = cleanPlanningText(item.column, `第 ${index + 1} 条栏目`, 120);
    const notes = cleanPlanningText(item.notes, `第 ${index + 1} 条内容需求`, 4000);
    const account = catalog.accounts.find(candidate => candidate.id === accountId && candidate.status !== 'inactive');
    if (!account || !account.columns.some(candidate => candidate.name === column)) throw new AppError(`第 ${index + 1} 条必须选择有效账号和固定栏目`);
    if (!notes) throw new AppError(`第 ${index + 1} 条必须填写内容需求`);
    const productIds = Array.isArray(item.workstationProductIds) ? [...new Set(item.workstationProductIds)] : [];
    if (productIds.length > 100 || productIds.some(id => typeof id !== 'string' || !id || id.length > 200)) throw new AppError(`第 ${index + 1} 条关联产品格式不正确`);
    const selection = store.productSelection.get(account.unitId);
    const confirmed = new Set(Object.values(selection.groups).flat().map(candidate => candidate.productId));
    if (productIds.some(id => !confirmed.has(id))) throw new AppError(`第 ${index + 1} 条只能关联该品牌“选品确认”中的产品`);
    integration?.validateReferences(user, { workstationProductIds: productIds });
    return {
      account: accountId,
      column,
      workstationProductIds: productIds,
      noteFormat: cleanPlanningText(item.noteFormat, `第 ${index + 1} 条笔记形式`, 20),
      preferredDate: item.preferredDate ? cleanPlanningDate(item.preferredDate, `第 ${index + 1} 条期望日期`) : '',
      preferredTime: cleanPlanningText(item.preferredTime, `第 ${index + 1} 条期望时间`, 5),
      notes,
    };
  });
  return normalized;
}

export function saveContentPlanningRequests(store, integration, user, input = {}) {
  return store.createRequestBatch(normalizeContentPlanningRequests(store,integration,user,input),input.idempotencyKey);
}

export function fillContentPlanningRequests(store,integration,user,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['idempotencyKey','items'].includes(k))||!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw new AppError('补填批次格式不正确');
  const rows=input.items.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['id','revision','notes','workstationProductIds','noteFormat'].includes(k))||typeof item.id!=='string'||!item.id||!Number.isInteger(item.revision)||item.revision<1)throw new AppError(`第 ${index+1} 条必须提供原需求ID和版本，且不可修改排期字段`);
    const old=store.getRequest(item.id);
    if(integration?.progress?.(user,old)?.linked)throw new AppError(`需求 ${item.id} 已关联行动，不能补填`,409);
    return {accountId:old.account,column:old.column,notes:item.notes,workstationProductIds:item.workstationProductIds,noteFormat:item.noteFormat||old.noteFormat};
  });
  const normalized=normalizeContentPlanningRequests(store,integration,user,{items:rows,idempotencyKey:input.idempotencyKey});
  return store.fillRequestBatch(normalized.map((item,i)=>({id:input.items[i].id,revision:input.items[i].revision,notes:item.notes,workstationProductIds:item.workstationProductIds,noteFormat:item.noteFormat})),input.idempotencyKey);
}

export function saveContentRequestPlans(store,integration,user,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['idempotencyKey','items'].includes(k))||!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw new AppError('策划回填批次格式不正确');
  const items=input.items.map((item,index)=>{
    const allowed=['id','revision','title','copyText','hashtags','imageScript','materialNeeds'];
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!allowed.includes(k))||typeof item.id!=='string'||!item.id||item.id.length>120||!Number.isInteger(item.revision)||item.revision<1)throw new AppError(`第 ${index+1} 条必须提供原需求ID和版本，仅允许策划字段`);
    const old=store.getRequest(item.id);
    if(integration?.progress?.(user,old)?.linked)throw new AppError(`需求 ${item.id} 已关联行动，不能回填`,409);
    const result={id:item.id,revision:item.revision};
    for(const [field,max] of Object.entries({title:500,copyText:20000,hashtags:2000,imageScript:20000,materialNeeds:20000})){
      if(item[field]!==undefined&&typeof item[field]!=='string')throw new AppError(`第 ${index+1} 条 ${field} 必须为文字`);
      result[field]=cleanPlanningText(item[field],field,max);
    }
    if(!result.title||!result.copyText)throw new AppError('策划标题和正文不能为空');
    return result;
  });
  return store.fillPlanningBatch(items,input.idempotencyKey);
}

// Content is a company-wide shared resource. Dedicated permissions explicitly
// grant company-wide access; personal task/department ownership is not inferred.
export function createContentCenterRouter({ requirePermission, hasPermission, getDatabase, dataDir, integration, recommendations, store: injectedStore }) {
  const router = express.Router();
  let store = injectedStore;
  const filename = process.env.WUFAN_CONTENT_DB_PATH || path.join(dataDir, 'content-center.sqlite');
  if (!path.isAbsolute(filename)) throw new Error('WUFAN_CONTENT_DB_PATH 必须为绝对路径');
  router.use(requirePermission('contentCenter.view'));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.path === '/backup') return requirePermission('contentCenter.export')(req, res, next);
    if (!['GET', 'HEAD'].includes(req.method)) return requirePermission('contentCenter.manage')(req, res, next);
    next();
  });
  router.use((req, res, next) => {
    try {
      if (!store) {
        if (!existsSync(filename)) throw new AppError('内容中心数据尚未迁移，请联系管理员恢复迁移包', 503);
        const check = new Database(filename, { readonly: true, fileMustExist: true });
        try {
          const required = ['metadata', 'business_units', 'accounts', 'columns', 'notes', 'candidates', 'images', 'products', 'templates'];
          const present = new Set(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
          if (required.some(table => !present.has(table))) throw new AppError('配置的文件不是完整内容中心数据库，请检查迁移路径', 503);
        } finally { check.close(); }
        store = createStore(filename, {accountRegistryPath:getDatabase().name});
      }
      store.syncAccounts?.();
      if (!injectedStore) {
        store.weeklyRhythm?.seedAyYou();
        store.weeklyRhythm?.seedXiaoMo();
        store.weeklyRhythm?.seedBanran();
        store.weeklyRhythm?.seedHomeFragments();
        store.weeklyRhythm?.seedNanyu();
        store.weeklyRhythm?.seedDianyi();
      }
      next();
    } catch (error) { next(error); }
  });
  const route = (method, url, handler, status = 200) => router[method](url, (req, res, next) => {
    try { res.status(status).json(handler(req)); } catch (error) { next(error); }
  });
  route('get', '/meta', req => ({ ...store.getCatalog(), statuses, priorities, copyStatuses, permissions: {
    manage: hasPermission(req.user, 'contentCenter.manage'), export: hasPermission(req.user, 'contentCenter.export'), products: hasPermission(req.user, 'products.view'),
  } }));
  router.get('/product-selection/:id', requirePermission('products.view'), (req,res,next)=>{try{
    const selection=store.productSelection.get(req.params.id);
    const ids=[...new Set(Object.values(selection.groups).flat().map(p=>p.productId))];
    res.json({...selection,products:integration?.selectionProducts(ids)||[]});
  }catch(error){next(error);}});
  router.put('/product-selection/:id', requirePermission('products.view'), (req,res,next)=>{try{
    const groups=req.body?.groups;
    if(!groups||!['primary','secondary','new'].every(k=>Array.isArray(groups[k])&&groups[k].length<=100))throw new AppError('选品格式不正确');
    const ids=[...new Set(['primary','secondary','new'].flatMap(k=>groups[k]).map(p=>p?.productId))];
    if(ids.some(id=>typeof id!=='string'||!id.trim()||id.length>200))throw new AppError('产品无效');
    const found=new Set((integration?.selectionProducts(ids)||[]).map(p=>p.erpSkuId||p.id));
    if(ids.some(id=>!found.has(id)))throw new AppError('部分产品已失效，请移除后重新选择');
    res.json(store.productSelection.put(req.params.id,req.body));
  }catch(error){next(error);}});
  router.get('/planning/product-selection', requirePermission('products.view'), (req,res,next)=>{try{
    res.json(getContentPlanningProductSelection(store, integration, req.query.brand));
  }catch(error){next(error);}});
  route('get', '/planning/schedule', req => listContentPlanningSchedule(store, req.query));
  route('post', '/planning/requests/plans', req => saveContentRequestPlans(store,integration,req.user,req.body));
  route('post', '/planning/requests/fill', req => fillContentPlanningRequests(store, integration, req.user, req.body));
  route('post', '/planning/requests', req => saveContentPlanningRequests(store, integration, req.user, req.body), 201);
  route('get', '/notes', () => { store.weeklyRhythm?.generate(); return store.list(); });
  route('get', '/weekly-rhythm/:id', req => store.weeklyRhythm.get(req.params.id));
  route('put', '/weekly-rhythm/:id', req => { const config=store.weeklyRhythm.put(req.params.id,req.body); return {...config,generated:store.weeklyRhythm.generate()}; });
  router.get('/product-recommendations', requirePermission('products.view'), (req,res,next)=>{try{
    const brand=store.getCatalog().units.find(u=>u.id===req.query.unitId);
    if(!brand)throw new AppError('请先为需求选择所属品牌');
    if(!recommendations)throw new AppError('推荐服务暂不可用',503);
    res.json(recommendations(brand.name,req.query.kind,req.query.excludeFlowers!=='false',req.query.source||'shops'));
  }catch(error){next(error);}});
  route('get', '/notes/:id', req => { const note=store.get(req.params.id); if(!note) throw new AppError('内容不存在',404); return note; });
  if (integration) {
    route('get', '/calendar-actions', req => integration.calendar(req.user,store));
    route('get', '/references', req => integration.refs(req.user, req.query.noteId ? store.get(req.query.noteId) || {} : {}));
    router.get('/product-options', requirePermission('products.view'), (req,res,next) => { try { res.json(integration.productOptions(req.query)); } catch(error) { next(error); } });
    route('get', '/notes/:id/action', req => { const note=store.get(req.params.id); if(!note) throw new AppError('内容不存在',404); return integration.progress(req.user,note); });
    route('get', '/notes/:id/launch-preview', req => { const note=store.get(req.params.id); if(!note) throw new AppError('内容不存在',404); if(!hasPermission(req.user,'contentCenter.manage')) throw new AppError('没有内容管理权限',403); return integration.prefill(req.user,note); });
    route('post', '/notes/:id/launch', req => { const note=store.get(req.params.id); if(!note) throw new AppError('内容不存在',404); return integration.launch(req.user,store,note,req.body); });
  }
  route('get', '/templates', () => store.listTemplates());
  route('get', '/requests', req => store.listRequests(req.query.generationStatus));
  route('get', '/requests/:id', req => store.getRequest(req.params.id));
  route('get', '/images', () => store.listImages());
  router.get('/images/:id', (req, res, next) => {
    try {
      const image = store.getImage(req.params.id);
      if (!image) throw new AppError('图片不存在', 404);
      res.type(image.mime).send(Buffer.from(image.bytes));
    } catch (error) { next(error); }
  });
  router.get('/product-matches', requirePermission('products.view'), (req, res, next) => {
    try { res.json(matchContentProductCodes(getDatabase(), req.query.codes)); } catch (error) { next(error); }
  });
  router.get('/backup', (req, res, next) => {
    try {
      res.attachment('content-center-backup.json').json({ schemaVersion: 5, catalog: store.getCatalog(), notes: store.list(), originalNotes: store.rawNotes(), products: store.listProducts(), templates: store.listTemplates(), images: store.backupImages(), exportedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });
  route('post', '/configuration/:kind', req => {
    if (!['units', 'accounts', 'columns'].includes(req.params.kind)) throw new AppError('配置类型不存在', 404);
    if (req.params.kind === 'units' && req.body?.kind !== '品牌') throw new AppError('内容中心只管理品牌');
    return store.addConfiguration(req.params.kind, req.body);
  }, 201);
  route('patch', '/configuration/:kind/:id', req => store.editConfiguration(req.params.kind,req.params.id,req.body));
  // Templates are maintained exclusively in the workstation Template Center.

  route('post', '/images', req => store.addImage(req.body), 201);
  route('post', '/notes', req => { integration?.validateReferences(req.user,req.body); return store.save(req.body); }, 201);
  route('patch', '/notes/:id', req => { integration?.validateReferences(req.user,req.body,store.get(req.params.id)||{}); return store.save(req.body,req.params.id); });
  route('patch', '/requests/:id', req => { integration?.validateReferences(req.user,req.body,store.get(req.params.id)||{}); return store.updateRequest(req.params.id,req.body); });
  route('post', '/requests/:id/schedule', req => store.scheduleRequest(req.params.id, req.body));
  route('post', '/batch', req => { if (['workstationProductIds','workstationTemplateId','publishingAccountId'].some(k=>Object.hasOwn(req.body?.patch||{},k))) throw new AppError('请在单条笔记中修改工作站关联'); return store.batch(req.body?.items,req.body?.patch); });
  router.use((req, res) => res.status(404).json({ error: '内容中心接口不存在' }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (!error.status) console.error('内容中心请求失败', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : '操作失败，请稍后重试' });
  });
  return router;
}
