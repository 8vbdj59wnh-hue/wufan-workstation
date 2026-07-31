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
  if (run.status !== "completed") throw new Error("只有三张ERP表全部完成后才能执行缺失记录对账。");
  if (!run.goodsInfoBatchId || !run.inventoryBatchId || !run.platformGoodsBatchId) {
    throw new Error("ERP同步子批次不完整，不能执行缺失记录对账。");
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

      result.inventory.missing = database.prepare(`
        UPDATE product_erp_mappings
        SET inventoryCurrentState='missing',inventoryMissingAt=COALESCE(inventoryMissingAt,@now),updatedAt=@now
        WHERE COALESCE(lastSeenInventoryBatchId,'')<>@batchId AND inventoryCurrentState='active'
      `).run({ batchId: run.inventoryBatchId, now }).changes;
      result.links.missing = database.prepare(`
        UPDATE sales_links
        SET currentState='missing',missingAt=COALESCE(missingAt,@now),updatedAt=@now
        WHERE COALESCE(lastSeenBatchId,'')<>@batchId AND currentState='active'
      `).run({ batchId: run.platformGoodsBatchId, now }).changes;
      result.platformSkus.missing = database.prepare(`
        UPDATE sales_link_skus
        SET currentState='missing',missingAt=COALESCE(missingAt,@now),updatedAt=@now
        WHERE COALESCE(lastSeenBatchId,'')<>@batchId AND currentState='active'
      `).run({ batchId: run.platformGoodsBatchId, now }).changes;
      if (failAfterStage === "relations") throw new Error("测试注入：销售关系对账后回滚");

      result.goods.current = countState(database, "erp_goods", "currentState");
      result.erpSkus.current = countState(database, "erp_skus", "currentState");
      result.mappings.current = countState(database, "product_erp_mappings", "currentState");
      result.inventory.current = countState(database, "product_erp_mappings", "inventoryCurrentState");
      result.links.current = countState(database, "sales_links", "currentState");
      result.platformSkus.current = countState(database, "sales_link_skus", "currentState");
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
