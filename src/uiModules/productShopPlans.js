import { productShopPlanRequest, resolveAssetUrl } from '../services/productCenterService.js';
import { escapeHtml as esc } from '../utils/html.js';

export function renderProductShopPlans(shop, canManage) {
 if(!shop)return '';
 return `<div class="product-shop-plans" data-shop-plans data-shop-id="${esc(shop.id)}" data-can-manage="${canManage}">${['listing','withdrawal'].map(direction=>`<section class="product-shop-plan" data-plan-direction="${direction}">
 <header><div><h3>${direction==='listing'?'预备上架':'预备下架'} <small data-plan-count></small></h3><p>${esc(shop.name)} · ${direction==='listing'?'准备在本店上架的产品':'准备从本店撤出的产品'}</p></div>${canManage?'<button type="button" class="secondary-button" data-plan-open>添加产品</button>':''}</header>
 <div role="status" data-plan-error></div><div data-plan-items>正在读取计划…</div>
 <div data-plan-picker hidden><form data-plan-search><input name="query" type="search" placeholder="搜索产品名称 / SKU编码" aria-label="搜索计划产品"/><button class="secondary-button">搜索</button><button type="button" class="secondary-button" data-plan-close>关闭</button></form>
 <p>${direction==='listing'?'从尚未关联本店的产品中选择':'从本店已关联产品中选择'}；计划保存后不会自动执行平台上下架。</p>
 <form data-plan-select><div data-plan-candidates></div><footer><button type="button" class="secondary-button" data-plan-prev>上一页</button><button type="button" class="secondary-button" data-plan-next>下一页</button><button class="primary-button" data-plan-save>加入计划</button><span>每次可多选当前页产品</span></footer></form></div>
 </section>`).join('')}</div>`;
}

const image=item=>item.mainImage?`<img loading="lazy" src="${esc(resolveAssetUrl(item.mainImage))}" alt="${esc(item.productName)}"/>`:'<span class="product-sandbox-image-placeholder">无图</span>';
export function bindProductShopPlans() {
 document.querySelectorAll('[data-shop-plans]').forEach(root=>{
  if(root.dataset.bound)return;root.dataset.bound='true';
  const shopId=root.dataset.shopId,canManage=root.dataset.canManage==='true';
  root.querySelectorAll('[data-plan-direction]').forEach(panel=>{
   const direction=panel.dataset.planDirection;
   const select=s=>panel.querySelector(s);
   let offset=0,query='',generation=0,busy=false;
   const error=e=>{if(panel.isConnected)select('[data-plan-error]').textContent=e?.message||'';};
   async function load(){
    try{const result=await productShopPlanRequest({shopId,direction});if(!panel.isConnected)return;
     select('[data-plan-count]').textContent=`${result.items.length} 个`;
     select('[data-plan-items]').innerHTML=result.items.length?`<div class="product-plan-grid">${result.items.map(item=>`<article><a href="#products/sku/${encodeURIComponent(item.erpSkuId)}">${image(item)}<strong>${esc(item.productName)}</strong><small>${esc(item.skuCode)}</small></a>${canManage?`<button type="button" class="secondary-button" data-plan-remove="${esc(item.erpSkuId)}">移出计划</button>`:''}</article>`).join('')}</div>`:'<p class="empty-state">暂无计划产品</p>';
     panel.querySelectorAll('[data-plan-remove]').forEach(button=>button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;try{await productShopPlanRequest({shopId,direction,erpSkuId:button.dataset.planRemove},'DELETE');error(null);await load();}catch(e){error(e);button.disabled=false;}finally{busy=false;}});
    }catch(e){error(e);select('[data-plan-items]').textContent='计划读取失败，请刷新重试。';}
   }
   async function search(){
    const request=++generation;select('[data-plan-save]').disabled=true;
    select('[data-plan-candidates]').textContent='正在搜索…';
    try{const result=await productShopPlanRequest({shopId,direction,query,offset,candidates:'true'});if(!panel.isConnected||request!==generation)return;
     select('[data-plan-candidates]').innerHTML=result.items.length?`<div class="product-plan-grid">${result.items.map(item=>`<label><input type="checkbox" name="erpSkuIds" value="${esc(item.erpSkuId)}"/>${image(item)}<strong>${esc(item.productName)}</strong><small>${esc(item.skuCode)}</small></label>`).join('')}</div>`:'<p>暂无可添加的产品</p>';
     select('[data-plan-prev]').disabled=offset===0;select('[data-plan-next]').disabled=!result.hasMore;select('[data-plan-save]').disabled=!result.items.length;
    }catch(e){if(request===generation){error(e);select('[data-plan-candidates]').textContent='搜索失败，请重试。';}}
   }
   if(canManage){
    select('[data-plan-open]').onclick=()=>{select('[data-plan-picker]').hidden=false;offset=0;void search();};
    select('[data-plan-close]').onclick=()=>{generation++;select('[data-plan-picker]').hidden=true;};
    select('[data-plan-search]').onsubmit=e=>{e.preventDefault();query=e.currentTarget.elements.query.value;offset=0;void search();};
    select('[data-plan-prev]').onclick=()=>{offset=Math.max(0,offset-50);void search();};
    select('[data-plan-next]').onclick=()=>{offset+=50;void search();};
    select('[data-plan-select]').onsubmit=async e=>{e.preventDefault();if(busy)return;const erpSkuIds=[...panel.querySelectorAll('[name="erpSkuIds"]:checked')].map(x=>x.value);if(!erpSkuIds.length){error(new Error('请先选择产品。'));return;}busy=true;select('[data-plan-save]').disabled=true;
     try{await productShopPlanRequest({shopId,direction,erpSkuIds},'POST');error(null);await load();if(panel.isConnected){offset=0;await search();}}catch(e){error(e);}finally{busy=false;if(panel.isConnected)select('[data-plan-save]').disabled=false;}
    };
   }
   void load();
  });
 });
}
