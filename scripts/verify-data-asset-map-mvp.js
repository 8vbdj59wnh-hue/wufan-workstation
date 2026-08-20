import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "data-asset-map-mvp-"));
process.env.WUFAN_DB_PATH = path.join(tempDirectory, "workstation.db");

const databaseModule = await import("../server/db.js");
const service = await import("../server/dataAssetMapService.js");
const permissions = await import("../shared/permissions.js");

try {
  databaseModule.initializeDatabase({ reset: true });
  const database = databaseModule.getDatabase();
  const snapshot = () => Object.fromEntries(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, Number(database.prepare(`SELECT COUNT(*) AS count FROM \"${name}\"`).get().count)]));
  const before = snapshot();
  const startedAt = performance.now();
  const overview = service.queryDataAssetMapOverview();
  const overviewMs = performance.now() - startedAt;
  assert.ok(overviewMs < 500, `overview expected <500ms, got ${overviewMs.toFixed(1)}ms`);
  assert.equal(overview.tableCount, Object.keys(before).length);
  assert.ok(overview.generatedAt);
  const sourcePage = service.queryDataAssetSources({ page: 1, pageSize: 3 });
  assert.equal(sourcePage.items.length, 3);
  assert.ok(sourcePage.total > sourcePage.items.length);
  assert.ok(service.readDataAssetSource("platform-goods-file")?.fieldMappings.length > 0);
  const objectPage = service.queryDataAssetObjects({ page: 1, pageSize: 5 });
  assert.equal(objectPage.items.length, 5);
  const linkObject = service.readDataAssetObject("sales-link");
  assert.equal(linkObject.count, before.sales_links);
  assert.equal(linkObject.truthStatus, "source_of_truth");
  for (const graphId of ["product_sales", "sales_operations", "erp_inventory"]) {
    const graph = service.readDataAssetRelationGraph(graphId);
    assert.ok(graph.nodes.length >= 3);
    assert.equal(graph.edges.length, graph.nodes.length - 1);
  }
  assert.equal(permissions.hasPermission({ authRole: "admin" }, "settings.viewDataAssetMap"), true);
  assert.equal(permissions.hasPermission({ authRole: "user" }, "settings.viewDataAssetMap"), false);
  assert.deepEqual(snapshot(), before, "read-only capability must not mutate table rows");
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(database.pragma("foreign_key_check").length, 0);
  console.log(JSON.stringify({ overviewMs: Number(overviewMs.toFixed(2)), dataSources: overview.dataSourceCount, businessObjects: overview.businessObjectCount, tables: overview.tableCount, truthSources: overview.truthSourceCount, integrityCheck: "ok", foreignKeyViolations: 0 }, null, 2));
} finally {
  databaseModule.closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
