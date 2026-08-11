function columnExists(database, table, column) {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

export function migrateProductStructureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sales_link_sku_product_structures (
      id TEXT PRIMARY KEY,
      salesLinkSkuId TEXT NOT NULL,
      structureCode TEXT NOT NULL UNIQUE,
      structureHash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      sourceType TEXT NOT NULL,
      sourceBatchId TEXT,
      sourceFileHash TEXT,
      sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
      reviewedBy TEXT,
      reviewedAt TEXT,
      reviewNote TEXT,
      activatedAt TEXT,
      invalidatedAt TEXT,
      replacedStructureId TEXT,
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
      FOREIGN KEY(sourceBatchId) REFERENCES connection_import_batches(id),
      FOREIGN KEY(reviewedBy) REFERENCES persons(id),
      FOREIGN KEY(replacedStructureId) REFERENCES sales_link_sku_product_structures(id),
      FOREIGN KEY(createdBy) REFERENCES persons(id),
      CHECK(status IN ('draft','pending_review','active','inactive','conflict')),
      CHECK(status <> 'active' OR (reviewedBy IS NOT NULL AND reviewedAt IS NOT NULL AND activatedAt IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_link_sku_product_structures_one_active
      ON sales_link_sku_product_structures(salesLinkSkuId) WHERE status='active';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_link_sku_product_structures_batch_sku_hash
      ON sales_link_sku_product_structures(sourceBatchId,salesLinkSkuId,structureHash)
      WHERE sourceBatchId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_link_sku_product_structures_status_updated
      ON sales_link_sku_product_structures(status,updatedAt DESC);

    CREATE TABLE IF NOT EXISTS sales_link_sku_product_structure_components (
      id TEXT PRIMARY KEY,
      productStructureId TEXT NOT NULL,
      erpSkuId TEXT NOT NULL,
      quantity REAL NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      sourceType TEXT NOT NULL,
      sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(productStructureId) REFERENCES sales_link_sku_product_structures(id),
      FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
      UNIQUE(productStructureId,erpSkuId),
      CHECK(quantity > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_link_sku_product_structure_components_order
      ON sales_link_sku_product_structure_components(productStructureId,sortOrder,id);
    CREATE INDEX IF NOT EXISTS idx_sales_link_sku_product_structure_components_erp
      ON sales_link_sku_product_structure_components(erpSkuId);

    CREATE TRIGGER IF NOT EXISTS trg_product_structure_activation_insert
      BEFORE INSERT ON sales_link_sku_product_structures
      WHEN NEW.status='active'
        AND NOT EXISTS (SELECT 1 FROM sales_link_sku_product_structure_components c WHERE c.productStructureId=NEW.id)
      BEGIN
        SELECT RAISE(ABORT,'product structure cannot be active without components');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_product_structure_activation_update
      BEFORE UPDATE OF status ON sales_link_sku_product_structures
      WHEN NEW.status='active'
        AND NOT EXISTS (SELECT 1 FROM sales_link_sku_product_structure_components c WHERE c.productStructureId=NEW.id)
      BEGIN
        SELECT RAISE(ABORT,'product structure cannot be active without components');
      END;

    CREATE TABLE IF NOT EXISTS product_structure_application_batches (
      id TEXT PRIMARY KEY,
      batchCode TEXT NOT NULL UNIQUE,
      sourceType TEXT NOT NULL,
      sourceFileHashesJson TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'preview',
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(createdBy) REFERENCES persons(id),
      CHECK(status IN ('preview','pending_review','partially_reviewed','reviewed','closed'))
    );
    CREATE TABLE IF NOT EXISTS product_structure_application_items (
      id TEXT PRIMARY KEY,
      applicationBatchId TEXT NOT NULL,
      productStructureId TEXT,
      salesLinkSkuId TEXT NOT NULL,
      classification TEXT NOT NULL,
      approvalStatus TEXT NOT NULL DEFAULT 'pending',
      relationshipShape TEXT,
      sourceTypesJson TEXT NOT NULL DEFAULT '[]',
      currentMappingsJson TEXT NOT NULL DEFAULT '[]',
      targetComponentsJson TEXT NOT NULL DEFAULT '[]',
      componentDiffJson TEXT NOT NULL DEFAULT '{}',
      impactSalesAmount REAL,
      impactProfitAmount REAL,
      reviewedBy TEXT,
      reviewedAt TEXT,
      reviewNote TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(applicationBatchId) REFERENCES product_structure_application_batches(id),
      FOREIGN KEY(productStructureId) REFERENCES sales_link_sku_product_structures(id),
      FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
      FOREIGN KEY(reviewedBy) REFERENCES persons(id),
      UNIQUE(applicationBatchId,salesLinkSkuId),
      CHECK(classification IN ('already_consistent','ready_to_apply','structure_upgrade','conflict','incomplete')),
      CHECK(approvalStatus IN ('pending','approved','rejected','blocked','not_required')),
      CHECK(approvalStatus <> 'approved' OR classification IN ('ready_to_apply','structure_upgrade')),
      CHECK(approvalStatus NOT IN ('approved','rejected') OR (reviewedBy IS NOT NULL AND reviewedAt IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_product_structure_application_items_queue
      ON product_structure_application_items(applicationBatchId,approvalStatus,classification,impactSalesAmount DESC);
    CREATE INDEX IF NOT EXISTS idx_product_structure_application_items_sku
      ON product_structure_application_items(salesLinkSkuId,createdAt DESC);
    CREATE TABLE IF NOT EXISTS product_structure_application_audits (
      id TEXT PRIMARY KEY,
      applicationItemId TEXT NOT NULL,
      productStructureId TEXT NOT NULL,
      executionMode TEXT NOT NULL,
      outcome TEXT NOT NULL,
      oldMappingsSnapshotJson TEXT NOT NULL,
      generatedMappingsJson TEXT NOT NULL,
      errorMessage TEXT,
      appliedBy TEXT,
      appliedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(applicationItemId) REFERENCES product_structure_application_items(id),
      FOREIGN KEY(productStructureId) REFERENCES sales_link_sku_product_structures(id),
      FOREIGN KEY(appliedBy) REFERENCES persons(id),
      CHECK(executionMode IN ('isolated_simulation','production')),
      CHECK(outcome IN ('applied','idempotent','failed','rolled_back'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_structure_application_audits_item
      ON product_structure_application_audits(applicationItemId,appliedAt DESC);
  `);
  if (!columnExists(database, "sales_link_sku_erp_mappings", "productStructureId")) {
    database.exec("ALTER TABLE sales_link_sku_erp_mappings ADD COLUMN productStructureId TEXT REFERENCES sales_link_sku_product_structures(id)");
  }
  database.exec(`CREATE INDEX IF NOT EXISTS idx_sales_link_sku_erp_mapping_product_structure
    ON sales_link_sku_erp_mappings(productStructureId) WHERE productStructureId IS NOT NULL`);
}
