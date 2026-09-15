'use strict';
const selectionLabels={primary:'主推品',secondary:'次推品',new:'新品'};
const selectionDrafts=new Map(),selectionSaved=new Map(),selectionProducts=new Map(),selectionBusy=new Set();
let selectionBrand='',selectionRenderId=0,selectionDialogId=0;
const selectionDialog=document.createElement('dialog');selectionDialog.className='content-recommend-dialog';document.body.append(selectionDialog);
function selectionProductInfo(id){
 const p=selectionProducts.get(id)||requestProductCache.get(id),url=p?.mainImage?window.contentRequestAssetUrl(p.mainImage):'';
 return `${url?`<img loading="lazy" src="${esc(url)}" alt="${esc(p.name)}">`:'<div class="request-no-image">暂无图片</div>'}<strong>${esc(p?.name||'产品已失效或暂不可查看')}</strong><small>${esc(p?.erpSkuCode||p?.skuCode||id)}</small>`;
}
async function loadSelection(id){
 const data=await api('/api/product-selection/'+encodeURIComponent(id));
 for(const p of data.products||[]){const key=p.erpSkuId||p.id;selectionProducts.set(key,p);requestProductCache.set(key,p);}
 selectionSaved.set(id,data);return data;
}
async function renderProductSelection(){
 const token=++selectionRenderId,brands=meta.units.filter(u=>u.kind==='品牌');
 if(!brands.some(u=>u.id===selectionBrand))selectionBrand=brands[0]?.id||'';
 $('#workspace').setAttribute('aria-label','选品确认');
 $('#workspace').innerHTML=`<div class="selection-toolbar"><div class="selection-brand-buttons" role="group" aria-label="品牌筛选">${brands.map(u=>`<button type="button" data-selection-brand="${esc(u.id)}" aria-pressed="${u.id===selectionBrand}">${esc(u.name)}</button>`).join('')}</div><h2>选品确认</h2><span data-selection-state></span>${window.contentCenterPermissions?.manage&&window.contentCenterPermissions?.products?'<button type="button" class="primary" data-selection-save disabled>保存确认</button><button type="button" data-selection-reload disabled>撤销修改 / 重新加载</button>':''}</div><p data-selection-error role="alert"></p><div data-selection-body>正在读取选品…</div>`;
 if(!selectionBrand){$('[data-selection-body]').textContent='请先在账号与栏目中设置品牌。';return;}
 if(!window.contentCenterPermissions?.products){$('[data-selection-body]').textContent='查看选品需要产品查看权限。';return;}
 const id=selectionBrand;
 try{if(!selectionSaved.has(id))await loadSelection(id);if(token!==selectionRenderId||page!=='selection')return;paintSelection();}
 catch(e){if(token===selectionRenderId&&page==='selection')$('[data-selection-body]').textContent=e.message;}
}
function paintSelection(){
 if(page!=='selection')return;
 const data=selectionDrafts.get(selectionBrand)||selectionSaved.get(selectionBrand);if(!data)return;
 const disabled=!window.contentCenterPermissions?.manage||selectionBusy.has(selectionBrand);
 $('[data-selection-state]').textContent=selectionDrafts.has(selectionBrand)?'有未保存的修改':data.updatedAt?'已确认 · '+new Date(data.updatedAt).toLocaleString('zh-CN'):'尚未设置';
 for(const b of document.querySelectorAll('[data-selection-save],[data-selection-reload],[data-selection-brand]'))b.disabled=selectionBusy.has(selectionBrand);
 $('[data-selection-body]').innerHTML=`<div class="selection-columns">${Object.entries(selectionLabels).map(([key,label])=>`<section><header><h3>${label} <small>${data.groups[key].length}款</small></h3><button type="button" data-selection-add="${key}" ${disabled?'disabled':''}>＋ 选择产品</button></header><div class="selection-items">${data.groups[key].map(item=>`<article data-selection-item="${esc(item.productId)}" data-selection-group="${key}">${selectionProductInfo(item.productId)}<textarea data-selection-remark aria-label="${label}选品备注" maxlength="1000" rows="2" placeholder="选品理由或规划建议（可选）" ${disabled?'disabled':''}>${esc(item.remark)}</textarea><button type="button" data-selection-remove ${disabled?'disabled':''}>移除</button></article>`).join('')||'<p class="empty">暂未设置产品</p>'}</div></section>`).join('')}</div>`;
}
function editSelection(){if(!selectionDrafts.has(selectionBrand))selectionDrafts.set(selectionBrand,structuredClone(selectionSaved.get(selectionBrand)));return selectionDrafts.get(selectionBrand);}
$('#workspace').addEventListener('click',e=>{const b=e.target.closest('[data-selection-brand]');if(b&&!selectionBusy.has(selectionBrand)){selectionBrand=b.dataset.selectionBrand;renderProductSelection();}});
$('#workspace').addEventListener('input',e=>{if(!e.target.matches('[data-selection-remark]')||!window.contentCenterPermissions?.manage)return;const tile=e.target.closest('[data-selection-item]');editSelection().groups[tile.dataset.selectionGroup].find(p=>p.productId===tile.dataset.selectionItem).remark=e.target.value;$('[data-selection-state]').textContent='有未保存的修改';});
$('#workspace').addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-confirmed-products')){openConfirmedProducts(b.closest('[data-request-row]').dataset.requestRow);return;}
 if(page!=='selection'||!window.contentCenterPermissions?.manage||selectionBusy.has(selectionBrand))return;
 const id=selectionBrand;
 if(b.hasAttribute('data-selection-add')){openSelectionSearch(id,b.dataset.selectionAdd);return;}
 if(b.hasAttribute('data-selection-remove')){const tile=b.closest('[data-selection-item]');const draft=editSelection();draft.groups[tile.dataset.selectionGroup]=draft.groups[tile.dataset.selectionGroup].filter(p=>p.productId!==tile.dataset.selectionItem);paintSelection();return;}
 if(!b.matches('[data-selection-save],[data-selection-reload]'))return;
 selectionBusy.add(id);paintSelection();$('[data-selection-error]').textContent='';
 try{
  if(b.hasAttribute('data-selection-save')){const data=selectionDrafts.get(id)||selectionSaved.get(id);const saved=await api('/api/product-selection/'+encodeURIComponent(id),'PUT',{revision:data.revision,groups:data.groups});selectionSaved.set(id,saved);selectionDrafts.delete(id);toast('选品已确认，规划需求时可参考关联');}
  else {await loadSelection(id);selectionDrafts.delete(id);}
 }catch(error){$('[data-selection-error]').textContent=error.message;}finally{selectionBusy.delete(id);paintSelection();}
});
function closeSelectionDialog(){selectionDialogId++;selectionDialog.close();}
selectionDialog.addEventListener('close',()=>selectionDialogId++);
async function openSelectionSearch(brand,group){
 const token=++selectionDialogId;
 selectionDialog.innerHTML=`<header><h2>${esc(meta.units.find(u=>u.id===brand)?.name)} · ${selectionLabels[group]}</h2><button type="button" data-select-close>关闭</button></header><div class="request-template-tag-options"><button type="button" data-selection-recommend="hot">热销</button><button type="button" data-selection-recommend="new">新品</button></div><form data-selection-search><input type="search" name="search" aria-label="搜索产品" placeholder="产品名称或编码"><button>搜索</button></form><p data-selection-results-state></p><div class="content-recommend-grid"></div>`;
 selectionDialog.showModal();
 let queryId=0;
 const search=async()=>{const version=++queryId;selectionDialog.querySelector('[data-selection-results-state]').textContent='正在查找…';try{
  const result=await api('/api/product-options?'+new URLSearchParams({search:selectionDialog.querySelector('[name="search"]').value,limit:100}));
  if(token!==selectionDialogId||version!==queryId)return;
  selectionDialog.querySelector('[data-selection-results-state]').textContent=`${(result.rows||[]).length}款；可搜索产品名称或完整编码。`;
  const selected=(selectionDrafts.get(brand)||selectionSaved.get(brand)).groups[group];
  selectionDialog.querySelector('.content-recommend-grid').innerHTML=(result.rows||[]).map(p=>{const id=p.erpSkuId||p.id;selectionProducts.set(id,p);return `<article>${selectionProductInfo(id)}<button type="button" data-selection-pick="${esc(id)}" ${selected.some(x=>x.productId===id)?'disabled':''}>${selected.some(x=>x.productId===id)?'已选择':'加入'+selectionLabels[group]}</button></article>`;}).join('');
 }catch(error){if(token===selectionDialogId)selectionDialog.querySelector('[data-selection-results-state]').textContent=error.message;}};
 selectionDialog.querySelector('form').onsubmit=e=>{e.preventDefault();search();};
 selectionDialog.onclick=e=>{if(e.target.closest('[data-select-close]')){closeSelectionDialog();return;}const recommend=e.target.closest('[data-selection-recommend]');if(recommend){openRequestRecommendations(null,recommend.dataset.selectionRecommend,true,'date','shops',{unitId:brand,label:'加入'+selectionLabels[group],getSelected:()=>(selectionDrafts.get(brand)||selectionSaved.get(brand)).groups[group].map(p=>p.productId),onAdd:id=>{if(brand!==selectionBrand||!window.contentCenterPermissions?.manage||selectionBusy.has(brand))return false;const list=editSelection().groups[group];if(list.length>=100){toast('每组最多100个产品');return false;}if(!list.some(p=>p.productId===id))list.push({productId:id,remark:''});const product=requestProductCache.get(id);if(product)selectionProducts.set(id,product);const button=[...selectionDialog.querySelectorAll('[data-selection-pick]')].find(b=>b.dataset.selectionPick===id);if(button){button.disabled=true;button.textContent='已选择';}paintSelection();return true;}});return;}const b=e.target.closest('[data-selection-pick]');if(!b||brand!==selectionBrand)return;const list=editSelection().groups[group];if(list.length>=100){toast('每组最多100个产品');return;}if(!list.some(p=>p.productId===b.dataset.selectionPick))list.push({productId:b.dataset.selectionPick,remark:''});b.disabled=true;b.textContent='已选择';paintSelection();};
 await search();
}
async function openConfirmedProducts(noteId){
 const n=notes.find(n=>n.id===noteId),unitId=account(n?.account)?.unitId||n?.unitId;
 if(!unitId){toast('请先为需求选择所属品牌账号');return;}
 const token=++selectionDialogId;
 selectionDialog.innerHTML='<header><h2>已确认选品</h2><button type="button" data-select-close>关闭</button></header><div data-confirmed-body>正在读取…</div>';selectionDialog.showModal();
 selectionDialog.onclick=e=>{if(e.target.closest('[data-select-close]')){closeSelectionDialog();return;}const b=e.target.closest('[data-confirmed-pick]');if(!b||requestSaving.has(noteId))return;markRequestDraft(noteId,'workstationProductIds',[...new Set([...(requestValue(n).workstationProductIds||[]),b.dataset.confirmedPick])]);const row=requestRow(noteId);if(row)row.querySelector('[data-request-products]').innerHTML=requestProductTiles(n);b.disabled=true;b.textContent='已关联';};
 try{const data=await loadSelection(unitId);if(token!==selectionDialogId)return;
 selectionDialog.querySelector('h2').textContent=(meta.units.find(u=>u.id===unitId)?.name||'')+' · 已确认选品';
 selectionDialog.querySelector('[data-confirmed-body]').innerHTML=`<p>关联后保存该条需求即可生效。</p>${Object.entries(selectionLabels).map(([key,label])=>`<h3>${label}</h3><div class="content-recommend-grid">${data.groups[key].map(item=>`<article>${selectionProductInfo(item.productId)}<p>${esc(item.remark)}</p><button type="button" data-confirmed-pick="${esc(item.productId)}" ${!window.contentCenterPermissions?.manage||!data.products.some(p=>(p.erpSkuId||p.id)===item.productId)||(requestValue(n).workstationProductIds||[]).includes(item.productId)?'disabled':''}>${(requestValue(n).workstationProductIds||[]).includes(item.productId)?'已关联':'关联产品'}</button></article>`).join('')||'<p>尚未确认选品</p>'}</div>`).join('')}`;
 }catch(error){if(token===selectionDialogId)selectionDialog.querySelector('[data-confirmed-body]').textContent=error.message;}
}
