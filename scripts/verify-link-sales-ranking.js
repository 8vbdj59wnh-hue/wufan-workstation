import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-link-ranking-"));
const databasePath = path.join(tempDir, "isolated.db");
process.env.WUFAN_DB_PATH = databasePath;

const database = new Database(databasePath);
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE persons (id TEXT PRIMARY KEY,name TEXT);
  CREATE TABLE sales_shops (id TEXT PRIMARY KEY,platform TEXT,displayName TEXT,shopName TEXT);
  CREATE TABLE sales_links (id TEXT PRIMARY KEY,shopId TEXT,platformGoodsId TEXT,canonicalUrl TEXT,FOREIGN KEY(shopId) REFERENCES sales_shops(id));
  CREATE TABLE connection_profiles (id TEXT PRIMARY KEY,salesLinkId TEXT,ownerId TEXT,name TEXT,mainImage TEXT,FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),FOREIGN KEY(ownerId) REFERENCES persons(id));
  CREATE TABLE connection_sku_sales_facts (id TEXT PRIMARY KEY,salesLinkId TEXT,periodStart TEXT,periodEnd TEXT,salesAmount REAL,shippedQuantity REAL,FOREIGN KEY(salesLinkId) REFERENCES sales_links(id));
`);
database.prepare("INSERT INTO persons VALUES (?,?)").run("person-a", "运营甲");
database.prepare("INSERT INTO persons VALUES (?,?)").run("person-b", "运营乙");
database.prepare("INSERT INTO sales_shops VALUES (?,?,?,?)").run("shop-a", "天猫", "点意旗舰店", "点意旗舰店");
for (const [id, goodsId] of [["link-a", "1001"], ["link-b", "1002"]]) {
  database.prepare("INSERT INTO sales_links VALUES (?,?,?,?)").run(id, "shop-a", goodsId, `https://example.test/${goodsId}`);
}
database.prepare("INSERT INTO connection_profiles VALUES (?,?,?,?,?)").run("connection-a", "link-a", "person-a", "链接A", null);
database.prepare("INSERT INTO connection_profiles VALUES (?,?,?,?,?)").run("connection-b", "link-b", "person-b", "链接B", null);
database.prepare("INSERT INTO connection_sku_sales_facts VALUES (?,?,?,?,?,?)").run("fact-a", "link-a", "2026-08-01T00:00:00.000Z", "2026-08-01T23:59:59.999Z", 200, 2);
database.prepare("INSERT INTO connection_sku_sales_facts VALUES (?,?,?,?,?,?)").run("fact-b", "link-b", "2026-08-01T00:00:00.000Z", "2026-08-01T23:59:59.999Z", 500, 5);
database.close();

const { getLinkSalesRanking } = await import("../server/linkSalesRankingService.js");
const mine = getLinkSalesRanking({ scope: "mine", preset: "custom", startDate: "2026-08-01", endDate: "2026-08-01" }, "person-a", false);
if (mine.items.length !== 1 || mine.items[0].connectionId !== "connection-a" || mine.summary.salesAmount !== 200) throw new Error("mine 范围验证失败。");
const company = getLinkSalesRanking({ scope: "company", preset: "custom", startDate: "2026-08-01", endDate: "2026-08-01" }, "person-a", true);
if (company.items.length !== 2 || company.items[0].connectionId !== "connection-b" || company.summary.salesAmount !== 700) throw new Error("company 排行验证失败。");
let forbidden = false;
try { getLinkSalesRanking({ scope: "company", preset: "7d" }, "person-a", false); } catch (error) { forbidden = error.statusCode === 403; }
if (!forbidden) throw new Error("company 权限验证失败。");
await import("../src/uiModules/linkSalesRanking.js");
const { getUiModule, renderUiModule } = await import("../src/uiModuleRegistry.js");
const registered = getUiModule("link_sales_ranking");
if (!registered || registered.domain !== "business_links") throw new Error("Module Registry 注册验证失败。");
const html = renderUiModule("link_sales_ranking", { state: company, canViewCompany: true });
if (!html.includes("链接B") || !html.includes("公司全部链接") || !html.includes("data-link-ranking-filter")) throw new Error("标准模块渲染验证失败。");
const check = new Database(databasePath, { readonly: true });
if (check.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("integrity_check 失败。");
if (check.pragma("foreign_key_check").length) throw new Error("foreign_key_check 失败。");
check.close();
console.log(JSON.stringify({ mine: mine.summary, company: company.summary, module: registered.moduleKey, integrityCheck: "ok", foreignKeyCheck: 0 }));
