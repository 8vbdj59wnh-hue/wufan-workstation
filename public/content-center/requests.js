'use strict';
async function beginSchedule(n){
if(contentStageOf(n)==='request'){toast('请先补齐内容并存入策划候选');return;}
showDetail(n);
toast('请在发布行动区域发起或查看行动，行动排期后会显示在内容排期中');
}

// Keep row drafts across filtering and re-rendering until explicitly saved or reset.
const requestDrafts=new Map(),requestSaving=new Set(),requestErrors=new Map();
const requestProductCache=new Map(),requestRefLoads=new Map();
function requestValue(n){return {...n,...requestDrafts.get(n.id)?.patch};}
function requestPlanningReady(n,patch={}){
 const v={...n,...patch};
 return Boolean(String(v.title||'').trim() && typeof v.copyText==='string' && (v.copyText.trim() || (v.copyText==='' && (contentStageOf(n)==='candidate' || Object.hasOwn(patch,'copyText')))));
}
function requestProductTiles(n){
return (requestValue(n).workstationProductIds||[]).map(id=>{const product=requestProductCache.get(id),url=product?.mainImage?window.contentRequestAssetUrl(product.mainImage):'';
return `<div class="request-product-tile">${url?`<img src="${esc(url)}" alt="${esc(product.name)}">`:'<span class="request-no-image">'+(product?'暂无图片':'读取中')+'</span>'}<span>${esc(product?.name||'关联产品')}<small>${esc(product?.erpSkuCode||product?.skuCode||'')}</small></span>${window.contentCenterPermissions?.manage&&window.contentCenterPermissions?.products?`<button type="button" data-request-unlink="${esc(id)}" aria-label="移除关联产品" ${requestSaving.has(n.id)?'disabled':''}>×</button>`:''}</div>`;}).join('');
}
function renderEditableRequests(rows){
const writable=window.contentCenterPermissions?.manage===true,refs=window.contentRequestReferences||{};
if(!rows.length)return '<p class="empty">当前栏目暂无内容需求。</p>';
queueMicrotask(()=>hydrateRequestProducts(rows));
return `<p class="request-table-hint">左侧填写需求，右侧编辑策划；可横向滚动查看全部字段。</p><div class="request-table-scroll" tabindex="0" role="region" aria-label="需求与策划编辑表格"><table class="request-edit-table"><colgroup>${[30,150,145,104,110,60,210,350,91].map(width=>`<col style="width:${width}px">`).join('')}</colgroup><thead><tr><th scope="col">序号</th><th>想法</th><th>关联产品</th><th>关联模板</th><th>发布时间</th><th>需求操作</th><th>标题 / 话题</th><th>文案</th><th>策划操作</th></tr></thead><tbody>${rows.map((n,index)=>{
const draft=requestDrafts.get(n.id),v=requestValue(n),disabled=!writable||requestSaving.has(n.id)?'disabled':'';
return `<tr data-request-row="${esc(n.id)}"><td class="request-row-number">${index+1}</td><td><small>${esc(account(n.account)?.name||'账号待定')} · ${esc(n.column||'栏目待定')}</small><textarea data-request-field="notes" aria-label="想法" placeholder="写下内容想法或要求" rows="3" maxlength="20000" ${disabled}>${esc(v.notes)}</textarea></td><td><div data-request-products>${requestProductTiles(n)}</div>${window.contentCenterPermissions?.products?`<div class="request-product-entry"><input type="text" data-request-code aria-label="产品编码" placeholder="产品编码" ${disabled}><button type="button" data-request-match ${disabled}>关联</button></div><div class="request-recommend-actions"><button type="button" data-confirmed-products ${disabled}>已确认选品</button><button type="button" data-request-recommend="hot" ${disabled}>热销</button><button type="button" data-request-recommend="new" ${disabled}>新品</button></div>`:'<small>暂无产品查看权限，已有关系保留。</small>'}<p data-request-product-error role="status"></p></td><td><div data-request-template>${renderRequestTemplate(n)}</div><div class="request-note-format"><select data-request-field="noteFormat" aria-label="笔记形式" ${disabled}>${options(['图文','视频'],v.noteFormat||'图文')}</select></div></td><td><input type="date" data-request-field="preferredDate" aria-label="发布日期" value="${esc(v.preferredDate)}" ${disabled}><input type="time" data-request-field="preferredTime" aria-label="发布时间" value="${esc(v.preferredTime)}" ${disabled}></td><td><span data-request-save-state>${requestSaving.has(n.id)?'正在保存…':draft?'未保存':''}</span><div class="request-row-actions"><button type="button" data-request-save ${disabled}>保存</button><button type="button" data-request-reset ${disabled}>撤销</button></div><p data-request-row-error role="alert">${esc(requestErrors.get(n.id)||'')}</p></td><td><textarea data-request-field="title" aria-label="策划标题" placeholder="填写标题" rows="3" ${disabled}>${esc(v.title)}</textarea><label class="request-topic-label">话题</label><textarea data-request-field="hashtags" aria-label="策划话题" placeholder="#话题" rows="3" ${disabled}>${esc(v.hashtags)}</textarea></td><td><textarea data-request-field="copyText" aria-label="策划文案" placeholder="填写正文，或点击不设正文" rows="6" ${disabled}>${esc(v.copyText)}</textarea><small>${v.copyText===''&&requestPlanningReady(n,draft?.patch)?'已选择不设正文':!v.copyText?'正文尚未填写':''}</small><button type="button" data-request-no-body ${disabled}>不设正文</button></td><td><div class="request-row-actions"><button type="button" data-request-save ${disabled}>保存策划</button><button type="button" data-request-launch ${disabled}>发起行动</button></div></td></tr>`;
}).join('')}</tbody></table></div>`;
}
function requestRow(id){return [...document.querySelectorAll('[data-request-row]')].find(row=>row.dataset.requestRow===id);}
function markRequestDraft(id,field,value){
const n=notes.find(n=>n.id===id);if(!n)return;
const draft=requestDrafts.get(id)||{revision:n.revision,patch:{}};draft.patch[field]=value;requestDrafts.set(id,draft);
const row=requestRow(id);if(row){row.querySelector('[data-request-save-state]').textContent='未保存';row.querySelector('[data-request-row-error]').textContent='';}requestErrors.delete(id);
}
async function hydrateRequestProducts(rows){
if(!window.contentCenterPermissions?.products)return;
for(const n of rows){
 if(!(n.workstationProductIds||[]).some(id=>!requestProductCache.has(id))){
  const row=requestRow(n.id);if(row)row.querySelector('[data-request-products]').innerHTML=requestProductTiles(n);
  continue;
 }
 const key=n.id+':'+n.revision;
 if(!requestRefLoads.has(key))requestRefLoads.set(key,api('/api/references?noteId='+encodeURIComponent(n.id)).then(refs=>{for(const p of refs.productOptions||[])requestProductCache.set(p.erpSkuId||p.id,p);}).catch(error=>{requestRefLoads.delete(key);throw error;}));
 try{await requestRefLoads.get(key);const row=requestRow(n.id);if(row)row.querySelector('[data-request-products]').innerHTML=requestProductTiles(n);}catch(error){const row=requestRow(n.id);if(row)row.querySelector('[data-request-product-error]').textContent=error.message;}
}
}
async function matchRequestProduct(row){
const input=row.querySelector('[data-request-code]'),code=input.value.trim(),message=row.querySelector('[data-request-product-error]');
if(!code||row.dataset.matching==='true')return;
row.dataset.matching='true';const button=row.querySelector('[data-request-match]');button.disabled=true;message.textContent='正在匹配产品…';
try{const result=await api('/api/product-options?search='+encodeURIComponent(code));if(!row.isConnected)return;
const matches=(result.rows||[]).filter(p=>[p.erpSkuCode,p.skuCode].some(value=>String(value||'').trim().toLowerCase()===code.toLowerCase()));
if(matches.length!==1)throw Error(matches.length?'该编码匹配多个产品，请使用唯一的 ERP SKU 编码。':'未找到该产品编码，请核对后重试。');
const product=matches[0],id=product.erpSkuId||product.id,n=notes.find(n=>n.id===row.dataset.requestRow);requestProductCache.set(id,product);
markRequestDraft(n.id,'workstationProductIds',[...new Set([...(requestValue(n).workstationProductIds||[]),id])]);
row.querySelector('[data-request-products]').innerHTML=requestProductTiles(n);input.value='';message.textContent='已关联，保存本行后生效。';
}catch(error){message.textContent=error.message;}finally{row.dataset.matching='false';button.disabled=false;}
}
$('#workspace').addEventListener('keydown',e=>{if(e.target.hasAttribute('data-request-code')&&e.key==='Enter'){e.preventDefault();matchRequestProduct(e.target.closest('[data-request-row]'));}});
$('#workspace').addEventListener('click',e=>{const match=e.target.closest('[data-request-match]'),unlink=e.target.closest('[data-request-unlink]');if(match)matchRequestProduct(match.closest('[data-request-row]'));if(unlink){const row=unlink.closest('[data-request-row]'),n=notes.find(n=>n.id===row.dataset.requestRow);markRequestDraft(n.id,'workstationProductIds',(requestValue(n).workstationProductIds||[]).filter(id=>id!==unlink.dataset.requestUnlink));row.querySelector('[data-request-products]').innerHTML=requestProductTiles(n);}});
$('#workspace').addEventListener('click',e=>{
 const button=e.target.closest('[data-request-no-body]');if(!button)return;
 const row=button.closest('[data-request-row]');markRequestDraft(row.dataset.requestRow,'copyText','');render();
});
$('#workspace').addEventListener('input',e=>{
const field=e.target.dataset.requestField,row=e.target.closest('[data-request-row]');if(!field||!row)return;
markRequestDraft(row.dataset.requestRow,field,e.target.value);
});
async function saveRequestRow(id){
if(requestSaving.has(id))return null;
const draft=requestDrafts.get(id);if(!draft)return notes.find(n=>n.id===id);
requestSaving.add(id);requestErrors.delete(id);render();
try{const n=notes.find(n=>n.id===id);if(n?.isLocalRequest&&!String(draft.patch.notes||'').trim())throw Error('请先填写想法');
const v=requestValue(n),planningReady=requestPlanningReady(n,draft.patch);
const planning={contentStage:planningReady?'candidate':'request',...(planningReady?{noteFormat:v.noteFormat||'图文'}:{})};
const payload=n?.isLocalRequest?{pool:'candidate',contentStage:'request',unitId:n.unitId||'',account:n.account||'',column:n.column||'',...draft.patch,...planning}:{...draft.patch,revision:draft.revision,...planning};
const saved=await api(n?.isLocalRequest?'/api/notes':'/api/notes/'+encodeURIComponent(id),n?.isLocalRequest?'POST':'PATCH',payload);notes=notes.map(n=>n.id===id?saved:n);requestDrafts.delete(id);toast('该条需求已保存');return saved;}
catch(error){requestErrors.set(id,error.message);return null;}
finally{requestSaving.delete(id);render();}
}
$('#workspace').addEventListener('click',async e=>{
const button=e.target.closest('[data-request-save],[data-request-reset],[data-request-complete],[data-request-launch]');if(!button)return;
const id=button.closest('[data-request-row]').dataset.requestRow;
if(requestSaving.has(id))return;
if(button.hasAttribute('data-request-reset')){notes=notes.filter(n=>n.id!==id||!n.isLocalRequest);requestDrafts.delete(id);requestErrors.delete(id);render();return;}
const saved=await saveRequestRow(id);
if(saved&&button.hasAttribute('data-request-complete'))openEditor(saved);
if(saved&&button.hasAttribute('data-request-launch')){try{await window.launchContentPlanning(saved);}catch(error){requestErrors.set(saved.id,error.message);render();}}
});
window.addEventListener('beforeunload',e=>{if(requestDrafts.size||requestSaving.size){e.preventDefault();e.returnValue='';}});

let localRequestSequence=0;
function createLocalRequestId(){
 // LAN HTTP is not a secure context: randomUUID may be unavailable.
 const random=typeof globalThis.crypto?.randomUUID==='function'?globalThis.crypto.randomUUID():`${Date.now().toString(36)}-${++localRequestSequence}`;
 return 'new-request-'+random;
}
$('#workspace').addEventListener('click',e=>{
if(!e.target.closest('[data-add-request]')||!window.contentCenterPermissions?.manage)return;
const context=newRequestContext();if(!context)return;
const {accountId,column}=context;
const id=createLocalRequestId();
notes.unshift({id,isLocalRequest:true,pool:'candidate',contentStage:'request',unitId:account(accountId)?.unitId||filters.unit||'',account:accountId,column,notes:'',title:'',copyText:'',hashtags:'',date:'',time:'',preferredDate:requestDay||'',preferredTime:'',updatedAt:new Date().toISOString(),workstationProductIds:[]});
requestDrafts.set(id,{revision:0,patch:{notes:'',preferredDate:requestDay||''}});render();
const row=requestRow(id);row?.scrollIntoView({block:'nearest'});row?.querySelector('[data-request-field="notes"]')?.focus();
});

let recommendationContext=null,recommendationRevision=0;
const recommendationDialog=document.createElement('dialog');recommendationDialog.className='content-recommend-dialog';document.body.append(recommendationDialog);
function sortNewRecommendations(rows,sort){return [...rows].sort((a,b)=>(sort==='sales'?Number(b.salesQuantity||0)-Number(a.salesQuantity||0):0)||Date.parse(b.newDate)-Date.parse(a.newDate)||a.erpSkuCode.localeCompare(b.erpSkuCode));}
async function openRequestRecommendations(id,kind,excludeFlowers=true,sort='date',source='shops',target=null){
 const n=notes.find(n=>n.id===id);if(!n&&!target)return;
 const unitId=target?.unitId||account(n.account)?.unitId||requestValue(n).unitId||filters.unit;
 if(!unitId){toast('请先选择该需求所属品牌');return;}
 const revision=++recommendationRevision;recommendationContext={id,kind,excludeFlowers,sort,source,target};
 recommendationDialog.innerHTML=`<header><h2>${source==='catalog'?'产品中心':esc(unitName(unitId))} · ${kind==='hot'?'热销推荐':'新品推荐'}</h2><button type="button" data-recommend-close aria-label="关闭推荐">关闭</button></header><label><input type="checkbox" data-recommend-exclude ${excludeFlowers?'checked':''}>过滤仿真花</label>${kind==='new'?`<div class="request-template-tag-options"><button type="button" data-recommend-source="shops" aria-pressed="${source==='shops'}">品牌店铺新品</button><button type="button" data-recommend-source="catalog" aria-pressed="${source==='catalog'}">产品中心新品</button></div>`:''}${kind==='new'&&source==='shops'?`<label class="recommend-sort-label">排序<select data-recommend-sort aria-label="新品排序"><option value="date" ${sort==='date'?'selected':''}>按新品时间</option><option value="sales" ${sort==='sales'?'selected':''}>按30天销量（从高到低）</option></select></label>`:''}<p data-recommend-description>正在读取推荐…</p><div class="content-recommend-grid"></div>`;
 if(!recommendationDialog.open)recommendationDialog.showModal();
 try{const result=await api('/api/product-recommendations?'+new URLSearchParams({unitId,kind,excludeFlowers:String(excludeFlowers),source}));if(revision!==recommendationRevision||!recommendationDialog.open)return;
 recommendationDialog.querySelector('[data-recommend-description]').textContent=source==='catalog'?'产品中心最新50款，按产品录入时间排序，不限制品牌、店铺或销量。同款产品仅推荐一次。':kind==='hot'?`品牌店铺销量 · 近30天（${result.period.periodStart} 至 ${result.period.periodEnd}）销量前50，含组合折算销量。同款产品仅推荐一次。统计店铺：${result.shops.map(s=>s.name).join("、")||"未匹配到店铺"}。`:`品牌店铺产品中的最新50款（按 ERP 原始建档日期选取），可在这50款内按销量排序。销量为近30天（${result.period.periodStart} 至 ${result.period.periodEnd}）品牌店铺销量，含组合折算；同款产品仅推荐一次。统计店铺：${result.shops.map(s=>s.name).join('、')||'未匹配到店铺'}。`;
 const selected=target?target.getSelected():requestValue(notes.find(n=>n.id===id)||n).workstationProductIds||[];
 recommendationDialog.querySelector('.content-recommend-grid').innerHTML=result.rows.length?(kind==='new'?sortNewRecommendations(result.rows,source==='catalog'?'date':sort):result.rows).map((p,i)=>{requestProductCache.set(p.erpSkuId,p);const url=p.mainImage?window.contentRequestAssetUrl(p.mainImage):'';return `<article>${url?`<img src="${esc(url)}" alt="${esc(p.name)}">`:'<div class="request-no-image">暂无图片</div>'}<strong>${i+1}. ${esc(p.name)}</strong><small>${esc(p.erpSkuCode)}</small><span>${source==='catalog'?`录入时间 ${esc(p.newDate.slice(0,10))}`:kind==='hot'?`30天销量 ${p.salesQuantity}`:`建档日期 ${esc(p.newDate.slice(0,10))}</span><span>30天销量 ${Number(p.salesQuantity||0)}`}</span><button type="button" data-recommend-add="${esc(p.erpSkuId)}" ${selected.includes(p.erpSkuId)?'disabled':''}>${selected.includes(p.erpSkuId)?(target?'已选择':'已关联'):(target?.label||'关联产品')}</button></article>`;}).join(''):`<p>${source==='catalog'?'产品中心暂无符合条件的新品。':kind==='hot'?'该品牌近30天暂无符合筛选条件的销量产品。':'该品牌暂无符合条件且具有原始建档日期的新品。'}可取消过滤仿真花后查看。</p>`;
 }catch(error){if(revision===recommendationRevision)recommendationDialog.querySelector('[data-recommend-description]').textContent=error.message;}
}
$('#workspace').addEventListener('click',e=>{const b=e.target.closest('[data-request-recommend]');if(b)openRequestRecommendations(b.closest('[data-request-row]').dataset.requestRow,b.dataset.requestRecommend);});
recommendationDialog.addEventListener('change',e=>{if(e.target.hasAttribute('data-recommend-exclude')&&recommendationContext)openRequestRecommendations(recommendationContext.id,recommendationContext.kind,e.target.checked,recommendationContext.sort,recommendationContext.source,recommendationContext.target);if(e.target.hasAttribute('data-recommend-sort')&&recommendationContext)openRequestRecommendations(recommendationContext.id,recommendationContext.kind,recommendationContext.excludeFlowers,e.target.value,recommendationContext.source,recommendationContext.target);});
recommendationDialog.addEventListener('click',e=>{const sourceButton=e.target.closest('[data-recommend-source]');if(sourceButton&&recommendationContext){openRequestRecommendations(recommendationContext.id,'new',recommendationContext.excludeFlowers,recommendationContext.sort,sourceButton.dataset.recommendSource,recommendationContext.target);return;}if(e.target.closest('[data-recommend-close]'))recommendationDialog.close();const b=e.target.closest('[data-recommend-add]');if(!b||!recommendationContext)return;if(recommendationContext.target){if(recommendationContext.target.onAdd(b.dataset.recommendAdd)!==false){b.disabled=true;b.textContent='已选择';}return;}const n=notes.find(n=>n.id===recommendationContext.id);if(!n||requestSaving.has(n.id))return;const id=b.dataset.recommendAdd;markRequestDraft(n.id,'workstationProductIds',[...new Set([...(requestValue(n).workstationProductIds||[]),id])]);const row=requestRow(n.id);if(row)row.querySelector('[data-request-products]').innerHTML=requestProductTiles(n);b.disabled=true;b.textContent='已关联';});

function requestTemplateImage(t){
 const raw=typeof t?.previewImage==='string'?t.previewImage:t?.previewImage?.fileUrl||t?.previewImage?.url||'';
 return raw?window.contentRequestAssetUrl(raw):'';
}
function renderRequestTemplate(n){
 const id=requestValue(n).workstationTemplateId||'',refs=window.contentRequestReferences||{},t=(refs.templates||[]).find(t=>t.id===id);
 const editable=window.contentCenterPermissions?.manage&&refs.canUseTemplates&&!requestSaving.has(n.id),url=t?requestTemplateImage(t):'';
 return `${id?`<div class="request-template-selected">${url?`<img src="${esc(url)}" alt="${esc(t.name)}">`:'<span class="request-no-image">暂无预览图</span>'}<strong>${esc(t?.name||'原关联模板（暂不可查看）')}</strong><small>${esc(t?.businessCode||'')}</small></div>`:'<small>暂不关联模板</small>'}<div class="request-recommend-actions"><button type="button" data-request-template-open ${editable?'':'disabled'}>${id?'更换模板':'选择模板'}</button>${id?`<button type="button" data-request-template-clear ${editable?'':'disabled'}>移除</button>`:''}</div>`;
}
let templateRequestId='';
const requestTemplateTags=new Set();
function templateTagValues(t){return [...new Set(Object.values(t.tags||{}).flatMap(values=>Array.isArray(values)?values:[]).filter(v=>typeof v==='string'&&v.trim()))];}
function matchesRequestTemplate(t,query){return `${t.name} ${t.businessCode||''}`.toLowerCase().includes(query.trim().toLowerCase())&&[...requestTemplateTags].every(tag=>templateTagValues(t).includes(tag));}
function renderRequestTemplateTagFilters(){
 const tags=[...new Set((window.contentRequestReferences?.templates||[]).flatMap(templateTagValues))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 requestTemplateDialog.querySelector('[data-template-tags]').innerHTML=tags.length?`<span>标签筛选（可多选）</span><div class="request-template-tag-options"><button type="button" data-template-tags-clear aria-pressed="${!requestTemplateTags.size}">全部标签</button>${tags.map(tag=>`<button type="button" data-template-tag="${esc(tag)}" aria-pressed="${requestTemplateTags.has(tag)}">${esc(tag)}</button>`).join('')}</div>`:'<small>暂无可用标签</small>';
}
const requestTemplateDialog=document.createElement('dialog');requestTemplateDialog.className='content-recommend-dialog request-template-dialog';document.body.append(requestTemplateDialog);
function renderRequestTemplateChoices(query=''){
 const n=notes.find(n=>n.id===templateRequestId);if(!n)return;
 const selected=requestValue(n).workstationTemplateId,templates=(window.contentRequestReferences?.templates||[]).filter(t=>matchesRequestTemplate(t,query));
 requestTemplateDialog.querySelector('[data-template-count]').textContent=`找到 ${templates.length} 个模板${requestTemplateTags.size?' · 同时匹配所选标签':''}`;
 requestTemplateDialog.querySelector('.content-recommend-grid').innerHTML=templates.length?templates.map(t=>{const url=requestTemplateImage(t);return `<article>${url?`<img loading="lazy" src="${esc(url)}" alt="${esc(t.name)}">`:'<div class="request-no-image">暂无预览图</div>'}<strong>${esc(t.name)}</strong><small>${esc(t.businessCode||'')}</small><button type="button" data-request-template-pick="${esc(t.id)}" ${selected===t.id?'disabled':''}>${selected===t.id?'已关联':'关联模板'}</button></article>`;}).join(''):'<p class="request-template-empty">暂无匹配的笔记模板。</p>';
}
$('#workspace').addEventListener('click',e=>{
 const b=e.target.closest('[data-request-template-open],[data-request-template-clear]');if(!b||b.disabled)return;
 const n=notes.find(n=>n.id===b.closest('[data-request-row]').dataset.requestRow);if(!n||requestSaving.has(n.id)||!window.contentRequestReferences?.canUseTemplates||!window.contentCenterPermissions?.manage)return;
 if(b.hasAttribute('data-request-template-clear')){markRequestDraft(n.id,'workstationTemplateId','');requestRow(n.id).querySelector('[data-request-template]').innerHTML=renderRequestTemplate(n);return;}
 templateRequestId=n.id;requestTemplateTags.clear();
 requestTemplateDialog.innerHTML='<header><h2>选择关联模板</h2><button type="button" data-template-close>关闭</button></header><input type="search" data-template-search aria-label="搜索模板" placeholder="搜索模板名称或编码"><div data-template-tags role="group" aria-label="模板标签筛选"></div><p>来自模板中心的小红书笔记模板，选择后保存需求即可生效。</p><p data-template-count role="status"></p><div class="content-recommend-grid"></div>';
 renderRequestTemplateTagFilters();renderRequestTemplateChoices();requestTemplateDialog.showModal();
});
requestTemplateDialog.addEventListener('input',e=>{if(e.target.hasAttribute('data-template-search'))renderRequestTemplateChoices(e.target.value);});
requestTemplateDialog.addEventListener('click',e=>{
 const tagButton=e.target.closest('[data-template-tag],[data-template-tags-clear]');if(tagButton){if(tagButton.hasAttribute('data-template-tags-clear'))requestTemplateTags.clear();else{const tag=tagButton.dataset.templateTag;requestTemplateTags.has(tag)?requestTemplateTags.delete(tag):requestTemplateTags.add(tag);}renderRequestTemplateTagFilters();renderRequestTemplateChoices(requestTemplateDialog.querySelector('[data-template-search]').value);return;}
 if(e.target.closest('[data-template-close]'))requestTemplateDialog.close();
 const b=e.target.closest('[data-request-template-pick]');if(!b||b.disabled)return;
 const n=notes.find(n=>n.id===templateRequestId);if(!n||requestSaving.has(n.id)||!window.contentCenterPermissions?.manage||!window.contentRequestReferences?.canUseTemplates)return;
 markRequestDraft(n.id,'workstationTemplateId',b.dataset.requestTemplatePick);
 const row=requestRow(n.id);if(row)row.querySelector('[data-request-template]').innerHTML=renderRequestTemplate(n);
 requestTemplateDialog.close();
});
