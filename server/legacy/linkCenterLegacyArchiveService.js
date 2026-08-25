import { getDatabase } from "../db.js";

const archiveTables = Object.freeze({
  linkStructures: "legacy_link_product_structures",
  linkStructureComponents: "legacy_link_product_structure_components",
  structureCrosswalk: "legacy_link_product_structure_sales_object_map",
  periodSalesFacts: "legacy_connection_sku_sales_facts",
  connectionProfiles: "legacy_connection_profiles",
  diagnosisEntries: "legacy_connection_diagnosis_entries",
});

function tableExists(database, table) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function boundedLimit(value) {
  return Math.min(Math.max(Number.parseInt(value, 10) || 100, 1), 500);
}

export function getLinkCenterLegacyArchiveSummary(database = getDatabase()) {
  return Object.fromEntries(Object.entries(archiveTables).map(([key, table]) => [key, {
    table,
    rowCount: tableExists(database, table)
      ? Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count || 0)
      : 0,
  }]));
}

export function readArchivedLinkStructure(legacyStructureId, database = getDatabase()) {
  if (!tableExists(database, archiveTables.linkStructures)) return null;
  const structure = database.prepare(`SELECT * FROM ${archiveTables.linkStructures} WHERE id=?`).get(legacyStructureId);
  if (!structure) return null;
  const components = database.prepare(`SELECT * FROM ${archiveTables.linkStructureComponents}
    WHERE productStructureId=? ORDER BY sortOrder,id`).all(legacyStructureId);
  const crosswalk = database.prepare(`SELECT * FROM ${archiveTables.structureCrosswalk}
    WHERE legacyStructureId=?`).get(legacyStructureId) || null;
  return { structure, components, crosswalk };
}

export function listArchivedPeriodSalesFacts({ salesLinkSkuId = null, limit = 100, offset = 0 } = {}, database = getDatabase()) {
  if (!tableExists(database, archiveTables.periodSalesFacts)) return [];
  if (salesLinkSkuId) return database.prepare(`SELECT * FROM ${archiveTables.periodSalesFacts}
    WHERE salesLinkSkuId=? ORDER BY periodEnd DESC,id LIMIT ? OFFSET ?`)
    .all(salesLinkSkuId, boundedLimit(limit), Math.max(Number(offset) || 0, 0));
  return database.prepare(`SELECT * FROM ${archiveTables.periodSalesFacts}
    ORDER BY periodEnd DESC,id LIMIT ? OFFSET ?`).all(boundedLimit(limit), Math.max(Number(offset) || 0, 0));
}

export function readArchivedConnectionProfile(connectionId, database = getDatabase()) {
  if (!tableExists(database, archiveTables.connectionProfiles)) return null;
  return database.prepare(`SELECT * FROM ${archiveTables.connectionProfiles} WHERE connectionId=?`).get(connectionId) || null;
}
