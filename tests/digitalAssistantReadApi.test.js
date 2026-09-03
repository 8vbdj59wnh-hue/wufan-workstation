import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API进程提前退出：${child.exitCode}\n${child.capturedError || ""}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("API启动超时。");
}

async function api(baseUrl, token, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json();
  return { status: response.status, body, bytes: Buffer.byteLength(JSON.stringify(body)) };
}

function readSideEffectSnapshot(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return {
      tasks: database.prepare("SELECT COUNT(*) count,COALESCE(MAX(updatedAt),'') updatedAt FROM data_sync_tasks").get(),
      batches: database.prepare("SELECT COUNT(*) count,COALESCE(MAX(createdAt),'') createdAt FROM data_sync_batches").get(),
      exceptions: database.prepare("SELECT COUNT(*) count,COALESCE(MAX(createdAt),'') createdAt FROM data_sync_exceptions").get(),
      usage: database.prepare("SELECT COUNT(*) count,COALESCE(SUM(callCount),0) calls FROM api_usage_ledger WHERE routePattern LIKE '/api/data-sync-center%'").get(),
    };
  } finally { database.close(); }
}

test("等价company只读账号通过正式JWT读取且全部写入口403", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digital-assistant-api-"));
  const databasePath = path.join(directory, "workstation.db");
  const authSecretPath = path.join(directory, "auth.secret");
  process.env.WUFAN_DB_PATH = databasePath;
  process.env.WUFAN_AUTH_SECRET_PATH = authSecretPath;
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, findLoginUserById, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { createToken } = await import("../server/security.js");
  const { createEmptyPermissions } = await import("../shared/permissions.js");
  let child;
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const people = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 3").all();
    assert.equal(people.length >= 3, true);
    const [servicePerson, humanPerson, ownerPerson] = people;
    const permissions = createEmptyPermissions("all");
    for (const permission of ["goals.view", "keyActions.view", "tasks.view", "products.view", "skus.view", "links.view", "dataCenter.view", "cockpit.view"]) {
      const [group, key] = permission.split("."); permissions[group][key] = true;
    }
    const permissionJson = JSON.stringify(permissions);
    for (const [person, username] of [[servicePerson, "service-read-fixture"], [humanPerson, "human-read-fixture"]]) {
      database.prepare(`UPDATE persons SET username=?,canLogin=1,authRole='user',role='member',permissionTemplateId=NULL,
        permissions=?,permissionOverrides=NULL,status='active' WHERE id=?`).run(username, permissionJson, person.id);
    }
    const stamp = "2026-09-03T02:00:00.000Z";
    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES(?,?,?,?,?,'active',?,?)")
      .run("api-read-shop", "test", "api-read-shop", "api-read-shop", "API只读店铺", stamp, stamp);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,ownerId,identityStrength,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,'strong','active',?,?)")
      .run("api-read-link", "api-read-shop", "api-goods-001", "API公司Link", ownerPerson.id, stamp, stamp);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("api-read-link-sku", "api-read-link", "api-platform-sku", "pending_relation", "active", stamp, stamp);
    database.prepare("INSERT INTO products(id,skuCode,name,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
      .run("api-read-product", "API-PRODUCT-001", "API只读产品", "成熟期", stamp, stamp);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("api-read-goods", "API-GOODS-001", "API只读产品", "{}", "active", stamp, stamp);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES(?,?,?,?,?,?)")
      .run("api-read-erp-batch", "goods_info", "api.xlsx", "api-read-hash", "completed", stamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("api-read-erp-sku", "API-ERP-SKU-001", "api-read-goods", JSON.stringify({ prop7: "在售" }), "api-read-erp-batch", "api-read-erp-batch", "active", stamp, stamp);
    database.prepare("INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("api-read-map", "api-read-product", "api-read-goods", "api-read-erp-sku", "API-ERP-SKU-001", "exact_sku", "active", stamp, stamp);
    database.prepare("INSERT INTO connection_import_batches(id,sourceType,externalShopId,fileName,fileHash,businessDate,periodStart,periodEnd,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run("api-read-sales-batch", "erp_sales", "", "api-sales.xlsx", "api-sales-hash", "2026-09-02", "2026-09-02", "2026-09-02", "completed", stamp, stamp);
    database.prepare(`INSERT INTO connection_sku_sales_daily_facts
      (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,'normal',?,1,'{}',?,?)`)
      .run("api-read-fact", "api-read-link", "api-read-link-sku", "api-read-erp-sku", "2026-09-02", 2, 200, 120, 80, "api-read-sales-batch", stamp, stamp);

    const serviceToken = createToken(findLoginUserById(servicePerson.id));
    const humanToken = createToken(findLoginUserById(humanPerson.id));
    closeDatabase();
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server/index.js"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), V3_AUTO_PROJECTION: "off", V3_SHADOW_ENABLED: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.capturedError = "";
    child.stderr.on("data", (chunk) => { child.capturedError += chunk.toString(); });
    await waitForServer(baseUrl, child);

    const beforeStatusGet = readSideEffectSnapshot(databasePath);
    const statusRead = await api(baseUrl, serviceToken, "/api/data-sync-center?batchLimit=1&exceptionLimit=1");
    const afterStatusGet = readSideEffectSnapshot(databasePath);
    assert.equal(statusRead.status, 200);
    assert.equal(statusRead.body.readOnly, true);
    assert.equal(statusRead.body.tasks, undefined);
    assert.equal(statusRead.body.exceptions, undefined);
    assert.equal(statusRead.body.wangdianShopMappings, undefined);
    assert.deepEqual(afterStatusGet, beforeStatusGet);

    const reads = {
      goals: await api(baseUrl, serviceToken, "/api/goal-center/bootstrap"),
      keyActions: await api(baseUrl, serviceToken, "/api/schedule-board/page?page=1&pageSize=1"),
      todayTasks: await api(baseUrl, serviceToken, "/api/task-center/tasks?view=today&page=1&pageSize=1"),
      products: await api(baseUrl, serviceToken, "/api/product-center-v2/products?page=1&pageSize=1&search=API只读产品"),
      legacyProductOverview: await api(baseUrl, serviceToken, "/api/product-management/overview?page=1&pageSize=1&search=API只读产品"),
      productById: await api(baseUrl, serviceToken, "/api/product-center-v2/products/api-read-product?by=productId"),
      productByErpCode: await api(baseUrl, serviceToken, "/api/product-center-v2/products/API-ERP-SKU-001?by=erpSkuCode"),
      productByCode: await api(baseUrl, serviceToken, "/api/product-center-v2/products/API-GOODS-001?by=productCode"),
      productSummary: await api(baseUrl, serviceToken, "/api/product-center-v2/products/operating-summary?days=30"),
      links: await api(baseUrl, serviceToken, "/api/connections?page=1&pageSize=1&keyword=API公司Link&platform=test"),
      linkDetail: await api(baseUrl, serviceToken, "/api/connections/api-read-link/core-detail"),
      linkRecord: await api(baseUrl, serviceToken, "/api/connections/api-read-link"),
      linkSales: await api(baseUrl, serviceToken, "/api/connections/api-read-link/daily-sales?startDate=2026-09-01&endDate=2026-09-03"),
      linkBusiness: await api(baseUrl, serviceToken, "/api/link-business-table?scope=company&page=1&pageSize=1"),
      anomalySummary: await api(baseUrl, serviceToken, "/api/data-sync-center/anomaly-summary"),
      operationDashboard: await api(baseUrl, serviceToken, "/api/operation-dashboard"),
      salesBusinessDashboard: await api(baseUrl, serviceToken, "/api/sales-business-dashboard?range=30d&page=1&pageSize=1"),
    };
    for (const [name, result] of Object.entries(reads)) assert.equal(result.status, 200, `${name}: ${JSON.stringify(result.body)}`);
    assert.equal(reads.links.body.pagination.total, 1);
    assert.equal(reads.linkSales.body.summary.salesAmount, 200);
    assert.equal(reads.products.body.pagination.pageSize, 1);
    assert.equal(reads.products.body.items[0].erpSkuId, "api-read-erp-sku");
    assert.ok(reads.products.bytes < 100_000);
    assert.ok(reads.legacyProductOverview.bytes < 100_000);
    assert.equal(reads.productById.body.item.erpSkuId, "api-read-erp-sku");
    assert.equal(reads.productByErpCode.body.item.erpSkuId, "api-read-erp-sku");
    assert.equal(reads.productByCode.body.item.erpSkuId, "api-read-erp-sku");
    assert.equal(reads.anomalySummary.body.classifications.masterDataIncomplete.label, "当前主数据待完善");

    const serviceLinks = await api(baseUrl, serviceToken, "/api/connections?page=1&pageSize=20&keyword=API公司Link");
    const humanLinks = await api(baseUrl, humanToken, "/api/connections?page=1&pageSize=20&keyword=API公司Link");
    assert.deepEqual(humanLinks.body.items, serviceLinks.body.items);
    assert.deepEqual(humanLinks.body.pagination, serviceLinks.body.pagination);
    for (const pathname of [
      "/api/product-center-v2/products?page=1&pageSize=1&search=API只读产品",
      "/api/product-center-v2/products/api-read-product?by=productId",
      "/api/data-sync-center",
      "/api/data-sync-center/anomaly-summary",
    ]) {
      const serviceRead = await api(baseUrl, serviceToken, pathname);
      const humanRead = await api(baseUrl, humanToken, pathname);
      assert.equal(serviceRead.status, 200, pathname);
      assert.deepEqual(humanRead, serviceRead, pathname);
    }

    const writes = {
      linkEdit: await api(baseUrl, serviceToken, "/api/connections/api-read-link", { method: "PUT", body: JSON.stringify({ name: "禁止修改" }) }),
      linkCreate: await api(baseUrl, serviceToken, "/api/connections", { method: "POST", body: "{}" }),
      productEdit: await api(baseUrl, serviceToken, "/api/product-center-v2/skus/api-read-erp-sku/business-profile", { method: "PUT", body: "{}" }),
      productImport: await api(baseUrl, serviceToken, "/api/products/import/parse", { method: "POST", body: "{}" }),
      syncRun: await api(baseUrl, serviceToken, "/api/data-sync-center/tasks/sync-task-erp-goods/run", { method: "POST", body: "{}" }),
      taskEdit: await api(baseUrl, serviceToken, "/api/tasks/not-present/workflow", { method: "POST", body: JSON.stringify({ action: "start" }) }),
      goalEdit: await api(baseUrl, serviceToken, "/api/goals/not-present", { method: "PUT", body: "{}" }),
      permissionEdit: await api(baseUrl, serviceToken, `/api/people/${servicePerson.id}`, { method: "PUT", body: "{}" }),
    };
    for (const [name, result] of Object.entries(writes)) assert.equal(result.status, 403, `${name}: ${JSON.stringify(result.body)}`);
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    try { closeDatabase(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
