import DatabaseSync from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
export const contentStageOf = n => n.contentStage || (n.title && n.copyText && n.noteFormat && (n.requestKind !== 'bulk' || n.generationStatus === '已生成') ? 'candidate' : 'request');
export const statuses = ['草稿','已排期','已确认','已发布'];
export const priorities = ['高','中','低'];
export const copyStatuses = ['未开始','草稿中','待审核','已完成'];
const textFields = ['contentStage','workstationTemplateId','publishingAccountId','unitId','productCodes','account','column','topic','interest','product','materialSource','initialTitle','reason','priority','notes','date','time','goal','title','materialNeeds','imageScript','copyStatus','copyText','status','executionNumber','executionNotes','publishUrl','review','hashtags','noteFormat','templateId','pool','requestKind','generationStatus','preferredDate','preferredTime','generationError'];
const boolFields = ['missingMaterial','confirmedImport'];
const defaults = Object.fromEntries(textFields.map(k => [k,'']));
Object.assign(defaults,{account:'1',column:catalog.accounts[0].columns[0].name,priority:'中',copyStatus:'未开始',status:'草稿',pool:'schedule',noteFormat:'',templateId:'',productIds:[],images:[],missingMaterial:false,confirmedImport:false});
export class AppError extends Error { constructor(message, status=400){super(message);this.status=status;} }
export function createStore(filename) {
  const runtimeCatalog=structuredClone(catalog);
  if (filename !== ':memory:') mkdirSync(dirname(filename),{recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO metadata VALUES ('schema_version','1');
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, full_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS columns (account_id TEXT NOT NULL REFERENCES accounts(id), name TEXT NOT NULL, details TEXT NOT NULL, PRIMARY KEY(account_id,name));
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, column_name TEXT NOT NULL,
      status TEXT NOT NULL, planned_date TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      body TEXT NOT NULL CHECK(json_valid(body)),
      FOREIGN KEY(account_id,column_name) REFERENCES columns(account_id,name));
    CREATE INDEX IF NOT EXISTS idx_notes_planned_date ON notes(planned_date);
    CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);`);
  const seedCatalog = db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count === 0;
  if(seedCatalog) for(const a of runtimeCatalog.accounts){
    db.prepare('INSERT OR IGNORE INTO accounts VALUES (?,?,?)').run(a.id,a.name,a.fullName);
    for(const c of a.columns) db.prepare('INSERT OR IGNORE INTO columns VALUES (?,?,?)').run(a.id,c.name,JSON.stringify(c));
  }
  db.exec(`CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL); UPDATE metadata SET value='2' WHERE key='schema_version';`);
  db.exec(`CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, column_name TEXT NOT NULL, status TEXT NOT NULL, planned_date TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body))); UPDATE metadata SET value='3' WHERE key='schema_version';`);
  db.exec(`    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '启用');
    CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, account TEXT NOT NULL DEFAULT '', column_name TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
    UPDATE metadata SET value='3' WHERE key='schema_version';`);
  if(!db.prepare('PRAGMA table_info(products)').all().some(c=>c.name==='revision'))db.exec('ALTER TABLE products ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
  db.exec(`CREATE TABLE IF NOT EXISTS product_images (product_id TEXT NOT NULL REFERENCES products(id), image_id TEXT NOT NULL REFERENCES images(id), position INTEGER NOT NULL, PRIMARY KEY(product_id,image_id)); UPDATE metadata SET value='4' WHERE key='schema_version';`);
  db.exec(`CREATE TABLE IF NOT EXISTS business_units (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('品牌','部门')));

    CREATE TABLE IF NOT EXISTS account_units (account_id TEXT PRIMARY KEY REFERENCES accounts(id),unit_id TEXT NOT NULL REFERENCES business_units(id));`);
  if(seedCatalog) db.prepare("INSERT OR IGNORE INTO business_units VALUES ('banran','半然','品牌')").run();
  if(seedCatalog) for(const a of catalog.accounts)db.prepare('INSERT OR IGNORE INTO account_units VALUES (?,?)').run(a.id,'banran');
  if(!db.prepare('PRAGMA table_info(products)').all().some(c=>c.name==='unitId'))db.exec("ALTER TABLE products ADD COLUMN unitId TEXT NOT NULL DEFAULT ''; UPDATE products SET unitId='banran';");
  db.exec("UPDATE metadata SET value='5' WHERE key='schema_version'");
  function refreshCatalog(){
    runtimeCatalog.units=db.prepare('SELECT * FROM business_units ORDER BY name,id').all();
    runtimeCatalog.accounts=db.prepare(`SELECT a.id,a.name,a.full_name AS fullName,COALESCE(u.unit_id,'') AS unitId FROM accounts a LEFT JOIN account_units u ON u.account_id=a.id WHERE a.id<>'' AND a.name<>'' ORDER BY a.rowid`).all().map(a=>({...a,columns:db.prepare('SELECT name,details FROM columns WHERE account_id=? AND name<>? ORDER BY rowid').all(a.id,'').map(c=>({...JSON.parse(c.details),name:c.name}))}));
  }
  refreshCatalog();
  function addConfiguration(kind,input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('配置格式不正确');
    const name=typeof input.name==='string'?input.name.trim():'';if(!name||name.length>100)throw new AppError('请填写名称（最多100字）');
    db.exec('SAVEPOINT configuration');
    try{let id;
      if(kind==='units'){
        if(!['品牌','部门'].includes(input.kind))throw new AppError('请选择品牌或部门');
        if(db.prepare('SELECT id FROM business_units WHERE name=?').get(name))throw new AppError('该分组已存在',409);
        id=randomUUID();db.prepare('INSERT INTO business_units VALUES (?,?,?)').run(id,name,input.kind);
      }else if(kind==='accounts'){
        if(typeof input.unitId!=='string'||!db.prepare('SELECT id FROM business_units WHERE id=?').get(input.unitId))throw new AppError('请选择业务分组');
        if(db.prepare('SELECT a.id FROM accounts a JOIN account_units u ON u.account_id=a.id WHERE a.name=? AND u.unit_id=?').get(name,input.unitId))throw new AppError('该分组已有同名账号',409);
        if(!Array.isArray(input.columns)||!input.columns.length||input.columns.length>50||input.columns.some(c=>typeof c!=='string'||!c.trim()||c.trim().length>100))throw new AppError('请填写1–50个栏目，每个最多100字');
        const cols=[...new Set(input.columns.map(c=>c.trim()))];id=randomUUID();db.prepare('INSERT INTO accounts VALUES (?,?,?)').run(id,name,name);db.prepare('INSERT INTO account_units VALUES (?,?)').run(id,input.unitId);
        for(const c of cols)db.prepare('INSERT INTO columns VALUES (?,?,?)').run(id,c,JSON.stringify({name:c}));
      }else if(kind==='columns'){
        if(typeof input.accountId!=='string'||!runtimeCatalog.accounts.some(a=>a.id===input.accountId))throw new AppError('请选择账号');
        if(db.prepare('SELECT name FROM columns WHERE account_id=? AND name=?').get(input.accountId,name))throw new AppError('该账号已有同名栏目',409);
        id=input.accountId;db.prepare('INSERT INTO columns VALUES (?,?,?)').run(id,name,JSON.stringify({name}));
      }else throw new AppError('配置类型不正确');
      db.exec('RELEASE configuration');refreshCatalog();return {id,catalog:structuredClone(runtimeCatalog)};
    }catch(e){db.exec('ROLLBACK TO configuration; RELEASE configuration');throw e;}
  }
  function editConfiguration(kind,id,input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('配置格式不正确');
    const name=typeof input.name==='string'?input.name.trim():'';
    if(!name||name.length>100)throw new AppError('名称需填写1–100个字');
    db.transaction(()=>{
      const account=db.prepare('SELECT a.*,u.unit_id FROM accounts a LEFT JOIN account_units u ON u.account_id=a.id WHERE a.id=?').get(id);
      if(!account||!id)throw new AppError('账号不存在',404);
      const now=new Date().toISOString();
      if(kind==='accounts'){
        if(input.expectedName!==account.name||input.expectedUnitId!==(account.unit_id||''))throw new AppError('账号已被修改，请关闭后刷新再试',409);
        if(typeof input.unitId!=='string'||!db.prepare('SELECT id FROM business_units WHERE id=?').get(input.unitId))throw new AppError('请选择有效品牌');
        if(db.prepare('SELECT a.id FROM accounts a JOIN account_units u ON u.account_id=a.id WHERE a.name=? AND u.unit_id=? AND a.id<>?').get(name,input.unitId,id))throw new AppError('该品牌已有同名账号',409);
        db.prepare('UPDATE accounts SET name=?,full_name=CASE WHEN full_name=name THEN ? ELSE full_name END WHERE id=?').run(name,name,id);
        db.prepare('INSERT INTO account_units VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET unit_id=excluded.unit_id').run(id,input.unitId);
        if(input.unitId!==account.unit_id)for(const table of ['notes','candidates'])db.prepare(`UPDATE ${table} SET body=json_set(body,'$.unitId',?),revision=revision+1,updated_at=? WHERE account_id=?`).run(input.unitId,now,id);
      }else if(kind==='columns'){
        if(typeof input.oldName!=='string'||!input.oldName)throw new AppError('请选择原栏目');
        const old=db.prepare('SELECT details FROM columns WHERE account_id=? AND name=?').get(id,input.oldName);
        if(!old)throw new AppError('栏目已被修改，请关闭后刷新再试',409);
        if(name===input.oldName)return;
        if(db.prepare('SELECT name FROM columns WHERE account_id=? AND name=?').get(id,name))throw new AppError('该账号已有同名栏目',409);
        db.prepare('INSERT INTO columns VALUES (?,?,?)').run(id,name,JSON.stringify({...JSON.parse(old.details),name}));
        for(const table of ['notes','candidates'])db.prepare(`UPDATE ${table} SET column_name=?,body=json_set(body,'$.column',?),revision=revision+1,updated_at=? WHERE account_id=? AND column_name=?`).run(name,name,now,id,input.oldName);
        db.prepare('UPDATE templates SET column_name=? WHERE account=? AND column_name=?').run(name,id,input.oldName);
        db.prepare('DELETE FROM columns WHERE account_id=? AND name=?').run(id,input.oldName);
      }else throw new AppError('配置类型不正确');
    })();
    refreshCatalog();return {id,catalog:structuredClone(runtimeCatalog)};
  }
  const productImageIds=id=>db.prepare('SELECT image_id FROM product_images WHERE product_id=? ORDER BY position,image_id').all(id).map(r=>r.image_id);
  const getProduct=id=>{const p=db.prepare('SELECT * FROM products WHERE id=?').get(id);return p?{...p,imageIds:productImageIds(id)}:null;};
  const listProducts=()=>db.prepare('SELECT * FROM products ORDER BY sku COLLATE NOCASE,name,id').all().map(p=>({...p,imageIds:productImageIds(p.id)}));
  function saveProduct(input,id){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('产品格式不正确');
    db.exec('SAVEPOINT product_save');
    try{
      const old=id?getProduct(id):null;if(id&&!old)throw new AppError('产品不存在',404);
      if(old&&input.revision!==old.revision)throw new AppError('产品已在其他窗口更新，请重新打开后再试',409);
      const p={name:'',sku:'',status:'启用',unitId:'',imageIds:[],...old};
      for(const k of ['name','sku','status','unitId'])if(Object.hasOwn(input,k)){if(typeof input[k]!=='string'||input[k].length>2000)throw new AppError('产品字段格式不正确');p[k]=input[k].trim();}
      if(p.unitId&&!db.prepare('SELECT id FROM business_units WHERE id=?').get(p.unitId))throw new AppError('业务分组不存在');
      if(!p.name)throw new AppError('请填写产品名称');
      if(!['启用','停用'].includes(p.status))throw new AppError('产品状态不正确');
      if(p.sku&&db.prepare('SELECT id FROM products WHERE sku=? COLLATE NOCASE AND id<>?').get(p.sku,id||''))throw new AppError('该产品编码已存在，请编辑已有产品',409);
      if(Object.hasOwn(input,'imageIds')){if(!Array.isArray(input.imageIds)||input.imageIds.length>50||input.imageIds.some(x=>typeof x!=='string'||!db.prepare('SELECT id FROM images WHERE id=?').get(x)))throw new AppError('产品图片无效，每个产品最多 50 张');p.imageIds=[...new Set(input.imageIds)];}
      p.id=id||randomUUID();p.revision=(old?.revision||0)+1;
      db.prepare(`INSERT INTO products (id,name,sku,status,revision,unitId) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku=excluded.sku,status=excluded.status,revision=excluded.revision,unitId=excluded.unitId`).run(p.id,p.name,p.sku,p.status,p.revision,p.unitId);
      db.prepare('DELETE FROM product_images WHERE product_id=?').run(p.id);
      p.imageIds.forEach((image,i)=>db.prepare('INSERT INTO product_images VALUES (?,?,?)').run(p.id,image,i));
      db.exec('RELEASE product_save');return p;
    }catch(e){db.exec('ROLLBACK TO product_save; RELEASE product_save');throw e;}
  }
  function importProducts(items){
    if(!Array.isArray(items)||!items.length)throw new AppError('没有待导入产品');
    db.exec('BEGIN IMMEDIATE');
    try{let created=0,updated=0,skipped=0,imagesAdded=0;const seen=new Set();
      for(const item of items){if(!item.sku||seen.has(item.sku.toLowerCase()))throw new AppError('导入编码为空或重复');seen.add(item.sku.toLowerCase());
        const matches=db.prepare('SELECT id FROM products WHERE sku=? COLLATE NOCASE').all(item.sku);
        if(matches.length>1)throw new AppError('已有重复编码：'+item.sku);
        const old=matches.length?getProduct(matches[0].id):null;
        if(old&&old.name!==item.name)throw new AppError('已有产品名称不一致：'+item.sku);
        const ids=[...(old?.imageIds||[])];
        for(const img of item.images){const bytes=Buffer.from(img.data.split(',')[1]||'','base64');const exists=ids.some(id=>{const stored=getImage(id);return stored.name===img.name&&Buffer.from(stored.bytes).equals(bytes);});if(!exists){ids.push(addImage(img).id);imagesAdded++;}}
        if(old&&JSON.stringify(ids)===JSON.stringify(old.imageIds)){skipped++;continue;}
        saveProduct({name:item.name,sku:item.sku,imageIds:ids,unitId:old?.unitId??item.unitId??'',...(old?{revision:old.revision}:{})},old?.id);old?updated++:created++;
      }
      db.exec('COMMIT');return {created,updated,skipped,imagesAdded};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  const listTemplates=()=>db.prepare('SELECT id,name,account,column_name AS "column",notes FROM templates ORDER BY name,id').all();
  function addReference(kind,input){
    if(kind==='products')return saveProduct(input);
    if(!input || typeof input!=='object') throw new AppError('关联资料格式不正确');
    const fields=kind==='products'?['name','sku','status']:['name','account','column','notes'];
    const values=fields.map(k=>{const v=input[k]??(k==='status'?'启用':'');if(typeof v!=='string'||v.length>2000)throw new AppError('资料字段不正确');return v.trim();});
    if(!values[0])throw new AppError('请填写名称');
    if(kind==='products'&&!['启用','停用'].includes(values[2]))throw new AppError('产品状态不正确');
    if(kind==='templates'&&((values[1]&&!runtimeCatalog.accounts.some(a=>a.id===values[1]))||(values[2]&&!runtimeCatalog.accounts.find(a=>a.id===values[1])?.columns.some(c=>c.name===values[2]))))throw new AppError('模板账号栏目不正确');
    const id=randomUUID();
    db.prepare(`INSERT INTO ${kind} VALUES (${[id,...values].map(()=>'?').join(',')})`).run(id,...values);
    return (kind==='products'?listProducts():listTemplates()).find(x=>x.id===id);
  }
  const decode = row => {
    if(!row) return null;
    const n=JSON.parse(row.body);
    const mapped={'候选':'草稿','待素材':'已排期','待文案':'已排期','待审核':'已排期','已确认执行':'已确认','已复盘':'已发布'};
    const content=(n.copyText||'').replaceAll('\\n','\n');
    const match=!Object.hasOwn(n,'hashtags') && content.match(/(?:^|\n)\s*((?:#[^\s#]+\s*)+)$/);
    return {...n,pool:n.pool||(n.status==='候选'?'candidate':'schedule'),noteFormat:n.noteFormat||'',productIds:n.productIds||[],productCodes:n.productCodes??(n.productIds||[]).map(id=>getProduct(id)?.sku||'').filter(Boolean).join('、'),templateId:n.templateId||'',title:n.title||n.initialTitle||n.topic||'',copyText:match?content.slice(0,match.index).trimEnd():content,hashtags:n.hashtags??match?.[1]?.trim()??'',images:n.images||[],...(mapped[n.status]?{legacyStatus:n.legacyStatus||n.status}:{}),status:mapped[n.status]||n.status,id:row.id,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};
  };
  const get = id => decode(db.prepare('SELECT * FROM notes WHERE id=?').get(id)||db.prepare('SELECT * FROM candidates WHERE id=?').get(id));
  const list = () => db.prepare('SELECT * FROM notes UNION ALL SELECT * FROM candidates ORDER BY planned_date,created_at DESC').all().map(decode);
  function normalize(input, old) {
    if(!input || typeof input!=='object' || Array.isArray(input)) throw new AppError('内容格式不正确');
    const n = {...(old || defaults)};
    if(!old&&input.pool==='candidate'){n.account='';n.column='';}
    if(!old && input.status==='候选') Object.assign(n,{account:'',column:'',date:'',time:'',pool:'candidate'});
    for(const k of textFields) if(Object.hasOwn(input,k)) {
      if(typeof input[k]!=='string' || input[k].length>20000) throw new AppError('字段格式不正确或过长：'+k);
      n[k]=input[k].trim();
    }
    if(Object.hasOwn(input,'productCodes')){n.productCodes=[...new Set(n.productCodes.split(/[、,，;；\s]+/).filter(Boolean))].join('、');if(old&&n.productCodes!==old.productCodes)n.productIds=[];}
    for(const k of boolFields) if(Object.hasOwn(input,k)) {
      if(typeof input[k]!=='boolean') throw new AppError('字段需要是勾选值：'+k);
      n[k]=input[k];
    }
    if(old && n.requestKind!==old.requestKind) throw new AppError('不能改变需求类型');
    if(!['',undefined,'bulk'].includes(n.requestKind)) throw new AppError('需求类型不正确');
    const request=n.requestKind==='bulk';
    if(request){
      if(!old && !n.generationStatus)n.generationStatus='待生成';
      if(!['待生成','已生成','需调整'].includes(n.generationStatus))throw new AppError('生成状态不正确');
      if(old?.generationStatus==='已生成' && !Object.hasOwn(input,'generationStatus') && ['account','column','productIds','productCodes','noteFormat','notes'].some(k=>Object.hasOwn(input,k)&&JSON.stringify(input[k])!==JSON.stringify(old[k])))n.generationStatus='需调整';
      if(n.generationStatus==='已生成' && (!n.title||!n.copyText||!n.hashtags))throw new AppError('已生成需求必须有标题、正文和话题');
      if(n.preferredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(n.preferredDate)||!Number.isFinite(Date.parse(n.preferredDate))||new Date(n.preferredDate).toISOString().slice(0,10)!==n.preferredDate))throw new AppError('期望日期不正确');
      if(n.preferredTime && (!n.preferredDate||!/^([01]\d|2[0-3]):[0-5]\d$/.test(n.preferredTime)))throw new AppError('请填写有效的期望日期和时间');
      if(old?.pool==='candidate'&&n.pool==='schedule'){
        if(n.generationStatus!=='已生成')throw new AppError('请先完成生成或调整，再加入排期');
        if(!Object.hasOwn(input,'date'))n.date=n.preferredDate||'';
        if(!Object.hasOwn(input,'time'))n.time=n.preferredTime||'';
      }
    }
    if(n.contentStage && !['request','candidate'].includes(n.contentStage)) throw new AppError('内容阶段不正确');
    if(n.contentStage==='candidate' && (!n.title||!n.copyText||!n.noteFormat)) throw new AppError('请补齐标题、正文和笔记形式，再存入内容候选');
    if(n.pool==='schedule' && n.contentStage==='request') throw new AppError('请先将完整内容存入内容候选，再加入排期');
    const candidate=n.pool==='candidate';
    if(!['candidate','schedule'].includes(n.pool))throw new AppError('内容归属不正确');
    if(old && old.pool!=='candidate' && candidate)throw new AppError('正式笔记不能转回候选池');
    if(old?.pool==='candidate'&&!candidate)n.status='已排期';
    const a=runtimeCatalog.accounts.find(a=>a.id===n.account);
    if(a)n.unitId=a.unitId;
    if(n.unitId&&!runtimeCatalog.units.some(u=>u.id===n.unitId))throw new AppError('请选择有效品牌');
    if(candidate ? ((n.account&&!a)||(n.column&&!a?.columns.some(c=>c.name===n.column))) : !a?.columns.some(c=>c.name===n.column))throw new AppError('请选择该账号已确认的固定栏目');
    if(request&&!a?.columns.some(c=>c.name===n.column))throw new AppError('需求必须选择账号和固定栏目');
    if(candidate)n.status='草稿';
    if(!statuses.includes(n.status))throw new AppError('状态不正确');
    if(!n.title&&!(candidate&&n.contentStage==='request'&&n.notes)&&!(request&&candidate&&n.generationStatus!=='已生成'))throw new AppError('请填写标题');
    for(const [key,label] of [['copyText','正文'],['date','排期日期'],['time','排期时间']]) {
      if(!candidate && (!old || old.pool==='candidate' || Object.hasOwn(input,key)) && !n[key])throw new AppError('请填写'+label);
    }
    if(candidate){n.date='';n.time='';n.status='草稿';}
    if(!['','图文','视频'].includes(n.noteFormat))throw new AppError('笔记形式不正确');
    if(Object.hasOwn(input,'workstationProductIds')) {
      if(!Array.isArray(input.workstationProductIds)||input.workstationProductIds.length>100||input.workstationProductIds.some(id=>typeof id!=='string'||!id||id.length>200))throw new AppError('工作站产品关联格式无效');
      n.workstationProductIds=[...new Set(input.workstationProductIds)];
    }
    if(Object.hasOwn(input,'productIds')) {
      if(!Array.isArray(input.productIds)||input.productIds.length>100||input.productIds.some(id=>typeof id!=='string'||!db.prepare('SELECT id FROM products WHERE id=?').get(id)))throw new AppError('关联产品无效');
      n.productIds=[...new Set(input.productIds)];
      if(!Object.hasOwn(input,'productCodes'))n.productCodes=n.productIds.map(id=>getProduct(id)?.sku||'').filter(Boolean).join('、');
    }
    if(n.templateId&&!db.prepare('SELECT id FROM templates WHERE id=?').get(n.templateId))throw new AppError('关联模板无效');
    if(n.date && (!/^\d{4}-\d{2}-\d{2}$/.test(n.date) || !Number.isFinite(Date.parse(n.date)) || new Date(n.date).toISOString().slice(0,10)!==n.date)) throw new AppError('排期日期不正确');
    if(n.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(n.time)) throw new AppError('排期时间不正确');
    if(n.preferredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(n.preferredDate) || !Number.isFinite(Date.parse(n.preferredDate)) || new Date(n.preferredDate).toISOString().slice(0,10)!==n.preferredDate)) throw new AppError('计划发布日期不正确');
    if(n.preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(n.preferredTime)) throw new AppError('计划发布时间不正确');
    if(Object.hasOwn(input,'images')) {
      if(!Array.isArray(input.images)||input.images.length>20||input.images.some(id=>typeof id!=='string'||!db.prepare('SELECT id FROM images WHERE id=?').get(id))) throw new AppError('参考图无效，每篇最多 20 张');
      n.images=[...new Set(input.images)];
    }
    return n;
  }
  function save(input,id){
    const old=id ? get(id) : null;
    if(id && !old) throw new AppError('内容不存在',404);
    if(old && input.revision!==old.revision) throw new AppError('这条内容已在其他窗口更新，请关闭编辑并刷新后再试',409);
    const n=normalize(input,old), now=new Date().toISOString();
    const record={...n,id:old?.id||randomUUID(),revision:(old?.revision||0)+1,createdAt:old?.createdAt||now,updatedAt:now};
    const table=n.pool==='candidate'?'candidates':'notes';
    db.exec('SAVEPOINT save_note');
    try {
    db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      account_id=excluded.account_id,column_name=excluded.column_name,status=excluded.status,planned_date=excluded.planned_date,
      revision=excluded.revision,updated_at=excluded.updated_at,body=excluded.body`).run(record.id,n.account,n.column,n.status,n.date,record.revision,record.createdAt,now,JSON.stringify(record));
    db.prepare(`DELETE FROM ${table==='notes'?'candidates':'notes'} WHERE id=?`).run(record.id);
    db.exec('RELEASE save_note');
    } catch(e) { db.exec('ROLLBACK TO save_note; RELEASE save_note'); throw e; }
    return record;
  }
  function getRequest(id){const n=get(id);if(!n||n.requestKind!=='bulk')throw new AppError('需求不存在',404);return n;}
  function listRequests(state){
    if(state&&!['待生成','已生成','需调整'].includes(state))throw new AppError('生成状态不正确');
    return list().filter(n=>n.requestKind==='bulk'&&n.pool==='candidate'&&(!state||n.generationStatus===state));
  }
  function createRequests(items){
    if(!Array.isArray(items)||!items.length||items.length>100)throw new AppError('请一次填写 1–100 条需求');
    db.exec('BEGIN IMMEDIATE');
    try{const result=items.map((input,i)=>{
      if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(`第 ${i+1} 行格式不正确`);
      const allowed=['account','column','productIds','productCodes','noteFormat','preferredDate','preferredTime','notes'];
      try{return save({...Object.fromEntries(allowed.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]])),pool:'candidate',requestKind:'bulk',generationStatus:'待生成'});}
      catch(e){if(e.status)e.message=`第 ${i+1} 行：${e.message}`;throw e;}
    });db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
  }
  function updateRequest(id,input){
    const old=getRequest(id);if(old.pool!=='candidate')throw new AppError('需求已加入排期，请从正式笔记编辑',409);
    const allowed=['revision','title','copyText','hashtags','generationStatus','generationError','account','column','productIds','productCodes','noteFormat','preferredDate','preferredTime','notes'];
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw new AppError('需求更新字段不正确');
    return save(input,id);
  }
  function scheduleRequest(id,input){
    const old=getRequest(id);if(old.pool!=='candidate')throw new AppError('需求已加入排期',409);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['revision','date','time'].includes(k)))throw new AppError('排期字段不正确');
    return save({...input,pool:'schedule'},id);
  }
  function batch(items,patch){
    if(!Array.isArray(items)||!items.length||items.length>500||new Set(items.map(x=>x.id)).size!==items.length) throw new AppError('请选择 1–500 条不同的内容');
    db.exec('BEGIN IMMEDIATE');
    try {const result=items.map(x=>save({...patch,revision:x.revision},x.id)); db.exec('COMMIT');return result;}
    catch(e){db.exec('ROLLBACK');throw e;}
  }
  function addImage(input) {
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>200) throw new AppError('图片名称不正确');
    const match=typeof input.data==='string' && input.data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match) throw new AppError('支持 PNG、JPEG、WebP、GIF 图片');
    const bytes=Buffer.from(match[2],'base64'),mime=match[1];
    if(!bytes.length||bytes.length>8*1024*1024) throw new AppError('每张图片最大 8 MB');
    const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/gif'?['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!valid) throw new AppError('图片格式与文件内容不一致');
    const id=randomUUID(),createdAt=new Date().toISOString();
    db.prepare('INSERT INTO images VALUES (?,?,?,?,?)').run(id,input.name,mime,bytes,createdAt);
    return {id,name:input.name,mime,createdAt};
  }
  const listImages=()=>db.prepare('SELECT id,name,mime,created_at AS createdAt FROM images ORDER BY created_at DESC').all();
  const getImage=id=>db.prepare('SELECT * FROM images WHERE id=?').get(id);
  const backupImages=()=>listImages().map(i=>({...i,data:'data:'+i.mime+';base64,'+Buffer.from(getImage(i.id).bytes).toString('base64')}));
  const rawNotes=()=>db.prepare('SELECT body FROM notes UNION ALL SELECT body FROM candidates').all().map(r=>JSON.parse(r.body));
  return {getCatalog:()=>structuredClone(runtimeCatalog),addConfiguration,editConfiguration,getProduct,saveProduct,importProducts,getRequest,listRequests,createRequests,updateRequest,scheduleRequest,listProducts,listTemplates,addReference,get,list,save,batch,addImage,listImages,getImage,backupImages,rawNotes,close:()=>db.close()};
}
