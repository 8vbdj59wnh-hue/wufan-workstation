import crypto from 'node:crypto';
import { getDatabase } from './db.js';

function validate(db, shopId, direction) {
 if (!['listing','withdrawal'].includes(direction)) throw new Error('计划类型无效。');
 if (!db.prepare("SELECT id FROM sales_shops WHERE id=? AND status='active'").get(shopId)) throw new Error('店铺不存在或已停用。');
}
const linked = `EXISTS (SELECT 1 FROM sales_links l
 JOIN sales_link_skus ls ON ls.salesLinkId=l.id AND COALESCE(ls.currentState,'active')='active'
 JOIN sales_link_sku_sales_object_relations r ON r.linkSkuId=ls.id AND r.status='active'
 JOIN sales_object_structures st ON st.salesObjectId=r.salesObjectId AND st.status='active'
 JOIN sales_object_structure_components c ON c.structureId=st.id AND c.status='active'
 WHERE l.shopId=@shopId AND COALESCE(l.currentState,'active')='active' AND c.erpSkuId=s.id)`;
const productSelect = `SELECT s.id erpSkuId,s.merchantSkuCode skuCode,s.mainImage,
 COALESCE(NULLIF(p.displayNameOverride,''),NULLIF(g.goodsName,''),s.merchantSkuCode) productName
 FROM erp_skus s LEFT JOIN erp_goods g ON g.id=s.erpGoodsId
 LEFT JOIN product_business_profiles p ON p.erpSkuId=s.id`;

export function readProductShopPlans({shopId,direction='listing',query='',candidates=false,offset=0}={}, db=getDatabase()) {
 validate(db,shopId,direction);
 if (candidates) {
  const pageOffset=Math.max(0,Math.floor(Number(offset)||0));
  const rows=db.prepare(`${productSelect} WHERE COALESCE(s.currentState,'active')='active'
   AND NOT EXISTS(SELECT 1 FROM product_shop_plans plan WHERE plan.shopId=@shopId AND plan.erpSkuId=s.id)
   AND ${direction==='withdrawal'?linked:`NOT ${linked}`}
   AND (s.merchantSkuCode LIKE @query OR g.goodsName LIKE @query OR p.displayNameOverride LIKE @query)
   ORDER BY s.merchantSkuCode,s.id LIMIT 51 OFFSET @offset`).all({shopId,query:`%${String(query).trim().slice(0,100)}%`,offset:pageOffset});
  return {items:rows.slice(0,50),hasMore:rows.length>50,offset:pageOffset};
 }
 return {items:db.prepare(`${productSelect} JOIN product_shop_plans plan ON plan.erpSkuId=s.id
 WHERE plan.shopId=? AND plan.direction=? ORDER BY plan.createdAt DESC,plan.id`).all(shopId,direction)};
}
export function addProductShopPlans({shopId,direction,erpSkuIds}={},actor='',db=getDatabase()) {
 validate(db,shopId,direction);
 if(!Array.isArray(erpSkuIds)||!erpSkuIds.length||erpSkuIds.length>100||erpSkuIds.some(x=>typeof x!=='string'))throw new Error('请选择1至100个产品。');
 return db.transaction(()=>{
  const insert=db.prepare('INSERT OR IGNORE INTO product_shop_plans(id,shopId,erpSkuId,direction,createdBy,createdAt) VALUES(?,?,?,?,?,?)');
  let added=0;
  for(const id of new Set(erpSkuIds)){
   const sku=db.prepare(`SELECT s.id,${linked} linked FROM erp_skus s WHERE s.id=@id AND COALESCE(s.currentState,'active')='active'`).get({shopId,id});
   if(!sku)throw new Error('产品不存在或已停用。');
   const old=db.prepare('SELECT direction FROM product_shop_plans WHERE shopId=? AND erpSkuId=?').get(shopId,id);
   if(old){if(old.direction!==direction)throw new Error('产品已加入另一类计划，请先移出。');continue;}
   if(direction==='withdrawal'&&!sku.linked)throw new Error('预备下架只能选择当前店铺已关联的产品。');
   if(direction==='listing'&&sku.linked)throw new Error('产品已关联当前店铺，无需预备上架。');
   added+=insert.run(crypto.randomUUID(),shopId,id,direction,actor,new Date().toISOString()).changes;
  }
  return {added};
 })();
}
export function removeProductShopPlan({shopId,direction,erpSkuId},db=getDatabase()) {
 validate(db,shopId,direction);
 return {removed:db.prepare('DELETE FROM product_shop_plans WHERE shopId=? AND direction=? AND erpSkuId=?').run(shopId,direction,erpSkuId).changes};
}
