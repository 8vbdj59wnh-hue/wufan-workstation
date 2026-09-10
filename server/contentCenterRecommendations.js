// Rank goods once, while retaining a concrete SKU for the existing association flow.
const normalizedBrand=value=>String(value||'').trim().replace(/[（(]独家[）)]$/,'').trim();
export function rankContentRecommendations(items, metadata, {brand,kind,excludeFlowers=true}) {
 const groups=new Map();
 for(const item of items){
  const m=metadata.get(item.erpSkuId);if(!m||m.currentState!=='active'||normalizedBrand(item.brand)!==normalizedBrand(brand))continue;
  if(excludeFlowers&&/仿真花|假花|人造花/.test(`${item.category||''} ${m.category||''} ${item.name||''}`))continue;
  const quantity=Number(item.sales?.totalPhysicalContribution)||0;
  let g=groups.get(m.erpGoodsId);
  if(!g){g={...item,erpSkuId:item.erpSkuId,erpSkuCode:item.sku,mainImage:item.image,salesQuantity:0,newDate:m.sourceCreatedAt||'',representativeQuantity:quantity};groups.set(m.erpGoodsId,g);}
  g.salesQuantity+=quantity;
  if(quantity>g.representativeQuantity){Object.assign(g,{erpSkuId:item.erpSkuId,erpSkuCode:item.sku,name:item.name,mainImage:item.image,representativeQuantity:quantity});}
 }
 return [...groups.values()].filter(g=>kind==='hot'?g.salesQuantity>0:Number.isFinite(Date.parse(g.newDate)))
 .sort((a,b)=>(kind==='hot'?b.salesQuantity-a.salesQuantity:Date.parse(b.newDate)-Date.parse(a.newDate))||a.erpSkuCode.localeCompare(b.erpSkuCode)).slice(0,20)
 .map(({erpSkuId,erpSkuCode,name,mainImage,salesQuantity,newDate})=>({id:erpSkuId,erpSkuId,erpSkuCode,name,mainImage,salesQuantity,newDate}));
}
export function createContentRecommendations(getDatabase,readModel){
 let cached;
 return (brand,kind,excludeFlowers=true)=>{
  if(!['hot','new'].includes(kind))throw Error('推荐类型不存在');
  const now=new Date(),end=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1),start=new Date(end);start.setDate(start.getDate()-29);
  const date=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if(!cached||Date.now()>cached.until){
   const model=readModel({range:'custom',periodStart:date(start),periodEnd:date(end)},{unpaged:true});
   const metadata=new Map(getDatabase().prepare('SELECT s.id,s.erpGoodsId,s.currentState,g.sourceCreatedAt,g.category FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId').all().map(m=>[m.id,m]));
   cached={model,metadata,until:Date.now()+60000};
  }
  return {rows:rankContentRecommendations(cached.model.items,cached.metadata,{brand,kind,excludeFlowers}),brand,kind,period:cached.model.period,newDateBasis:'ERP 原始建档日期',excludeFlowers};
 };
}
