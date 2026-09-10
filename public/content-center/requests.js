'use strict';
async function beginSchedule(n){
if(contentStageOf(n)==='request'){toast('请先补齐内容并存入内容候选');return;}
if(n.requestKind!=='bulk'){openEditor(n,undefined,'schedule');return;}
if(n.generationStatus!=='已生成'){toast('请先完成生成或调整，再加入排期');return;}
if(!n.preferredDate||!n.preferredTime){openEditor(n,undefined,'schedule');return;}
if(busy)return;busy=true;try{const saved=await api('/api/requests/'+n.id+'/schedule','POST',{revision:n.revision});anchor=saved.date;page='calendar';filters={account:'',column:'',status:''};await reload();toast('已加入排期');}catch(err){toast(err.message);await reload().catch(()=>{});}finally{busy=false;}
}

// Keep row drafts across filtering and re-rendering until explicitly saved or reset.
const requestDrafts=new Map(),requestSaving=new Set(),requestErrors=new Map();
const requestProductCache=new Map(),requestRefLoads=new Map();
function requestValue(n){return {...n,...requestDrafts.get(n.id)?.patch};}
function requestProductTiles(n){
return (requestValue(n).workstationProductIds||[]).map(id=>{const product=requestProductCache.get(id),url=product?.mainImage?window.contentRequestAssetUrl(product.mainImage):'';
return `<div class="request-product-tile">${url?`<img src="${esc(url)}" alt="${esc(product.name)}">`:'<span class="request-no-image">'+(product?'暂无图片':'读取中')+'</span>'}<span>${esc(product?.name||'关联产品')}<small>${esc(product?.erpSkuCode||product?.skuCode||'')}</small></span>${window.contentCenterPermissions?.manage&&window.contentCenterPermissions?.products?`<button type="button" data-request-unlink="${esc(id)}" aria-label="移除关联产品" ${requestSaving.has(n.id)?'disabled':''}>×</button>`:''}</div>`;}).join('');
}
function renderEditableRequests(rows){
const writable=window.contentCenterPermissions?.manage===true,refs=window.contentRequestReferences||{};
if(!rows.length)return '<p class="empty">当前栏目暂无内容需求。</p>';
queueMicrotask(()=>hydrateRequestProducts(rows));
return `<div class="request-table-scroll"><table class="request-edit-table"><thead><tr><th scope="col">序号</th><th>想法</th><th>关联产品</th><th>关联模板</th><th>发布时间</th><th>操作</th></tr></thead><tbody>${rows.map((n,index)=>{
const draft=requestDrafts.get(n.id),v=requestValue(n),disabled=!writable||requestSaving.has(n.id)?'disabled':'';
return `<tr data-request-row="${esc(n.id)}"><td class="request-row-number">${index+1}</td><td><small>${esc(account(n.account)?.name||'账号待定')} · ${esc(n.column||'栏目待定')}</small><textarea data-request-field="notes" aria-label="想法" placeholder="写下内容想法或要求" rows="3" maxlength="20000" ${disabled}>${esc(v.notes)}</textarea></td><td><div data-request-products>${requestProductTiles(n)}</div>${window.contentCenterPermissions?.products?`<div class="request-product-entry"><input type="text" data-request-code aria-label="产品编码" placeholder="输入完整产品编码" ${disabled}><button type="button" data-request-match ${disabled}>关联</button></div><small>输入编码后按回车或点击关联，匹配后显示产品图片。</small><div class="request-recommend-actions"><button type="button" data-request-recommend="hot" ${disabled}>热销</button><button type="button" data-request-recommend="new" ${disabled}>新品</button></div>`:'<small>暂无产品查看权限，已有关系保留。</small>'}<p data-request-product-error role="status"></p></td><td><select data-request-field="workstationTemplateId" aria-label="关联模板" ${disabled} ${refs.canUseTemplates?'':'disabled'}>${options((refs.templates||[]).map(t=>[t.id,t.name+(t.businessCode?' · '+t.businessCode:'')]),v.workstationTemplateId||'','暂不关联模板')}${v.workstationTemplateId&&!(refs.templates||[]).some(t=>t.id===v.workstationTemplateId)?`<option selected value="${esc(v.workstationTemplateId)}">原关联模板（暂不可查看）</option>`:''}</select></td><td><input type="date" data-request-field="preferredDate" aria-label="发布日期" value="${esc(v.preferredDate)}" ${disabled}><input type="time" data-request-field="preferredTime" aria-label="发布时间" value="${esc(v.preferredTime)}" ${disabled}></td><td><span data-request-save-state>${requestSaving.has(n.id)?'正在保存…':draft?'未保存':''}</span><div class="request-row-actions"><button type="button" data-request-save ${disabled}>保存</button><button type="button" data-request-reset ${disabled}>撤销</button><button type="button" data-request-complete ${disabled}>补齐内容</button></div><p data-request-row-error role="alert">${esc(requestErrors.get(n.id)||'')}</p></td></tr>`;
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
 if(!(n.workstationProductIds||[]).some(id=>!requestProductCache.has(id)))continue;
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
$('#workspace').addEventListener('input',e=>{
const field=e.target.dataset.requestField,row=e.target.closest('[data-request-row]');if(!field||!row)return;
markRequestDraft(row.dataset.requestRow,field,e.target.value);
});
async function saveRequestRow(id){
if(requestSaving.has(id))return null;
const draft=requestDrafts.get(id);if(!draft)return notes.find(n=>n.id===id);
requestSaving.add(id);requestErrors.delete(id);render();
try{const n=notes.find(n=>n.id===id);if(n?.isLocalRequest&&!String(draft.patch.notes||'').trim())throw Error('请先填写想法');
const payload=n?.isLocalRequest?{pool:'candidate',contentStage:'request',unitId:n.unitId||'',account:n.account||'',column:n.column||'',...draft.patch}:{...draft.patch,revision:draft.revision,contentStage:'request'};
const saved=await api(n?.isLocalRequest?'/api/notes':'/api/notes/'+encodeURIComponent(id),n?.isLocalRequest?'POST':'PATCH',payload);notes=notes.map(n=>n.id===id?saved:n);requestDrafts.delete(id);toast('该条需求已保存');return saved;}
catch(error){requestErrors.set(id,error.message);return null;}
finally{requestSaving.delete(id);render();}
}
$('#workspace').addEventListener('click',async e=>{
const button=e.target.closest('[data-request-save],[data-request-reset],[data-request-complete]');if(!button)return;
const id=button.closest('[data-request-row]').dataset.requestRow;
if(requestSaving.has(id))return;
if(button.hasAttribute('data-request-reset')){notes=notes.filter(n=>n.id!==id||!n.isLocalRequest);requestDrafts.delete(id);requestErrors.delete(id);render();return;}
const saved=await saveRequestRow(id);
if(saved&&button.hasAttribute('data-request-complete'))openEditor(saved);
});
window.addEventListener('beforeunload',e=>{if(requestDrafts.size||requestSaving.size){e.preventDefault();e.returnValue='';}});

$('#workspace').addEventListener('click',e=>{
if(!e.target.closest('[data-add-request]')||!window.contentCenterPermissions?.manage)return;
let accountId=filters.account||'',column=filters.column||'';
if(!accountId&&column){const matches=visibleAccounts().filter(a=>a.columns.some(c=>c.name===column));if(matches.length===1)accountId=matches[0].id;else{column='';filters.column='';}}
const id='new-request-'+crypto.randomUUID();
notes.unshift({id,isLocalRequest:true,pool:'candidate',contentStage:'request',unitId:account(accountId)?.unitId||filters.unit||'',account:accountId,column,notes:'',title:'',date:'',time:'',preferredDate:requestDay||'',preferredTime:'',updatedAt:new Date().toISOString(),workstationProductIds:[]});
requestDrafts.set(id,{revision:0,patch:{notes:'',preferredDate:requestDay||''}});render();
const row=requestRow(id);row?.scrollIntoView({block:'nearest'});row?.querySelector('[data-request-field="notes"]')?.focus();
});

let recommendationContext=null,recommendationRevision=0;
const recommendationDialog=document.createElement('dialog');recommendationDialog.className='content-recommend-dialog';document.body.append(recommendationDialog);
async function openRequestRecommendations(id,kind,excludeFlowers=true){
 const n=notes.find(n=>n.id===id);if(!n)return;
 const unitId=account(n.account)?.unitId||requestValue(n).unitId||filters.unit;
 if(!unitId){toast('请先选择该需求所属品牌');return;}
 const revision=++recommendationRevision;recommendationContext={id,kind,excludeFlowers};
 recommendationDialog.innerHTML=`<header><h2>${esc(unitName(unitId))} · ${kind==='hot'?'热销推荐':'新品推荐'}</h2><button type="button" data-recommend-close aria-label="关闭推荐">关闭</button></header><label><input type="checkbox" data-recommend-exclude ${excludeFlowers?'checked':''}>过滤仿真花</label><p data-recommend-description>正在读取推荐…</p><div class="content-recommend-grid"></div>`;
 if(!recommendationDialog.open)recommendationDialog.showModal();
 try{const result=await api('/api/product-recommendations?'+new URLSearchParams({unitId,kind,excludeFlowers:String(excludeFlowers)}));if(revision!==recommendationRevision||!recommendationDialog.open)return;
 recommendationDialog.querySelector('[data-recommend-description]').textContent=kind==='hot'?`近30天（${result.period.periodStart} 至 ${result.period.periodEnd}）销量前20，含组合折算销量。同款产品仅推荐一次。`:'最近20个新品，按 ERP 原始建档日期排序；同款产品仅推荐一次。';
 const selected=requestValue(notes.find(n=>n.id===id)||n).workstationProductIds||[];
 recommendationDialog.querySelector('.content-recommend-grid').innerHTML=result.rows.length?result.rows.map((p,i)=>{requestProductCache.set(p.erpSkuId,p);const url=p.mainImage?window.contentRequestAssetUrl(p.mainImage):'';return `<article>${url?`<img src="${esc(url)}" alt="${esc(p.name)}">`:'<div class="request-no-image">暂无图片</div>'}<strong>${i+1}. ${esc(p.name)}</strong><small>${esc(p.erpSkuCode)}</small><span>${kind==='hot'?`30天销量 ${p.salesQuantity}`:`建档日期 ${esc(p.newDate.slice(0,10))}`}</span><button type="button" data-recommend-add="${esc(p.erpSkuId)}" ${selected.includes(p.erpSkuId)?'disabled':''}>${selected.includes(p.erpSkuId)?'已关联':'关联产品'}</button></article>`;}).join(''):`<p>${kind==='hot'?'该品牌近30天暂无符合筛选条件的销量产品。':'该品牌暂无符合条件且具有原始建档日期的新品。'}可取消过滤仿真花后查看。</p>`;
 }catch(error){if(revision===recommendationRevision)recommendationDialog.querySelector('[data-recommend-description]').textContent=error.message;}
}
$('#workspace').addEventListener('click',e=>{const b=e.target.closest('[data-request-recommend]');if(b)openRequestRecommendations(b.closest('[data-request-row]').dataset.requestRow,b.dataset.requestRecommend);});
recommendationDialog.addEventListener('change',e=>{if(e.target.hasAttribute('data-recommend-exclude')&&recommendationContext)openRequestRecommendations(recommendationContext.id,recommendationContext.kind,e.target.checked);});
recommendationDialog.addEventListener('click',e=>{if(e.target.closest('[data-recommend-close]'))recommendationDialog.close();const b=e.target.closest('[data-recommend-add]');if(!b||!recommendationContext)return;const n=notes.find(n=>n.id===recommendationContext.id);if(!n||requestSaving.has(n.id))return;const id=b.dataset.recommendAdd;markRequestDraft(n.id,'workstationProductIds',[...new Set([...(requestValue(n).workstationProductIds||[]),id])]);const row=requestRow(n.id);if(row)row.querySelector('[data-request-products]').innerHTML=requestProductTiles(n);b.disabled=true;b.textContent='已关联';});
