import { getDatabase } from "./db.js";

function decodeSummary(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function countState(database, table, stateColumn) {
  return Object.fromEntries(
    database.prepare(`
      SELECT ${stateColumn} AS state, COUNT(*) AS total
      FROM ${table}
      GROUP BY ${stateColumn}
    `).all().map((row) => [row.state || "unknown", Number(row.total) || 0]),
  );
}

export function reconcileErpSyncRun(syncRunId, { failAfterStage = "" } = {}) {
  const database = getDatabase();
  const run = database.prepare("SELECT * FROM erp_sync_runs WHERE id=?").get(syncRunId);
  if (!run) throw new Error("ERP同步批次不存在。");
  const syncType = run.syncType || "legacy_combined";
  const goodsInfoBatch = run.goodsInfoBatchId
    ? database.prepare("SELECT importMode FROM erp_import_batches WHERE id=?").get(run.goodsInfoBatchId)
    : null;
  const goodsImportMode = goodsInfoBatch?.importMode || "full";
  if (!["master_data", "daily_business", "legacy_combined"].includes(syncType)) {
    throw new Error("ERP同步类型无效，不能执行缺失记录对账。");
  }
  if (run.status !== "completed") throw new Error("ERP同步完成后才能执行缺失记录对账。");
  if (syncType === "master_data" && !run.goodsInfoBatchId) {
    throw new Error("ERP主数据同步缺少货品信息批次，不能执行缺失记录对账。");
  }
  if (syncType === "daily_business" && (!run.inventoryBatchId || !run.platformGoodsBatchId)) {
    throw new Error("ERP经营数据同步子批次不完整，不能执行缺失记录对账。");
  }
  if (
    syncType === "legacy_combined"
    && (!run.goodsInfoBatchId || !run.inventoryBatchId || !run.platformGoodsBatchId)
  ) {
    throw new Error("历史ERP联合同步子批次不完整，不能执行缺失记录对账。");
  }
  if (run.reconciliationStatus === "completed") {
    return { summary: decodeSummary(run.reconciliationSummaryJson), idempotent: true };
  }

  const now = new Date().toISOString();
  try {
    const summary = database.transaction(() => {
      const result = {
        goods: {},
        erpSkus: {},
        mappings: {},
        inventory: {},
        links: {},
        platformSkus: {},
      };
      if (syncType !== "daily_business" && !(syncType === "master_data" && goodsImportMode === "incremental")) {
        result.goods.missing = database.prepare(`
          UPDATE erp_goods
          SET currentState='missing',missingAt=COALESCE(missingAt,@now),updatedAt=@now
          WHERE COALESCE(lastSeenBatchId,'')<>@batchId AND currentState='active'
        `).run({ batchId: run.goodsInfoBatchId, now }).changes;
        result.erpSkus.missing = database.prepare(`
          UPDATE erp_skus
          SET currentState='missing',updatedAt=@now
          WHERE COALESCE(lastSeenBatchId,'')<>@batchId AND currentState='active'
        `).run({ batchId: run.goodsInfoBatchId, now }).changes;
        result.mappings.missing = database.prepare(`
          UPDATE product_erp_mappings
          SET currentState='missing',missingAt=COALESCE(missingAt,@now),updatedAt=@now
          WHERE COALESCE(sourceBatchId,'')<>@batchId AND currentState='active'
        `).run({ batchId: run.goodsInfoBatchId, now }).changes;
        if (failAfterStage === "goods") throw new Error("测试注入：ERP货品对账后回滚");
      }

      if (syncType !== "master_data") {
        result.inventory.missing = database.prepare(`
          UPDATE product_erp_mappings
          SET inventoryCurrentState='missing',inventoryMissingAt=COALESCE(inventoryMissingAt,@now),updatedAt=@now
          WHERE COALESCE(lastSeenInventoryBatchId,'')<>@batchId AND inventoryCurrentState='active'
        `).run({ batchId: run.inventoryBatchId, now }).changes;
        // 平台货品同步按增量资产原则执行。本批未出现不代表Link退出经营，
        // Link转为missing必须由明确的业务生命周期动作触发。
        result.links.missing = 0;
        result.links.missingPolicy = "explicit_business_action_only";
        result.platformSkus.missing = 0;
        result.platformSkus.missingPolicy = "explicit_business_action_only";
        if (failAfterStage === "relations") throw new Error("测试注入：销售关系对账后回滚");
      }

      result.goods.current = countState(database, "erp_goods", "currentState");
      result.erpSkus.current = countState(database, "erp_skus", "currentState");
      result.mappings.current = countState(database, "product_erp_mappings", "currentState");
      result.inventory.current = countState(database, "product_erp_mappings", "inventoryCurrentState");
      result.links.current = countState(database, "sales_links", "currentState");
      result.platformSkus.current = countState(database, "sales_link_skus", "currentState");
      result.goods.importMode = syncType === "daily_business" ? null : goodsImportMode;
      database.prepare(`
        UPDATE erp_sync_runs
        SET reconciliationStatus='completed',reconciledAt=@now,reconciliationError=NULL,
            reconciliationSummaryJson=@summary,updatedAt=@now
        WHERE id=@id
      `).run({ id: run.id, now, summary: JSON.stringify(result) });
      return result;
    }).immediate();
    return { summary, idempotent: false };
  } catch (error) {
    database.prepare(`
      UPDATE erp_sync_runs
      SET reconciliationStatus='failed',reconciledAt=NULL,reconciliationError=@message,updatedAt=@now
      WHERE id=@id
    `).run({ id: run.id, message: error.message || "缺失记录对账失败。", now: new Date().toISOString() });
    throw error;
  }
}
