// Rank goods once, while retaining a concrete SKU for the existing association flow.
const normalizedBrand=value=>String(value||'').trim().replace(/[（(]独家[）)]$/,'').trim();
export function rankContentRecommendations(items, metadata, {brand,kind,excludeFlowers=true}) {
 const groups=new Map();
 for(const item of items){
  const m=metadata.get(item.erpSkuId);if(!m||m.currentState!=='active'||!m.inBrandShop)continue;
  if(excludeFlowers&&/仿真花|假花|人造花/.test(`${item.category||''} ${m.category||''} ${item.name||''}`))continue;
  const quantity=Number(item.sales?.totalPhysicalContribution)||0;
  let g=groups.get(m.erpGoodsId);
  if(!g){g={...item,erpSkuId:item.erpSkuId,erpSkuCode:item.sku,mainImage:item.image,salesQuantity:0,newDate:m.sourceCreatedAt||'',representativeQuantity:quantity};groups.set(m.erpGoodsId,g);}
  g.salesQuantity+=quantity;
  if(quantity>g.representativeQuantity){Object.assign(g,{erpSkuId:item.erpSkuId,erpSkuCode:item.sku,name:item.name,mainImage:item.image,representativeQuantity:quantity});}
 }
 return [...groups.values()].filter(g=>kind==='hot'?g.salesQuantity>0:Number.isFinite(Date.parse(g.newDate)))
 .sort((a,b)=>(kind==='hot'?b.salesQuantity-a.salesQuantity:Date.parse(b.newDate)-Date.parse(a.newDate))||a.erpSkuCode.localeCompare(b.erpSkuCode)).slice(0,kind==='new'?50:20)
 .map(({erpSkuId,erpSkuCode,name,mainImage,salesQuantity,newDate})=>({id:erpSkuId,erpSkuId,erpSkuCode,name,mainImage,salesQuantity,newDate}));
}
export function selectBrandShops(shops,brand){
 const key=normalizedBrand(brand);
 if(!key)return [];
 return shops.filter(s=>!["disabled","archived","deleted"].includes(s.status)&&[s.displayName,s.shopName,s.normalizedShopName].some(name=>String(name||'').includes(key)));
}
export function createContentRecommendations(getDatabase,queryContributions,readRelations){
 const cache=new Map();
 return (brand,kind,excludeFlowers=true)=>{
  if(!['hot','new'].includes(kind))throw Error('推荐类型不存在');
  const now=new Date(),end=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1),start=new Date(end);start.setDate(start.getDate()-29);
  const date=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const key=brand+':'+date(end);let cached=cache.get(key);
  if(!cached||Date.now()>cached.until){
   const db=getDatabase(),period={periodStart:date(start),periodEnd:date(end)};
   const shops=selectBrandShops(db.prepare('SELECT id,displayName,shopName,normalizedShopName,status FROM sales_shops').all(),brand);
   const shopIds=new Set(shops.map(s=>s.id));
   const links=db.prepare('SELECT id,shopId FROM sales_links').all().filter(l=>shopIds.has(l.shopId));
   const linkIds=new Set(links.map(l=>l.id));
   // Pass an explicit shop-link scope. Never fall back to company-wide sales.
   const result=linkIds.size?queryContributions({...period,salesLinkIds:[...linkIds]},{database:db}):{items:[]};
   const sales=new Map(result.items.map(r=>[r.erpSkuId,r]));
   const membership=new Set([...sales].filter(([,r])=>r.totalPhysicalContribution>0).map(([id])=>id));
   if(linkIds.size){
    const relations=readRelations(db);
    for(const [id,ids] of relations.linksByErpSku)if([...ids].some(id=>linkIds.has(id)))membership.add(id);
   }
   const products=db.prepare(`SELECT s.id,s.id erpSkuId,s.erpGoodsId,s.currentState,s.merchantSkuCode sku,g.sourceCreatedAt,g.category,
    COALESCE(NULLIF(profile.displayNameOverride,''),NULLIF(p.name,''),g.goodsName,s.merchantSkuCode) name,
    COALESCE(NULLIF(s.mainImage,''),p.mainImage) image
    FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
    LEFT JOIN product_erp_mappings m ON m.id=(SELECT v.id FROM product_erp_mappings v WHERE v.erpSkuId=s.id AND v.currentState='active' ORDER BY v.updatedAt DESC,v.id DESC LIMIT 1)
    LEFT JOIN products p ON p.id=m.productId WHERE s.currentState='active'`).all().filter(p=>membership.has(p.id));
   const items=products.map(p=>({...p,sales:{totalPhysicalContribution:sales.get(p.id)?.totalPhysicalContribution??null}}));
   cached={items,period,shops:shops.map(s=>({id:s.id,name:s.displayName||s.shopName})),metadata:new Map(products.map(p=>[p.id,{...p,inBrandShop:true}])),until:Date.now()+60000};
   if(cache.size>30)cache.clear();cache.set(key,cached);
  }
  return {rows:rankContentRecommendations(cached.items,cached.metadata,{brand,kind,excludeFlowers}),brand,kind,shops:cached.shops,period:cached.period,newDateBasis:'ERP 原始建档日期',excludeFlowers};
 };
}
