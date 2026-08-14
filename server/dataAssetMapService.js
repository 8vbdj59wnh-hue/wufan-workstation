import { getDatabase } from "./modules/database/index.js";

const sources = [
  { id: "platform-goods-file", name: "平台货品表", type: "file", purpose: "同步平台链接、链接 SKU 与销售对象身份", status: "active", tables: ["platform_goods_excel_import_rows"], upstream: [], downstream: ["sales-link", "link-sku", "sales-object"] },
  { id: "platform-operation-file", name: "平台经营数据表", type: "file", purpose: "同步链接流量、支付与转化表现", status: "active", tables: ["connection_period_snapshots"], upstream: [], downstream: ["platform-performance"] },
  { id: "sales-daily-file", name: "链接利润表（SKU明细）", type: "file", purpose: "写入销售、成本与利润日报事实", status: "active", tables: ["connection_sku_sales_daily_facts"], upstream: [], downstream: ["sales-daily-fact"] },
  { id: "combo-detail-file", name: "组合装明细", type: "file", purpose: "定义组合销售对象的 ERP SKU 组件与数量", status: "active", tables: ["sales_object_structure_components"], upstream: [], downstream: ["sales-object"] },
  { id: "wangdian-goods-api", name: "旺店通货品档案 API", type: "api", purpose: "同步 ERP Goods 与 ERP SKU 主数据", status: "active", tables: ["erp_goods", "erp_skus"], upstream: [], downstream: ["erp-sku"] },
  { id: "wangdian-inventory-api", name: "旺店通库存 API", type: "api", purpose: "同步 ERP SKU 库存事实", status: "active", tables: ["erp_sku_warehouse_inventory_facts", "erp_fact_snapshots"], upstream: [], downstream: ["inventory-fact"] },
  { id: "product-profile", name: "产品档案", type: "internal", purpose: "维护企业产品经营档案", status: "active", tables: ["products", "product_erp_mappings"], upstream: ["erp-sku"], downstream: ["product"] },
  { id: "workstation-work", name: "极简工作站业务录入", type: "internal", purpose: "记录目标、关键行动、任务和工作结果", status: "active", tables: ["goals", "process_instances", "tasks"], upstream: [], downstream: ["goal", "key-action", "task"] },
];

const objects = [
  { id: "sales-link", name: "Link", definition: "渠道中的链接经营单元。", type: "master", truthStatus: "source_of_truth", tables: ["sales_links"], sources: ["platform-goods-file"], upstream: ["platform-goods-file"], downstream: ["link-sku", "platform-performance", "sales-daily-fact"] },
  { id: "link-sku", name: "Link SKU", definition: "链接下的平台销售规格。", type: "master", truthStatus: "source_of_truth", tables: ["sales_link_skus"], sources: ["platform-goods-file"], upstream: ["sales-link"], downstream: ["sales-object", "sales-daily-fact"] },
  { id: "sales-object", name: "Sales Object", definition: "平台实际销售单位，统一表达单品与组合装。", type: "master", truthStatus: "source_of_truth", tables: ["sales_objects", "sales_link_sku_sales_object_relations", "sales_object_structures", "sales_object_structure_components"], sources: ["platform-goods-file", "combo-detail-file"], upstream: ["link-sku"], downstream: ["erp-sku"] },
  { id: "erp-sku", name: "ERP SKU", definition: "旺店通中的企业货品规格身份。", type: "master", truthStatus: "source_of_truth", tables: ["erp_skus"], sources: ["wangdian-goods-api"], upstream: ["sales-object", "wangdian-goods-api"], downstream: ["product", "inventory-fact"] },
  { id: "product", name: "Product", definition: "企业产品经营档案。", type: "master", truthStatus: "source_of_truth", tables: ["products", "product_erp_mappings"], sources: ["product-profile"], upstream: ["erp-sku"], downstream: ["product-workspace"] },
  { id: "sales-daily-fact", name: "销售日报事实", definition: "按销售发生日期记录销量、销售额、成本和利润。", type: "fact", truthStatus: "source_of_truth", tables: ["connection_sku_sales_daily_facts"], sources: ["sales-daily-file"], upstream: ["sales-daily-file", "link-sku"], downstream: ["sales-analysis", "product-workspace"] },
  { id: "platform-performance", name: "平台经营表现", definition: "链接流量、支付与转化的周期事实。", type: "fact", truthStatus: "source_of_truth", tables: ["connection_period_snapshots"], sources: ["platform-operation-file"], upstream: ["platform-operation-file", "sales-link"], downstream: ["sales-analysis"] },
  { id: "inventory-fact", name: "ERP库存事实", definition: "ERP SKU 在仓库维度的库存事实。", type: "fact", truthStatus: "source_of_truth", tables: ["erp_sku_warehouse_inventory_facts", "erp_fact_snapshots"], sources: ["wangdian-inventory-api"], upstream: ["wangdian-inventory-api", "erp-sku"], downstream: ["product-workspace"] },
  { id: "sales-analysis", name: "销售经营分析", definition: "由销售日报事实和平台经营表现派生的查询结果。", type: "derived", truthStatus: "derived", tables: [], sources: [], upstream: ["sales-daily-fact", "platform-performance"], downstream: ["link-center", "dashboard"] },
  { id: "product-workspace", name: "产品经营视图", definition: "由产品、销售和库存事实派生的产品经营视图。", type: "derived", truthStatus: "derived", tables: [], sources: [], upstream: ["product", "sales-daily-fact", "inventory-fact"], downstream: ["product-center"] },
  { id: "goal", name: "目标", definition: "企业经营目标。", type: "master", truthStatus: "source_of_truth", tables: ["goals"], sources: ["workstation-work"], upstream: ["workstation-work"], downstream: ["key-action"] },
  { id: "key-action", name: "关键行动", definition: "承接目标的关键行动实例。", type: "master", truthStatus: "source_of_truth", tables: ["process_instances"], sources: ["workstation-work"], upstream: ["goal"], downstream: ["task"] },
  { id: "task", name: "任务", definition: "关键行动执行任务。", type: "fact", truthStatus: "source_of_truth", tables: ["tasks"], sources: ["workstation-work"], upstream: ["key-action"], downstream: ["work-result"] },
  { id: "legacy-sales-fact", name: "旧周期销售事实", definition: "历史兼容销售事实，只读保留。", type: "fact", truthStatus: "legacy", tables: ["connection_sku_sales_facts"], sources: [], upstream: [], downstream: [] },
  { id: "legacy-link-structure", name: "旧 Link Product Structure", definition: "Sales Object 上线前的链接结构兼容资产。", type: "relation", truthStatus: "legacy", tables: ["sales_link_sku_product_structures", "sales_link_sku_product_structure_components"], sources: [], upstream: ["link-sku"], downstream: ["erp-sku"] },
];

const fieldMappings = {
  "platform-goods-file": [
    ["平台商品ID", "sales_links.platformGoodsId", "链接身份"],
    ["平台SKU ID", "sales_link_skus.platformSkuId", "平台销售规格身份"],
    ["平台规格编码", "sales_objects.objectCode", "销售对象身份"],
  ],
  "sales-daily-file": [
    ["销售日期", "connection_sku_sales_daily_facts.saleDate", "事实归属日期"],
    ["销售额", "connection_sku_sales_daily_facts.salesAmount", "销售收入"],
    ["利润", "connection_sku_sales_daily_facts.profitAmount", "销售利润"],
  ],
  "combo-detail-file": [
    ["组合编码", "sales_objects.objectCode", "组合销售对象"],
    ["单品编码", "sales_object_structure_components.erpSkuId", "ERP组件"],
    ["单品数量", "sales_object_structure_components.quantity", "每销售单位组件数量"],
  ],
};

function tableExists(database, table) {
  return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function tableCount(database, table) {
  if (!tableExists(database, table)) return 0;
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count ?? 0);
}

function objectCount(database, object) {
  if (object.tables.length === 0) return null;
  return tableCount(database, object.tables[0]);
}

function generatedAt() {
  return new Date().toISOString();
}

function paginate(items, { page = 1, pageSize = 20, keyword = "", type = "", truthStatus = "" } = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  const normalizedKeyword = String(keyword).trim().toLocaleLowerCase("zh-CN");
  const filtered = items.filter((item) => {
    if (type && item.type !== type) return false;
    if (truthStatus && item.truthStatus !== truthStatus) return false;
    return !normalizedKeyword || `${item.name} ${item.purpose ?? ""} ${item.definition ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalizedKeyword);
  });
  const start = (safePage - 1) * safePageSize;
  return { items: filtered.slice(start, start + safePageSize), page: safePage, pageSize: safePageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / safePageSize)) };
}

export function queryDataAssetMapOverview() {
  const database = getDatabase();
  const tableRows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const classifyTable = (table) => {
    if (/(mapping|relation|component|action_products)/.test(table)) return "relation";
    if (/(fact|snapshot|entry|daily)/.test(table) || table === "tasks") return "fact";
    if (["products", "erp_skus", "erp_goods", "sales_links", "sales_link_skus", "sales_objects", "goals", "process_instances"].includes(table)) return "master";
    return "other";
  };
  const tableCategories = { master: 0, fact: 0, relation: 0, other: 0 };
  for (const row of tableRows) tableCategories[classifyTable(row.name)] += 1;
  return {
    dataSourceCount: sources.length,
    businessObjectCount: objects.length,
    truthSourceCount: objects.filter((item) => item.truthStatus === "source_of_truth").length,
    tableCount: tableRows.length,
    tableCategories,
    generatedAt: generatedAt(),
  };
}

export function queryDataAssetSources(query = {}) {
  return { ...paginate(sources, query), generatedAt: generatedAt() };
}

export function readDataAssetSource(id) {
  const database = getDatabase();
  const source = sources.find((item) => item.id === id);
  if (!source) return null;
  const tableCounts = source.tables.map((table) => ({ table, count: tableCount(database, table), exists: tableExists(database, table) }));
  return { ...source, count: tableCounts.reduce((sum, row) => sum + row.count, 0), tableCounts, fieldMappings: (fieldMappings[id] ?? []).map(([sourceField, systemField, meaning]) => ({ sourceField, systemField, meaning })), generatedAt: generatedAt() };
}

export function queryDataAssetObjects(query = {}) {
  const database = getDatabase();
  const rows = objects.map((item) => ({ ...item, count: objectCount(database, item) }));
  return { ...paginate(rows, query), generatedAt: generatedAt() };
}

export function readDataAssetObject(id) {
  const database = getDatabase();
  const object = objects.find((item) => item.id === id);
  if (!object) return null;
  return { ...object, count: objectCount(database, object), tableCounts: object.tables.map((table) => ({ table, count: tableCount(database, table), exists: tableExists(database, table) })), generatedAt: generatedAt() };
}

const graphDefinitions = {
  product_sales: { name: "商品销售链", nodeIds: ["sales-link", "link-sku", "sales-object", "erp-sku", "product"] },
  sales_operations: { name: "销售经营链", nodeIds: ["sales-link", "sales-daily-fact", "platform-performance", "sales-analysis"] },
  erp_inventory: { name: "ERP库存链", nodeIds: ["erp-sku", "inventory-fact", "product-workspace"] },
};

export function readDataAssetRelationGraph(id) {
  const definition = graphDefinitions[id];
  if (!definition) return null;
  const database = getDatabase();
  const nodes = definition.nodeIds.map((nodeId) => {
    const object = objects.find((item) => item.id === nodeId);
    return { id: object.id, name: object.name, count: objectCount(database, object), truthStatus: object.truthStatus };
  });
  return { id, name: definition.name, nodes, edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id })), generatedAt: generatedAt() };
}
