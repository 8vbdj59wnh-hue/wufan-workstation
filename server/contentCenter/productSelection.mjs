import {AppError} from './store.mjs';
export function createProductSelection(db,getCatalog){
 db.exec('CREATE TABLE IF NOT EXISTS content_product_selections(unit_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,body TEXT NOT NULL)');
 const brand=id=>{if(!getCatalog().units.some(u=>u.id===id&&u.kind==='品牌'))throw new AppError('请选择有效品牌');};
 const get=id=>{brand(id);const r=db.prepare('SELECT * FROM content_product_selections WHERE unit_id=?').get(id);return r?{unitId:id,revision:r.revision,updatedAt:r.updated_at,groups:JSON.parse(r.body)}:{unitId:id,revision:0,updatedAt:'',groups:{primary:[],secondary:[],new:[]}};};
 function put(id,input){
  brand(id);if(!input||!input.groups)throw new AppError('选品格式不正确');
  const groups={};
  for(const key of ['primary','secondary','new']){
   const items=input.groups[key];if(!Array.isArray(items)||items.length>100)throw new AppError('每组最多100个产品');
   const ids=new Set();groups[key]=items.map(item=>{
    if(!item||typeof item.productId!=='string'||!item.productId.trim()||item.productId.length>200||ids.has(item.productId))throw new AppError('产品无效或同组重复');
    if(typeof item.remark!=='string'||item.remark.length>1000)throw new AppError('选品备注最多1000字');
    ids.add(item.productId);return {productId:item.productId,remark:item.remark};
   });
  }
  return db.transaction(()=>{const old=get(id);if(input.revision!==old.revision)throw new AppError('选品已被他人更新，请重新加载后修改',409);
   db.prepare('INSERT INTO content_product_selections VALUES (?,?,?,?) ON CONFLICT(unit_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,body=excluded.body').run(id,old.revision+1,new Date().toISOString(),JSON.stringify(groups));return get(id);
  })();
 }
 return {get,put};
}
