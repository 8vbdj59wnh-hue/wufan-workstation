import { getDatabase } from "./db.js";
import { materializeOperatingErpSet } from "./operatingErpSetService.js";
import { materializeOperatingErpIdentityShadow } from "./operatingErpIdentityShadowService.js";
import { compareV3ProjectionResolver, projectOperatingSalesObjects } from "./salesObjectAutoProjectionService.js";
import { getLatestCompletePlatformBatch } from "./v3PlatformBatchService.js";
import { readV3RelationFeatureFlags } from "./v3RelationFeatureFlags.js";
import { enrichOperatingErpObjects } from "./v3WangdianOperatingEnrichmentService.js";

function step(name, status, detail = {}) {
  return { name, status, ...detail };
}

function unresolvedIdentityCount(identity) {
  return (identity?.observations || []).filter((item) => item.identityStatus !== "confirmed").length;
}

/**
 * Explicit V3 orchestration boundary. Platform import is committed before this
 * function is called; failures here never roll back the imported platform facts.
 */
export async function runV3RelationMainChain(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const flags = readV3RelationFeatureFlags(options.flags || {});
  const batch = input.batchId ? { id: input.batchId } : getLatestCompletePlatformBatch(database);
  if (!batch) throw new Error("latest_complete_platform_batch_missing");
  const dependencies = {
    operatingSet: options.operatingSet || ((args) => materializeOperatingErpSet(args)),
    enrich: options.enrich || ((args) => enrichOperatingErpObjects(args, options.enrichmentOptions || {})),
    identity: options.identity || ((args) => materializeOperatingErpIdentityShadow(args)),
    compare: options.compare || ((args) => compareV3ProjectionResolver(args)),
    project: options.project || ((args) => projectOperatingSalesObjects(args)),
  };
  const result = {
    batch,
    flags,
    status: "platform_imported",
    retryable: false,
    steps: [step("platform_import", "completed", { batchId: batch.id })],
    operatingSet: null,
    enrichment: null,
    identity: null,
    comparison: null,
    projection: null,
  };

  if (flags.projection === "off") {
    result.status = "deployed_disabled";
    result.steps.push(step("v3_pipeline", "disabled"));
    return result;
  }

  result.operatingSet = await dependencies.operatingSet({ database, calculatedAt: input.calculatedAt });
  result.steps.push(step("operating_erp_set", "completed", { total: result.operatingSet?.summary?.operatingTotal ?? result.operatingSet?.members?.length ?? null }));

  try {
    result.enrichment = await dependencies.enrich({ database, batch, operatingSet: result.operatingSet, calculatedAt: input.calculatedAt });
  } catch (error) {
    result.status = "erp_enrichment_pending";
    result.retryable = true;
    result.enrichment = { status: "failed", error: error.message };
    result.steps.push(step("wangdian_enrichment", "pending", { error: error.message }));
    return result;
  }
  result.steps.push(step("wangdian_enrichment", "completed", { changedCodes: Number(result.enrichment?.changedCodes || 0) }));
  if (Number(result.enrichment?.sourceFailures || 0) > 0) {
    result.status = "erp_enrichment_pending";
    result.retryable = true;
    result.steps.push(step("wangdian_enrichment_retry", "pending", { count: Number(result.enrichment.sourceFailures) }));
    return result;
  }
  if (Number(result.enrichment?.bomPending || 0) > 0) {
    result.status = "bundle_bom_pending";
    result.retryable = true;
    result.steps.push(step("bundle_bom", "pending", { count: Number(result.enrichment.bomPending) }));
    return result;
  }
  result.steps.push(step("bundle_bom", "completed"));

  result.identity = await dependencies.identity({ database, calculatedAt: input.calculatedAt, liveObservations: result.enrichment?.liveObservations });
  result.steps.push(step("identity_contract", "completed", { unresolved: unresolvedIdentityCount(result.identity) }));

  result.comparison = await dependencies.compare({ database, batchId: batch.id, detailLimit: input.detailLimit });
  result.steps.push(step("shadow_compare", "completed", { summary: result.comparison?.summary || {} }));
  if (flags.projection === "shadow") {
    result.status = "shadow_completed";
    result.steps.push(step("sales_object_projection", "shadow_only"));
    return result;
  }

  result.projection = await dependencies.project({
    database,
    batchId: batch.id,
    timestamp: input.calculatedAt,
    relationWriteEnabled: flags.relationWrite,
    bundleSources: result.enrichment?.bundleSources,
  });
  result.steps.push(step("sales_object_projection", "completed", { created: result.projection.objectsCreated, structuresCreated: result.projection.structuresCreated }));
  result.steps.push(step("link_sku_relation", flags.relationWrite ? "written" : "write_disabled", {
    created: result.projection.relationsCreated,
    wouldCreate: result.projection.relationsWouldCreate,
    provenanceUpdated: result.projection.relationsProvenanceUpdated,
  }));
  result.steps.push(step("exception_candidates", "completed", { count: result.projection.exceptions.length }));
  result.status = flags.relationWrite ? "relation_write_completed" : "projection_completed";
  return result;
}

export default runV3RelationMainChain;
