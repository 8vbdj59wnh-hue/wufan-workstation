import crypto from "node:crypto";
import { getDatabase } from "./db.js";

export const linkContributionSchema = `
CREATE TABLE IF NOT EXISTS link_contribution_rules (
 id TEXT PRIMARY KEY, mode TEXT NOT NULL, thresholdsJson TEXT NOT NULL, firstRatingDate TEXT NOT NULL,
 createdBy TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS link_contribution_runs (
 id TEXT PRIMARY KEY, ruleId TEXT NOT NULL REFERENCES link_contribution_rules(id), ratingDate TEXT NOT NULL UNIQUE,
 periodStart TEXT NOT NULL, periodEnd TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS link_contribution_results (
 runId TEXT NOT NULL REFERENCES link_contribution_runs(id), salesLinkId TEXT NOT NULL REFERENCES sales_links(id),
 grade TEXT, error TEXT, profitAmount REAL, companyRank INTEGER, listedAt TEXT,
 PRIMARY KEY(runId,salesLinkId)
);
CREATE TABLE IF NOT EXISTS link_listing_dates (
 salesLinkId TEXT PRIMARY KEY REFERENCES sales_links(id), firstListedDate TEXT NOT NULL,
 source TEXT NOT NULL, updatedAt TEXT NOT NULL
);`;
const day = (date, offset) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+offset); return d.toISOString().slice(0,10); };
const today = () => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || "") && !Number.isNaN(Date.parse(date)) && day(date,0)===date;
export function readContribution(database=getDatabase()) {
 const rule=database.prepare("SELECT * FROM link_contribution_rules ORDER BY createdAt DESC,rowid DESC LIMIT 1").get();
 const run=database.prepare("SELECT * FROM link_contribution_runs ORDER BY ratingDate DESC LIMIT 1").get();
 return {rule:rule?{...rule,thresholds:JSON.parse(rule.thresholdsJson)}:null,run:run||null,
 history:database.prepare("SELECT id,ratingDate,periodStart,periodEnd,ruleId FROM link_contribution_runs ORDER BY ratingDate DESC").all(),
 results:run?database.prepare(`SELECT r.*,l.ownerId,l.title,l.platformGoodsId,s.platform,COALESCE(NULLIF(s.displayName,''),s.shopName) shopName
 FROM link_contribution_results r JOIN sales_links l ON l.id=r.salesLinkId JOIN sales_shops s ON s.id=l.shopId
 WHERE r.runId=? ORDER BY r.companyRank IS NULL,r.companyRank,l.id`).all(run.id):[]};
}
export function saveContributionRule(input,userId,database=getDatabase()) {
 const thresholds=["S","A","B","C"].map(k=>Number(input.thresholds?.[k]));
 if(!["rank_percentile","profit_share"].includes(input.mode) || thresholds.some((n,i)=>!Number.isFinite(n)||n<=0||n>=100||(i>0&&n<=thresholds[i-1]))) throw new Error("S/A/B/C累计边界必须递增且在0～100%之间。");
 if(!validDate(input.firstRatingDate)) throw new Error("请选择首次评级日期。");
 const prior=readContribution(database).rule;
 if(prior&&prior.firstRatingDate!==input.firstRatingDate&&readContribution(database).run) throw new Error("已有评级后不能修改周期起点。");
 const id=crypto.randomUUID();
 database.prepare("INSERT INTO link_contribution_rules VALUES (?,?,?,?,?,?)").run(id,input.mode,JSON.stringify(Object.fromEntries(["S","A","B","C"].map((k,i)=>[k,thresholds[i]]))),input.firstRatingDate,userId,new Date().toISOString());
 return readContribution(database);
}
export function classifyContribution(rows,rule,ratingDate) {
 const positives=rows.filter(r=>r.factRows>0&&r.profitAmount>0).sort((a,b)=>b.profitAmount-a.profitAmount||a.id.localeCompare(b.id));
 const ranks=new Map(); let rank=0,last=null;
 positives.forEach((r,i)=>{if(r.profitAmount!==last)rank=i+1;ranks.set(r.id,rank);last=r.profitAmount;});
 const eligible=positives.filter(r=>validDate(r.firstListedDate)&&r.firstListedDate<=ratingDate&&r.firstListedDate<day(ratingDate,-90));
 const total=eligible.reduce((n,r)=>n+r.profitAmount,0);
 const position=new Map();let cumulative=0,previousProfit=null,percentage=0;
 eligible.forEach((r,i)=>{if(r.profitAmount!==previousProfit)percentage=rule.mode==="profit_share"?cumulative/total*100:i/eligible.length*100;position.set(r.id,percentage);cumulative+=r.profitAmount;previousProfit=r.profitAmount;});
 return rows.map(r=>{
  let grade=null,error=null;
  if(!r.factRows||r.profitAmount===null)error="评级数据缺失";
  else if(!validDate(r.firstListedDate)||r.firstListedDate>ratingDate)error="上架日期缺失或无效";
  else if(r.firstListedDate>=day(ratingDate,-90))grade="N";
  else if(r.profitAmount<=0)grade="D";
  else grade=["S","A","B","C"].find(k=>position.get(r.id)<rule.thresholds[k])||"D";
  return {...r,grade,error,companyRank:ranks.get(r.id)||null};
 });
}
export function runDueContribution({database=getDatabase(),asOf=today()}={}) {
 const storedRule=database.prepare("SELECT * FROM link_contribution_rules ORDER BY createdAt DESC,rowid DESC LIMIT 1").get();
 const rule=storedRule?{...storedRule,thresholds:JSON.parse(storedRule.thresholdsJson)}:null;
 const run=database.prepare("SELECT * FROM link_contribution_runs ORDER BY ratingDate DESC LIMIT 1").get();
 if(!rule)return {skipped:"评级规则未设置"};
 const ratingDate=run?day(run.ratingDate,30):rule.firstRatingDate;
 if(ratingDate>asOf)return {skipped:"未到评级日期"};
 return database.transaction(()=>{
  if(database.prepare("SELECT id FROM link_contribution_runs WHERE ratingDate=?").get(ratingDate))return {skipped:"本周期已评级"};
  const periodEnd=day(ratingDate,-1),periodStart=day(periodEnd,-29);
  const coverage=database.prepare("SELECT COUNT(DISTINCT saleDate) n FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?").get(periodStart,periodEnd).n;
  if(coverage!==30)return {skipped:"评级周期日报日期不完整",periodStart,periodEnd};
  const rows=database.prepare(`SELECT l.id,d.firstListedDate,COUNT(f.id) factRows,SUM(f.profitAmount) profitAmount
   FROM sales_links l LEFT JOIN link_listing_dates d ON d.salesLinkId=l.id
   LEFT JOIN connection_sku_sales_daily_facts f ON f.salesLinkId=l.id AND f.saleDate BETWEEN ? AND ?
   WHERE l.currentState='active' GROUP BY l.id`).all(periodStart,periodEnd);
  const results=classifyContribution(rows,rule,ratingDate),id=crypto.randomUUID();
  database.prepare("INSERT INTO link_contribution_runs VALUES (?,?,?,?,?,?)").run(id,rule.id,ratingDate,periodStart,periodEnd,new Date().toISOString());
  const insert=database.prepare("INSERT INTO link_contribution_results VALUES (?,?,?,?,?,?,?)");
  results.forEach(r=>insert.run(id,r.id,r.grade,r.error,r.profitAmount,r.companyRank,r.firstListedDate||null));
  return {id,count:results.length,ratingDate};
 })();
}
export function readLinkContribution(id,database=getDatabase()) {
 const rule=database.prepare("SELECT id FROM link_contribution_rules LIMIT 1").get();
 const run=database.prepare("SELECT * FROM link_contribution_runs ORDER BY ratingDate DESC LIMIT 1").get();
 const model={rule,run},r=run?database.prepare("SELECT * FROM link_contribution_results WHERE runId=? AND salesLinkId=?").get(run.id,id):null;
 return {...r,evaluationStatus:r?.grade?"evaluated":"error",reason:r?.error||(model.rule?"尚未生成贡献评级":"评级规则未设置"),periodStart:model.run?.periodStart,periodEnd:model.run?.periodEnd};
}
