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
        store = createStore(filename);
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
  route('get', '/notes', () => store.list());
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
