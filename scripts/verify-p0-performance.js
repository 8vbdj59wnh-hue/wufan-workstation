import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { getDatabase } from "../server/db.js";
import { listConnectionCoreProfiles, listConnectionCoreProfilesPage } from "../server/connectionCorePageService.js";
import { getCurrentConnectionOwnerImport, listConnectionOwnerImportRows } from "../server/connectionOwnerImportService.js";
import { listProductCenterV2Skus } from "../server/productCenterV2Service.js";

if (!process.env.WUFAN_DB_PATH) throw new Error("WUFAN_DB_PATH必须指向隔离验证数据库。");
const timed = (name, read) => { const startedAt = performance.now(); const value = read(); return { name, value, milliseconds: performance.now() - startedAt, bytes: Buffer.byteLength(JSON.stringify(value)) }; };

const product = timed("product-page", () => listProductCenterV2Skus({ limit: 50, offset: 0, sort: "updated-desc" }));
assert.equal(product.value.rows.length, 50); assert.equal(product.value.pagination.total, 6902); assert.ok(product.bytes < 500_000);
const productSearch = timed("product-search", () => listProductCenterV2Skus({ limit: 50, offset: 0, search: "HP0910", sort: "updated-desc" }));
assert.ok(productSearch.value.rows.every((row) => JSON.stringify(row).toLowerCase().includes("hp0910")));

const legacyLinks = listConnectionCoreProfiles("", true);
const firstLinks = timed("connection-page", () => listConnectionCoreProfilesPage({ page: 1, pageSize: 50 }, "", true));
assert.equal(firstLinks.value.items.length, 50); assert.equal(firstLinks.value.pagination.total, legacyLinks.length); assert.ok(firstLinks.bytes < 500_000);
const collected = [];
for (let page = 1; page <= Math.ceil(legacyLinks.length / 200); page += 1) collected.push(...listConnectionCoreProfilesPage({ page, pageSize: 200 }, "", true).items.map((item) => item.id));
assert.equal(collected.length, legacyLinks.length); assert.equal(new Set(collected).size, legacyLinks.length); assert.deepEqual(collected, legacyLinks.map((item) => item.id));

const database = getDatabase();
const latestOwnerBatch = database.prepare("SELECT createdBy FROM connection_import_batches WHERE importType='connection_owner_assignments' ORDER BY createdAt DESC LIMIT 1").get();
let ownerSummary = null;
if (latestOwnerBatch) {
  ownerSummary = getCurrentConnectionOwnerImport(latestOwnerBatch.createdBy);
  assert.equal(ownerSummary.rows, undefined); assert.ok(Buffer.byteLength(JSON.stringify(ownerSummary)) < 100_000);
  const details = listConnectionOwnerImportRows(ownerSummary.batch.id, latestOwnerBatch.createdBy, { kind: "changes", page: 1, pageSize: 50 });
  assert.ok(details.rows.length <= 50);
}

console.log(JSON.stringify({ success: true, measurements: [product, productSearch, firstLinks].map(({ name, milliseconds, bytes }) => ({ name, milliseconds: Number(milliseconds.toFixed(1)), bytes })), ownerSummaryBytes: ownerSummary ? Buffer.byteLength(JSON.stringify(ownerSummary)) : 0 }, null, 2));
