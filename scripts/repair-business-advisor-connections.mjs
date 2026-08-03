import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

const targetMappingIds = [
  "connection-mapping-00509ba0-77c1-44f0-add3-267448577969",
  "connection-mapping-0ac5a2c8-5009-4a16-85db-bca345dfc073",
  "connection-mapping-0eaba2ad-14fe-44e9-b56b-ca04cc8d9479",
  "connection-mapping-427a618c-b3ce-4851-9be1-c1e941a0f765",
  "connection-mapping-6067c393-2b1f-4899-b089-1396040bdb20",
  "connection-mapping-6280ed58-9f2e-4ed9-b7fc-f06128ac51f6",
  "connection-mapping-86010219-086c-4fba-b5d6-452109973912",
  "connection-mapping-ad9748fd-7298-4010-8f37-ed62dd58a23b",
  "connection-mapping-d03114bd-b2dd-45e4-8ff0-03003db2ebd1",
  "connection-mapping-e9c7177b-2612-457a-b9a8-de57799b15f5",
  "connection-mapping-fbbc7e98-550e-4d57-9027-75e115f448c0",
];

const databasePath = String(process.env.WUFAN_DB_PATH ?? "").trim();
const execute = process.argv.includes("--execute");
if (!databasePath) throw new Error("必须通过 WUFAN_DB_PATH 指定数据库路径。");
if (!path.isAbsolute(databasePath)) throw new Error("WUFAN_DB_PATH 必须是绝对路径。");

const database = new Database(databasePath, execute ? {} : { readonly: true, fileMustExist: true });
database.pragma("foreign_keys = ON");

function requireColumns(table, columns) {
  const existing = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
  const missing = columns.filter((column) => !existing.has(column));
  if (missing.length > 0) throw new Error(`${table} 缺少字段：${missing.join(", ")}。请先发布连接来源模型迁移。`);
}

requireColumns("connection_profiles", ["originSource", "originImportBatchId", "identifiedAt"]);

const placeholders = targetMappingIds.map(() => "?").join(",");
const rows = database.prepare(`
  SELECT m.id AS mappingId,m.externalId,m.salesLinkId,m.sourceType,m.matchStatus,m.matchMethod,m.connectionId,m.deletedAt,
         l.id AS linkId,l.shopId,l.platformGoodsId,l.title,
         (SELECT COUNT(*) FROM sales_links duplicate
          WHERE duplicate.shopId=l.shopId AND TRIM(duplicate.platformGoodsId)=TRIM(l.platformGoodsId)) AS identityCount,
         (SELECT COUNT(*) FROM connection_profiles profile WHERE profile.salesLinkId=l.id) AS profileCount,
         (SELECT GROUP_CONCAT(DISTINCT snapshot.importBatchId)
          FROM connection_period_snapshots snapshot WHERE snapshot.mappingId=m.id) AS importBatchIds,
         (SELECT COUNT(DISTINCT snapshot.importBatchId)
          FROM connection_period_snapshots snapshot WHERE snapshot.mappingId=m.id) AS importBatchCount
  FROM connection_data_mappings m
  LEFT JOIN sales_links l ON l.id=m.salesLinkId
  WHERE m.id IN (${placeholders})
  ORDER BY m.id
`).all(...targetMappingIds);

if (rows.length !== targetMappingIds.length) {
  const found = new Set(rows.map((row) => row.mappingId));
  throw new Error(`目标映射不完整，缺少：${targetMappingIds.filter((id) => !found.has(id)).join(", ")}`);
}

for (const row of rows) {
  if (row.sourceType !== "business_advisor" || row.matchStatus !== "matched" || row.matchMethod !== "goods_id") {
    throw new Error(`${row.mappingId} 不是商品ID精确匹配的生意参谋记录。`);
  }
  if (row.connectionId || row.deletedAt) throw new Error(`${row.mappingId} 当前状态已变化，停止执行。`);
  if (!row.linkId || row.linkId !== row.salesLinkId) throw new Error(`${row.mappingId} 销售链接不存在或不一致。`);
  if (String(row.externalId).trim() !== String(row.platformGoodsId).trim()) throw new Error(`${row.mappingId} 商品ID不一致。`);
  if (row.identityCount !== 1) throw new Error(`${row.mappingId} 平台店铺商品身份不唯一。`);
  if (row.profileCount !== 0) throw new Error(`${row.mappingId} 已存在连接档案，停止执行。`);
  if (row.importBatchCount !== 1 || !row.importBatchIds) throw new Error(`${row.mappingId} 无法确定唯一来源批次。`);
  const batch = database.prepare("SELECT sourceType FROM connection_import_batches WHERE id=?").get(row.importBatchIds);
  if (batch?.sourceType !== "business_advisor") throw new Error(`${row.mappingId} 来源批次不是生意参谋。`);
}

const summary = rows.map((row) => ({
  mappingId: row.mappingId,
  externalId: row.externalId,
  salesLinkId: row.salesLinkId,
  importBatchId: row.importBatchIds,
}));

if (!execute) {
  console.log(JSON.stringify({ mode: "dry-run", verified: summary.length, rows: summary }, null, 2));
  database.close();
  process.exit(0);
}

const repair = database.transaction(() => {
  const now = new Date().toISOString();
  const selectImage = database.prepare(`
    SELECT product.mainImage
    FROM sales_link_skus sku
    JOIN products product ON product.id=sku.productId
    WHERE sku.salesLinkId=? AND sku.productId IS NOT NULL
      AND COALESCE(sku.currentState,'active')='active' AND COALESCE(product.mainImage,'')<>''
    ORDER BY sku.createdAt,sku.id,product.id LIMIT 1
  `);
  const insertProfile = database.prepare(`
    INSERT INTO connection_profiles (
      id,salesLinkId,name,mainImage,imageSource,ownerId,status,level,notes,originSource,
      originImportBatchId,identifiedAt,createdBy,createdAt,updatedAt
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const updateMapping = database.prepare(`
    UPDATE connection_data_mappings SET connectionId=?,updatedAt=?
    WHERE id=? AND connectionId IS NULL AND salesLinkId=? AND externalId=?
      AND sourceType='business_advisor' AND matchStatus='matched' AND matchMethod='goods_id' AND deletedAt IS NULL
  `);
  const created = [];
  for (const row of rows) {
    const connectionId = `connection-${crypto.randomUUID()}`;
    const image = selectImage.get(row.salesLinkId)?.mainImage ?? null;
    insertProfile.run(
      connectionId,row.salesLinkId,row.title || `经营链接 ${row.externalId}`,image,image ? "product" : null,
      null,"active","new","","business_advisor",row.importBatchIds,now,null,now,now,
    );
    const result = updateMapping.run(connectionId, now, row.mappingId, row.salesLinkId, row.externalId);
    if (result.changes !== 1) throw new Error(`${row.mappingId} 回填失败，事务已回滚。`);
    created.push({ ...summary.find((item) => item.mappingId === row.mappingId), connectionId });
  }
  return created;
});

const created = repair();
console.log(JSON.stringify({ mode: "execute", createdProfiles: created.length, repairedMappings: created.length, rows: created }, null, 2));
database.close();
