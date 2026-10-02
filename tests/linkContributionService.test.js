import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {linkContributionSchema,classifyContribution,saveContributionRule,runDueContribution,readContribution} from '../server/linkContributionService.js';
import {readConnectionGoalCockpitSummary} from '../server/connectionGoalCockpitService.js';
const rule={mode:'rank_percentile',thresholds:{S:20,A:40,B:60,C:80}};
test('贡献分级：新品、缺失、亏损、同利润同级',()=>{
 const rows=[100,80,60,40,20].map((profitAmount,i)=>({id:String(i),factRows:1,profitAmount,firstListedDate:'2025-01-01'}));
 rows.push({id:'new',factRows:1,profitAmount:-1,firstListedDate:'2026-08-01'},
 {id:'loss',factRows:1,profitAmount:-1,firstListedDate:'2025-01-01'},
 {id:'zero',factRows:1,profitAmount:0,firstListedDate:'2025-01-01'},
 {id:'missing',factRows:0,profitAmount:null,firstListedDate:'2025-01-01'},
 {id:'date',factRows:1,profitAmount:1000,firstListedDate:null});
 const result=classifyContribution(rows,rule,'2026-10-01');
 assert.deepEqual(result.slice(0,5).map(r=>r.grade),['S','A','B','C','D']);
 assert.deepEqual(result.slice(5,8).map(r=>r.grade),['N','D','D']);
 assert.equal(result[8].error,'评级数据缺失');assert.equal(result[9].grade,null);
 const tied=classifyContribution([...rows.slice(0,5),{...rows[0],id:'tie'}],rule,'2026-10-01');
 assert.equal(tied[0].grade,tied.at(-1).grade);
 const shared=classifyContribution(rows.slice(0,5),{...rule,mode:'profit_share'},'2026-10-01');assert.equal(shared[0].grade,'S');
});
test('隔离数据库：30天周期、快照不可覆盖、规则版本及幂等',()=>{
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');
 db.exec(`CREATE TABLE sales_shops(id TEXT PRIMARY KEY,platform TEXT,displayName TEXT,shopName TEXT);
 CREATE TABLE sales_links(id TEXT PRIMARY KEY,shopId TEXT,title TEXT,platformGoodsId TEXT,currentState TEXT,ownerId TEXT);
 CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,salesLinkId TEXT,saleDate TEXT,profitAmount REAL);
 INSERT INTO sales_shops VALUES('shop','淘宝','','店');
 INSERT INTO sales_links VALUES('link','shop','商品','123','active','owner');`);
 db.exec(linkContributionSchema);db.exec(linkContributionSchema);
 db.prepare("INSERT INTO link_listing_dates VALUES ('link','2025-01-01','test','now')").run();
 for(let i=1;i<=30;i++)db.prepare('INSERT INTO connection_sku_sales_daily_facts VALUES (?,?,?,?)').run(String(i),'link',`2026-09-${String(i).padStart(2,'0')}`,i);
 const before=db.prepare('SELECT * FROM connection_sku_sales_daily_facts').all();
 assert.throws(()=>saveContributionRule({...rule,firstRatingDate:'bad'},'admin',db));
 saveContributionRule({...rule,firstRatingDate:'2026-10-01'},'admin',db);
 assert.equal(runDueContribution({database:db,asOf:'2026-09-30'}).skipped,'未到评级日期');
 assert.equal(runDueContribution({database:db,asOf:'2026-10-01'}).count,1);
 const snapshot=readContribution(db).results;
 assert.equal(readConnectionGoalCockpitSummary({}, {database:db,isAdmin:true}).gradeSummary.S,1);
 assert.equal(readConnectionGoalCockpitSummary({}, {database:db,userId:'other'}).totalLinks,0);
 assert.equal(runDueContribution({database:db,asOf:'2026-10-01'}).skipped,'未到评级日期');
 saveContributionRule({...rule,thresholds:{S:10,A:30,B:50,C:70},firstRatingDate:'2026-10-01'},'admin',db);
 assert.deepEqual(readContribution(db).results,snapshot);
 assert.deepEqual(db.prepare('SELECT * FROM connection_sku_sales_daily_facts').all(),before);
 for(let i=1;i<=30;i++)db.prepare('INSERT INTO connection_sku_sales_daily_facts VALUES (?,?,?,?)').run(`next-${i}`,'link',`2026-10-${String(i).padStart(2,'0')}`,i);
 assert.equal(runDueContribution({database:db,asOf:'2026-10-31'}).count,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM link_contribution_runs').get().n,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM link_contribution_results WHERE runId=?').get(snapshot[0].runId).n,1);
 assert.equal(runDueContribution({database:db,asOf:'2026-10-31'}).skipped,'未到评级日期');
 assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);db.close();
});
