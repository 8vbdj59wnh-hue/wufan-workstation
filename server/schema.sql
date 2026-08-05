CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  companySlogan TEXT,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  name TEXT NOT NULL,
  leaderId TEXT,
  parentDepartmentId TEXT,
  sortOrder INTEGER,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  departmentId TEXT NOT NULL,
  name TEXT NOT NULL,
  sortOrder INTEGER,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account TEXT NOT NULL,
  departmentId TEXT NOT NULL,
  positionId TEXT NOT NULL,
  directManagerId TEXT,
  role TEXT NOT NULL,
  avatarUrl TEXT,
  permissionTemplateId TEXT,
  permissionOverrides TEXT,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS permission_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  sortOrder INTEGER,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT,
  brand TEXT,
  type TEXT,
  ownerId TEXT,
  status TEXT NOT NULL,
  remark TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS publishing_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT,
  ownerId TEXT,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id TEXT PRIMARY KEY,
  weekStart TEXT NOT NULL,
  weekEnd TEXT NOT NULL,
  weekLabel TEXT NOT NULL,
  departmentId TEXT,
  submitterId TEXT,
  relatedGoalIds TEXT,
  goalAlignedWork TEXT,
  workEffectReview TEXT,
  efficiencyReview TEXT,
  status TEXT NOT NULL,
  submittedAt TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS weekly_report_problems (
  id TEXT PRIMARY KEY,
  weeklyReportId TEXT,
  departmentId TEXT,
  submitterId TEXT,
  relatedGoalId TEXT,
  sourceQuestion TEXT,
  title TEXT NOT NULL,
  description TEXT,
  problemType TEXT,
  impactLevel TEXT,
  status TEXT NOT NULL,
  needSupport INTEGER NOT NULL DEFAULT 0,
  supportNeeded TEXT,
  nextAction TEXT,
  expectedResolveDate TEXT,
  resolvedAt TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  businessCode TEXT UNIQUE,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  type TEXT NOT NULL,
  periodType TEXT,
  periodValue TEXT,
  departmentId TEXT,
  ownerId TEXT NOT NULL,
  parentGoalId TEXT,
  metricName TEXT,
  metricUnit TEXT,
  metricDirection TEXT,
  targetValue REAL,
  currentValue REAL,
  description TEXT,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  businessCode TEXT UNIQUE,
  name TEXT NOT NULL,
  categoryId TEXT,
  defaultProcessTemplateId TEXT,
  departmentId TEXT NOT NULL,
  ownerId TEXT NOT NULL,
  description TEXT,
  completionStandard TEXT,
  needAcceptance INTEGER NOT NULL DEFAULT 0,
  accepterId TEXT,
  status TEXT NOT NULL,
  formFields TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  businessCode TEXT UNIQUE,
  taskType TEXT NOT NULL DEFAULT 'execution',
  name TEXT NOT NULL,
  goalId TEXT NOT NULL,
  taskTemplateId TEXT,
  source TEXT NOT NULL,
  processInstanceId TEXT,
  processNodeId TEXT,
  categoryId TEXT,
  departmentId TEXT NOT NULL,
  ownerId TEXT NOT NULL,
  executorId TEXT,
  initiatorId TEXT NOT NULL,
  description TEXT,
  completionStandard TEXT,
  reviewStandard TEXT,
  outputRequirement TEXT,
  startDate TEXT,
  readyAt TEXT,
  dueDate TEXT,
  plannedWeek TEXT,
  needAcceptance INTEGER NOT NULL DEFAULT 0,
  accepterId TEXT,
  status TEXT NOT NULL,
  resultText TEXT,
  resultAttachments TEXT,
  customFields TEXT,
  displayTitle TEXT,
  coverImageUrl TEXT,
  submitType TEXT,
  submitDescription TEXT,
  submitFields TEXT,
  submitFormData TEXT,
  submitFiles TEXT,
  submitLinks TEXT,
  submittedAt TEXT,
  submittedBy TEXT,
  cancelReason TEXT,
  executionGroupId TEXT,
  reviewTargetTaskId TEXT,
  reviewTargetSnapshot TEXT,
  returnToNodeId TEXT,
  reviewStatus TEXT,
  reviewComment TEXT,
  reviewedAt TEXT,
  reviewerId TEXT,
  requireRejectionReason INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT,
  updatedAt TEXT,
  completedAt TEXT
);

CREATE TABLE IF NOT EXISTS execution_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  taskIds TEXT,
  taskTemplateId TEXT,
  standardWorkId TEXT,
  processInstanceIds TEXT,
  ownerId TEXT,
  executorId TEXT,
  status TEXT NOT NULL,
  standardTotalMinutes INTEGER,
  startedAt TEXT,
  endedAt TEXT,
  actualTotalMinutes INTEGER,
  savedMinutes INTEGER,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS task_waves (
  id TEXT PRIMARY KEY,
  businessCode TEXT NOT NULL UNIQUE,
  taskTemplateId TEXT NOT NULL,
  processTemplateId TEXT NOT NULL,
  processNodeId TEXT NOT NULL,
  executorId TEXT NOT NULL,
  templateGroupKey TEXT NOT NULL,
  waveType TEXT NOT NULL,
  taskCount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting',
  acceptingTasks INTEGER NOT NULL DEFAULT 0,
  collectUntil TEXT,
  lockedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  startedAt TEXT,
  unitDurationMinutes INTEGER,
  waveDurationMinutes INTEGER,
  deadlineAt TEXT,
  submittedAt TEXT,
  completedAt TEXT,
  canceledAt TEXT,
  cancelReason TEXT,
  supersededAt TEXT,
  supersededByGenerationId TEXT,
  supersededByUserId TEXT,
  supersedeReason TEXT,
  generationMaxTaskCount INTEGER
);

CREATE TABLE IF NOT EXISTS task_wave_items (
  id TEXT PRIMARY KEY,
  waveId TEXT NOT NULL,
  taskId TEXT NOT NULL,
  processInstanceId TEXT NOT NULL,
  linkedTemplateIds TEXT NOT NULL DEFAULT '[]',
  primaryTemplateId TEXT,
  sortOrder INTEGER NOT NULL,
  joinedAt TEXT NOT NULL,
  removedAt TEXT,
  removeReason TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  resultDraft TEXT NOT NULL DEFAULT '{}',
  updatedAt TEXT,
  submittedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_waves_process_node ON task_waves(processNodeId);
CREATE INDEX IF NOT EXISTS idx_task_waves_executor ON task_waves(executorId);
CREATE INDEX IF NOT EXISTS idx_task_waves_status ON task_waves(status);
CREATE INDEX IF NOT EXISTS idx_task_wave_items_wave ON task_wave_items(waveId);
CREATE INDEX IF NOT EXISTS idx_task_wave_items_task ON task_wave_items(taskId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_wave_items_active_task ON task_wave_items(taskId) WHERE isActive = 1;

CREATE TABLE IF NOT EXISTS wave_regeneration_runs (
  id TEXT PRIMARY KEY,
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  completedAt TEXT,
  status TEXT NOT NULL,
  replacedWaveCount INTEGER NOT NULL DEFAULT 0,
  sourceTaskCount INTEGER NOT NULL DEFAULT 0,
  unassignedNewTaskCount INTEGER NOT NULL DEFAULT 0,
  generatedWaveCount INTEGER NOT NULL DEFAULT 0,
  remainingTaskCount INTEGER NOT NULL DEFAULT 0,
  generatedWaveIds TEXT NOT NULL DEFAULT '[]',
  errorSummary TEXT
);

CREATE INDEX IF NOT EXISTS idx_wave_regeneration_runs_created ON wave_regeneration_runs(createdAt);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wave_regeneration_runs_active ON wave_regeneration_runs(status) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS process_templates (
  id TEXT PRIMARY KEY,
  businessCode TEXT UNIQUE,
  name TEXT NOT NULL,
  categoryId TEXT,
  purpose TEXT,
  applicableDepartmentIds TEXT,
  ownerId TEXT NOT NULL,
  startCondition TEXT,
  completionCondition TEXT,
  overallStandard TEXT,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS process_template_nodes (
  id TEXT PRIMARY KEY,
  templateId TEXT NOT NULL,
  stepType TEXT NOT NULL DEFAULT 'execution',
  stepOrder INTEGER,
  departmentId TEXT,
  ownerId TEXT,
  executorId TEXT,
  stageName TEXT NOT NULL,
  stageOrder INTEGER NOT NULL,
  nodeOrder INTEGER NOT NULL,
  name TEXT NOT NULL,
  ownerRule TEXT NOT NULL,
  ownerDepartmentId TEXT,
  ownerPositionId TEXT,
  defaultOwnerId TEXT,
  durationDays INTEGER NOT NULL,
  durationMinutes INTEGER,
  description TEXT,
  completionStandard TEXT,
  reviewStandard TEXT,
  defaultImportance TEXT NOT NULL,
  defaultUrgency TEXT NOT NULL,
  needAcceptance INTEGER NOT NULL DEFAULT 0,
  accepterRule TEXT NOT NULL,
  defaultAccepterId TEXT,
  outputRequirement TEXT,
  submitType TEXT,
  submitDescription TEXT,
  submitFields TEXT,
  requireFile INTEGER NOT NULL DEFAULT 0,
  requireLink INTEGER NOT NULL DEFAULT 0,
  reviewerId TEXT,
  reviewTargetType TEXT,
  returnToNodeId TEXT,
  requireRejectionReason INTEGER NOT NULL DEFAULT 0,
  waveEnabled INTEGER NOT NULL DEFAULT 0,
  waveSize INTEGER NOT NULL DEFAULT 10,
  waveUnlimited INTEGER NOT NULL DEFAULT 0,
  waveTemplatePriority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS process_instances (
  id TEXT PRIMARY KEY,
  businessCode TEXT UNIQUE,
  templateId TEXT NOT NULL,
  taskTemplateId TEXT,
  templateVersion INTEGER NOT NULL,
  name TEXT NOT NULL,
  goalId TEXT NOT NULL,
  initiatorId TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  startedAt TEXT,
  dueDate TEXT,
  completedAt TEXT,
  stoppedAt TEXT,
  canceledAt TEXT,
  cancelReason TEXT,
  customFields TEXT,
  displayTitle TEXT,
  coverImageUrl TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS methodologies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  processTemplateId TEXT,
  processNodeId TEXT,
  standardWorkId TEXT,
  taskTemplateId TEXT,
  description TEXT,
  steps TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  businessCode TEXT UNIQUE,
  name TEXT NOT NULL,
  previewImage TEXT NOT NULL,
  sourceFile TEXT NOT NULL,
  tags TEXT NOT NULL,
  fileType TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS template_tag_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  sortOrder INTEGER,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS template_tags (
  id TEXT PRIMARY KEY,
  categoryId TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  sortOrder INTEGER,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS standard_work_forms (
  id TEXT PRIMARY KEY,
  standardWorkId TEXT NOT NULL,
  formSchema TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS template_asset_versions (
  id TEXT PRIMARY KEY,
  assetType TEXT NOT NULL,
  assetId TEXT NOT NULL,
  versionNumber TEXT NOT NULL,
  majorVersion INTEGER NOT NULL,
  minorVersion INTEGER NOT NULL,
  status TEXT NOT NULL,
  contentJson TEXT NOT NULL,
  changeSummary TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  activatedAt TEXT,
  deactivatedAt TEXT,
  archivedAt TEXT,
  UNIQUE(assetType, assetId, versionNumber)
);

CREATE INDEX IF NOT EXISTS idx_template_asset_versions_asset ON template_asset_versions(assetType, assetId, majorVersion DESC, minorVersion DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_asset_versions_active ON template_asset_versions(assetType, assetId) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  taskId TEXT,
  processInstanceId TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL,
  severity TEXT,
  dueDate TEXT,
  readAt TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS issues_requirements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  module TEXT,
  description TEXT,
  attachments TEXT,
  submitterId TEXT,
  status TEXT NOT NULL,
  solution TEXT,
  completedBy TEXT,
  completedAt TEXT,
  latestReply TEXT,
  latestReplyAt TEXT,
  latestReplyBy TEXT,
  replyRecords TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS content_schedules (
  id TEXT PRIMARY KEY,
  publishDate TEXT,
  account TEXT,
  contentType TEXT,
  contentPurpose TEXT,
  targetAudience TEXT,
  product TEXT,
  productImage TEXT,
  title TEXT,
  copywriting TEXT,
  scene TEXT,
  hashtags TEXT,
  status TEXT NOT NULL,
  goalId TEXT,
  taskId TEXT,
  processInstanceId TEXT,
  workPlanId TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS work_plans (
  id TEXT PRIMARY KEY,
  goalId TEXT NOT NULL,
  departmentId TEXT,
  taskTemplateId TEXT NOT NULL,
  title TEXT,
  customFields TEXT,
  coverImageUrl TEXT,
  workType TEXT DEFAULT 'normal',
  status TEXT NOT NULL,
  plannedWeek TEXT,
  dueDate TEXT,
  description TEXT,
  processInstanceId TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  launchedAt TEXT,
  canceledAt TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  skuCode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mainImage TEXT,
  galleryImages TEXT,
  brand TEXT,
  category TEXT,
  series TEXT,
  material TEXT,
  color TEXT,
  specification TEXT,
  status TEXT NOT NULL,
  ownerId TEXT,
  remark TEXT,
  skuName TEXT,
  weightKg REAL,
  lengthCm REAL,
  widthCm REAL,
  heightCm REAL,
  volumeCm3 REAL,
  productType TEXT,
  style TEXT,
  warehouseInfo TEXT,
  tags TEXT,
  priceInfo TEXT,
  shelfLifeDays INTEGER,
  pointsInfo TEXT,
  unitInfo TEXT,
  placement TEXT,
  grade TEXT,
  sourceCreatedAt TEXT,
  sourceUpdatedAt TEXT,
  supplierInfo TEXT,
  preSaleInfo TEXT,
  erpStatusRaw TEXT,
  erpAttributes TEXT,
  identifiers TEXT,
  rawSourceData TEXT,
  sourceSystem TEXT,
  lastImportedAt TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS action_products (
  id TEXT PRIMARY KEY,
  actionId TEXT NOT NULL,
  productId TEXT NOT NULL,
  createdAt TEXT,
  UNIQUE(actionId, productId)
);

CREATE INDEX IF NOT EXISTS idx_action_products_action ON action_products(actionId);
CREATE INDEX IF NOT EXISTS idx_action_products_product ON action_products(productId);

CREATE TABLE IF NOT EXISTS product_import_batches (
  id TEXT PRIMARY KEY,
  fileName TEXT NOT NULL,
  sourceSystem TEXT,
  sheetName TEXT,
  status TEXT NOT NULL,
  headers TEXT,
  mappingConfig TEXT,
  summary TEXT,
  createdBy TEXT,
  validatedAt TEXT,
  committedAt TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS erp_goods (
  id TEXT PRIMARY KEY,
  goodsCode TEXT NOT NULL COLLATE NOCASE UNIQUE,
  goodsName TEXT,
  shortName TEXT,
  brand TEXT,
  category TEXT,
  productType TEXT,
  primarySupplier TEXT,
  supplierGoodsCode TEXT,
  sourceCreatedAt TEXT,
  sourceUpdatedAt TEXT,
  rawSourceData TEXT NOT NULL DEFAULT '{}',
  lastImportedAt TEXT,
  lastSeenBatchId TEXT,
  currentState TEXT NOT NULL DEFAULT 'active',
  missingAt TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS erp_skus (
  id TEXT PRIMARY KEY,
  merchantSkuCode TEXT NOT NULL COLLATE NOCASE UNIQUE,
  erpGoodsId TEXT NOT NULL,
  specificationName TEXT,
  barcode TEXT,
  unit TEXT,
  erpStatus TEXT,
  mainImage TEXT,
  galleryImages TEXT,
  sourceUpdatedAt TEXT,
  rawSourceData TEXT NOT NULL DEFAULT '{}',
  firstSeenBatchId TEXT NOT NULL,
  lastSeenBatchId TEXT NOT NULL,
  currentState TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(erpGoodsId) REFERENCES erp_goods(id)
);

CREATE INDEX IF NOT EXISTS idx_erp_skus_current_code
  ON erp_skus(currentState, merchantSkuCode);
CREATE INDEX IF NOT EXISTS idx_erp_skus_goods
  ON erp_skus(erpGoodsId);

CREATE TABLE IF NOT EXISTS erp_import_batches (
  id TEXT PRIMARY KEY,
  importType TEXT NOT NULL,
  importMode TEXT,
  dataSource TEXT NOT NULL DEFAULT 'excel',
  syncRunId TEXT,
  businessDate TEXT,
  originalFilename TEXT NOT NULL,
  fileHash TEXT NOT NULL,
  status TEXT NOT NULL,
  totalRows INTEGER NOT NULL DEFAULT 0,
  createdCount INTEGER NOT NULL DEFAULT 0,
  updatedCount INTEGER NOT NULL DEFAULT 0,
  unchangedCount INTEGER NOT NULL DEFAULT 0,
  matchedCount INTEGER NOT NULL DEFAULT 0,
  unmatchedCount INTEGER NOT NULL DEFAULT 0,
  errorCount INTEGER NOT NULL DEFAULT 0,
  summaryJson TEXT,
  createdBy TEXT,
  createdAt TEXT,
  completedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_erp_import_batches_hash ON erp_import_batches(importType, fileHash);

CREATE TABLE IF NOT EXISTS wangdian_goods_sync_logs (
  id TEXT PRIMARY KEY,
  syncRunId TEXT,
  importBatchId TEXT,
  interfaceMethod TEXT NOT NULL DEFAULT 'goods.Goods.queryWithSpec',
  importMode TEXT NOT NULL,
  requestStart TEXT,
  requestEnd TEXT,
  requestJson TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  windowCount INTEGER NOT NULL DEFAULT 0,
  pageCount INTEGER NOT NULL DEFAULT 0,
  goodsCount INTEGER NOT NULL DEFAULT 0,
  skuCount INTEGER NOT NULL DEFAULT 0,
  successCount INTEGER NOT NULL DEFAULT 0,
  failedCount INTEGER NOT NULL DEFAULT 0,
  errorCount INTEGER NOT NULL DEFAULT 0,
  errorMessage TEXT,
  createdBy TEXT,
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY(syncRunId) REFERENCES erp_sync_runs(id),
  FOREIGN KEY(importBatchId) REFERENCES erp_import_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_wangdian_goods_sync_logs_time
  ON wangdian_goods_sync_logs(startedAt DESC);

CREATE TABLE IF NOT EXISTS data_sync_tasks (
  id TEXT PRIMARY KEY,
  taskCode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  syncType TEXT NOT NULL,
  sourceType TEXT NOT NULL,
  sourceMethod TEXT,
  transportType TEXT NOT NULL,
  executionMode TEXT NOT NULL,
  defaultSyncMode TEXT NOT NULL,
  scheduleCron TEXT,
  scheduleDescription TEXT,
  status TEXT NOT NULL DEFAULT 'paused',
  lastSuccessAt TEXT,
  nextRunAt TEXT,
  configJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_sync_batches (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  triggerMode TEXT NOT NULL,
  syncMode TEXT NOT NULL,
  status TEXT NOT NULL,
  requestStart TEXT,
  requestEnd TEXT,
  fileName TEXT,
  fileHash TEXT,
  periodStart TEXT,
  periodEnd TEXT,
  scopeJson TEXT NOT NULL DEFAULT '{}',
  progressJson TEXT NOT NULL DEFAULT '{}',
  totalCount INTEGER NOT NULL DEFAULT 0,
  createdCount INTEGER NOT NULL DEFAULT 0,
  updatedCount INTEGER NOT NULL DEFAULT 0,
  invalidatedCount INTEGER NOT NULL DEFAULT 0,
  exceptionCount INTEGER NOT NULL DEFAULT 0,
  sourceBatchType TEXT,
  sourceBatchId TEXT,
  errorMessage TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  startedAt TEXT,
  completedAt TEXT,
  FOREIGN KEY(taskId) REFERENCES data_sync_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_data_sync_batches_task_time ON data_sync_batches(taskId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_data_sync_batches_status ON data_sync_batches(status, createdAt DESC);

CREATE TABLE IF NOT EXISTS data_sync_logs (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  level TEXT NOT NULL,
  eventType TEXT NOT NULL,
  message TEXT NOT NULL,
  detailJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  FOREIGN KEY(batchId) REFERENCES data_sync_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_data_sync_logs_batch_time ON data_sync_logs(batchId, createdAt DESC);

CREATE TABLE IF NOT EXISTS data_sync_exceptions (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  batchId TEXT,
  exceptionType TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error',
  status TEXT NOT NULL DEFAULT 'open',
  message TEXT NOT NULL,
  entityType TEXT,
  entityId TEXT,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  resolutionNote TEXT,
  createdAt TEXT NOT NULL,
  resolvedAt TEXT,
  resolvedBy TEXT,
  FOREIGN KEY(taskId) REFERENCES data_sync_tasks(id),
  FOREIGN KEY(batchId) REFERENCES data_sync_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_data_sync_exceptions_status ON data_sync_exceptions(status, createdAt DESC);

INSERT OR IGNORE INTO data_sync_tasks
  (id,taskCode,name,syncType,sourceType,sourceMethod,transportType,executionMode,defaultSyncMode,scheduleCron,scheduleDescription,status,configJson,createdAt,updatedAt)
VALUES
  ('sync-task-erp-goods','erp_goods','ERP货品同步','wangdian_erp_goods','wangdian_api','goods.Goods.queryWithSpec','api','both','incremental','0 2 * * *','每天02:00','paused','{}',datetime('now'),datetime('now')),
  ('sync-task-platform-goods','wangdian_platform_goods','平台货品关系同步','wangdian_platform_goods','wangdian_api','goods.ApiGoods.search','api','both','incremental','30 2 * * *','每天02:30','paused','{}',datetime('now'),datetime('now')),
  ('sync-task-platform-goods-excel','platform_goods_excel_import','平台货品关系导入','platform_goods_excel_import','excel',NULL,'excel','manual','full',NULL,NULL,'enabled','{}',datetime('now'),datetime('now')),
  ('sync-task-inventory','wangdian_inventory','库存同步','wangdian_inventory','wangdian_api','wms.StockSpec.search2','api','both','incremental','0 3 * * *','每天03:00','paused','{}',datetime('now'),datetime('now')),
  ('sync-task-platform-operations','platform_operations','平台经营数据导入','platform_operations','excel',NULL,'excel','manual','incremental',NULL,NULL,'enabled','{}',datetime('now'),datetime('now')),
  ('sync-task-real-sales','sales_fact_excel_import','真实销售导入','sales_fact_excel_import','excel',NULL,'excel','manual','incremental',NULL,NULL,'enabled','{}',datetime('now'),datetime('now'));
UPDATE data_sync_tasks SET syncType='wangdian_erp_goods',updatedAt=datetime('now') WHERE id='sync-task-erp-goods' AND syncType='erp_goods';
UPDATE data_sync_tasks SET taskCode='wangdian_platform_goods',syncType='wangdian_platform_goods',updatedAt=datetime('now') WHERE id='sync-task-platform-goods' AND taskCode='platform_goods';
UPDATE data_sync_tasks SET taskCode='wangdian_inventory',syncType='wangdian_inventory',updatedAt=datetime('now') WHERE id='sync-task-inventory' AND taskCode='inventory';
UPDATE data_sync_tasks SET taskCode='sales_fact_excel_import',syncType='sales_fact_excel_import',name='真实销售导入',executionMode='manual',updatedAt=datetime('now') WHERE id='sync-task-real-sales' AND (taskCode<>'sales_fact_excel_import' OR syncType<>'sales_fact_excel_import');

CREATE TABLE IF NOT EXISTS platform_goods_excel_import_rows (
  batchId TEXT NOT NULL,
  rowNumber INTEGER NOT NULL,
  sourceShopName TEXT,
  platformGoodsId TEXT,
  platformSkuId TEXT,
  merchantSkuCode TEXT,
  systemGoodsType TEXT,
  salesLinkId TEXT,
  salesLinkSkuId TEXT,
  erpSkuId TEXT,
  action TEXT NOT NULL,
  exceptionType TEXT,
  message TEXT,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(batchId,rowNumber),
  FOREIGN KEY(batchId) REFERENCES data_sync_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_platform_goods_excel_rows_action
  ON platform_goods_excel_import_rows(batchId,action);
CREATE TABLE IF NOT EXISTS erp_sync_runs (
  id TEXT PRIMARY KEY,
  syncCode TEXT NOT NULL UNIQUE,
  businessDate TEXT NOT NULL,
  version INTEGER NOT NULL,
  syncType TEXT NOT NULL DEFAULT 'legacy_combined',
  dataSource TEXT NOT NULL DEFAULT 'excel',
  status TEXT NOT NULL,
  goodsInfoBatchId TEXT,
  inventoryBatchId TEXT,
  platformGoodsBatchId TEXT,
  supersedesRunId TEXT,
  goodsInfoExportedAt TEXT,
  inventoryExportedAt TEXT,
  platformGoodsExportedAt TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  startedAt TEXT,
  completedAt TEXT,
  failedAt TEXT,
  errorSummary TEXT,
  snapshotId TEXT,
  snapshotStatus TEXT NOT NULL DEFAULT 'pending',
  snapshotCompletedAt TEXT,
  snapshotError TEXT,
  reconciliationStatus TEXT NOT NULL DEFAULT 'pending',
  reconciledAt TEXT,
  reconciliationError TEXT,
  reconciliationSummaryJson TEXT,
  updatedAt TEXT NOT NULL,
  UNIQUE(businessDate, version)
);

CREATE INDEX IF NOT EXISTS idx_erp_sync_runs_business_date ON erp_sync_runs(businessDate, version);
CREATE INDEX IF NOT EXISTS idx_erp_sync_runs_status ON erp_sync_runs(status, updatedAt);
CREATE TABLE IF NOT EXISTS erp_fact_snapshots (
  id TEXT PRIMARY KEY,
  syncRunId TEXT NOT NULL UNIQUE,
  businessDate TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  isCurrent INTEGER NOT NULL DEFAULT 0,
  supersedesSnapshotId TEXT,
  productCount INTEGER NOT NULL DEFAULT 0,
  inventoryRowCount INTEGER NOT NULL DEFAULT 0,
  salesLinkCount INTEGER NOT NULL DEFAULT 0,
  platformSkuCount INTEGER NOT NULL DEFAULT 0,
  productShopRelationCount INTEGER NOT NULL DEFAULT 0,
  contentHash TEXT,
  createdAt TEXT NOT NULL,
  completedAt TEXT,
  errorSummary TEXT,
  FOREIGN KEY(syncRunId) REFERENCES erp_sync_runs(id),
  FOREIGN KEY(supersedesSnapshotId) REFERENCES erp_fact_snapshots(id),
  UNIQUE(businessDate, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_fact_snapshots_current
  ON erp_fact_snapshots(businessDate) WHERE isCurrent = 1 AND status = 'completed';

CREATE TABLE IF NOT EXISTS product_daily_snapshots (
  snapshotId TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  productId TEXT NOT NULL,
  skuCode TEXT,
  productName TEXT,
  erpGoodsCount INTEGER NOT NULL DEFAULT 0,
  totalStock REAL,
  availableStock REAL,
  shippableStock REAL,
  purchaseInTransit REAL,
  pendingShipment REAL,
  sales7d REAL,
  sales30d REAL,
  sales90d REAL,
  sales180d REAL,
  totalSales REAL,
  platformCount INTEGER NOT NULL DEFAULT 0,
  shopCount INTEGER NOT NULL DEFAULT 0,
  salesLinkCount INTEGER NOT NULL DEFAULT 0,
  platformSkuCount INTEGER NOT NULL DEFAULT 0,
  productStatus TEXT,
  erpStatus TEXT,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(snapshotId, productId),
  FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id),
  FOREIGN KEY(productId) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS product_erp_daily_snapshots (
  snapshotId TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  productId TEXT NOT NULL,
  mappingId TEXT NOT NULL,
  erpGoodsId TEXT NOT NULL,
  goodsCode TEXT,
  merchantCode TEXT,
  specificationName TEXT,
  barcode TEXT,
  unit TEXT,
  erpStatus TEXT,
  unitCost REAL,
  stock REAL,
  shippableStock REAL,
  availableStock REAL,
  actualStock REAL,
  actualShippableStock REAL,
  purchaseInTransit REAL,
  pendingShipment REAL,
  sales7d REAL,
  sales30d REAL,
  sales90d REAL,
  sales180d REAL,
  totalSales REAL,
  sourceBatchId TEXT,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(snapshotId, mappingId),
  FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id),
  FOREIGN KEY(productId) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS sales_link_daily_snapshots (
  snapshotId TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  salesLinkId TEXT NOT NULL,
  shopId TEXT NOT NULL,
  platform TEXT,
  platformGoodsId TEXT,
  canonicalUrl TEXT,
  goodsTitle TEXT,
  linkStatus TEXT,
  price REAL,
  platformStock REAL,
  occupiedStock REAL,
  firstSeenAt TEXT,
  lastSeenBatchId TEXT,
  sourceBatchId TEXT,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(snapshotId, salesLinkId),
  FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id)
);

CREATE TABLE IF NOT EXISTS sales_link_sku_daily_snapshots (
  snapshotId TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  salesLinkSkuId TEXT NOT NULL,
  salesLinkId TEXT NOT NULL,
  platformSkuId TEXT,
  merchantCode TEXT,
  skuName TEXT,
  matchStatus TEXT,
  productId TEXT,
  manualBindingId TEXT,
  combinationFlag INTEGER NOT NULL DEFAULT 0,
  platformPrice REAL,
  platformStock REAL,
  occupiedStock REAL,
  sourceBatchId TEXT,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(snapshotId, salesLinkSkuId),
  FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id)
);

CREATE TABLE IF NOT EXISTS product_shop_daily_snapshots (
  snapshotId TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  productId TEXT NOT NULL,
  shopId TEXT NOT NULL,
  platform TEXT,
  salesLinkCount INTEGER NOT NULL DEFAULT 0,
  platformSkuCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(snapshotId, productId, shopId),
  FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_product_daily_snapshots_product_date
  ON product_daily_snapshots(productId, businessDate);
CREATE INDEX IF NOT EXISTS idx_product_erp_daily_snapshots_product_date
  ON product_erp_daily_snapshots(productId, businessDate);
CREATE INDEX IF NOT EXISTS idx_sales_link_daily_snapshots_link_date
  ON sales_link_daily_snapshots(salesLinkId, businessDate);
CREATE INDEX IF NOT EXISTS idx_sales_link_sku_daily_snapshots_product_date
  ON sales_link_sku_daily_snapshots(productId, businessDate);
CREATE INDEX IF NOT EXISTS idx_product_shop_daily_snapshots_product_date
  ON product_shop_daily_snapshots(productId, businessDate);

CREATE TABLE IF NOT EXISTS product_erp_mappings (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL UNIQUE,
  erpGoodsId TEXT NOT NULL,
  erpSkuId TEXT,
  merchantSkuCode TEXT NOT NULL COLLATE NOCASE UNIQUE,
  specificationName TEXT,
  unit TEXT,
  barcode TEXT,
  erpStatus TEXT,
  matchMethod TEXT NOT NULL,
  sourceBatchId TEXT,
  latestStateJson TEXT,
  currentState TEXT NOT NULL DEFAULT 'active',
  missingAt TEXT,
  lastSeenInventoryBatchId TEXT,
  inventoryCurrentState TEXT NOT NULL DEFAULT 'active',
  inventoryMissingAt TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(erpGoodsId) REFERENCES erp_goods(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE TABLE IF NOT EXISTS product_sku_changes (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  oldSkuCode TEXT NOT NULL,
  newSkuCode TEXT NOT NULL,
  reason TEXT NOT NULL,
  changedBy TEXT NOT NULL,
  impactJson TEXT,
  changedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_product_sku_changes_product_time
  ON product_sku_changes(productId, changedAt);

CREATE TABLE IF NOT EXISTS sales_shops (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  shopName TEXT NOT NULL,
  normalizedShopName TEXT NOT NULL,
  displayName TEXT NOT NULL,
  rawShopName TEXT,
  status TEXT NOT NULL,
  notes TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  UNIQUE(platform, normalizedShopName)
);

CREATE TABLE IF NOT EXISTS sales_shop_aliases (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  rawName TEXT NOT NULL COLLATE NOCASE UNIQUE,
  createdAt TEXT,
  FOREIGN KEY(shopId) REFERENCES sales_shops(id)
);

CREATE TABLE IF NOT EXISTS sales_links (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  platformGoodsId TEXT,
  platformGoodsCode TEXT,
  title TEXT,
  canonicalUrl TEXT,
  rawUrl TEXT,
  status TEXT,
  activityStatus TEXT,
  category TEXT,
  identityStrength TEXT NOT NULL,
  originSource TEXT NOT NULL DEFAULT 'legacy_unknown',
  enrichmentStatus TEXT NOT NULL DEFAULT 'complete',
  lastModifiedAt TEXT,
  lastSeenBatchId TEXT,
  currentState TEXT NOT NULL DEFAULT 'active',
  missingAt TEXT,
  lastImportedAt TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  FOREIGN KEY(shopId) REFERENCES sales_shops(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_links_goods_identity
  ON sales_links(shopId, platformGoodsId) WHERE platformGoodsId IS NOT NULL AND platformGoodsId <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_links_url_identity
  ON sales_links(shopId, canonicalUrl) WHERE (platformGoodsId IS NULL OR platformGoodsId = '') AND canonicalUrl IS NOT NULL AND canonicalUrl <> '';

CREATE TABLE IF NOT EXISTS sales_link_skus (
  id TEXT PRIMARY KEY,
  salesLinkId TEXT NOT NULL,
  productId TEXT,
  erpSkuId TEXT,
  platformSkuId TEXT,
  platformSkuCode TEXT,
  normalizedPlatformSkuCode TEXT,
  specificationName TEXT,
  normalizedSpecificationName TEXT,
  price REAL,
  platformStock REAL,
  occupiedStock REAL,
  systemGoodsType TEXT,
  syncEnabled INTEGER NOT NULL DEFAULT 0,
  lastSyncedStock REAL,
  lastSyncedAt TEXT,
  stopSyncReason TEXT,
  matchStatus TEXT NOT NULL,
  matchMethod TEXT,
  matchReason TEXT,
  lastSeenBatchId TEXT,
  currentState TEXT NOT NULL DEFAULT 'active',
  missingAt TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_link_skus_platform_id
  ON sales_link_skus(salesLinkId, platformSkuId) WHERE platformSkuId IS NOT NULL AND platformSkuId <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_link_skus_fallback
  ON sales_link_skus(salesLinkId, normalizedPlatformSkuCode, normalizedSpecificationName)
  WHERE platformSkuId IS NULL OR platformSkuId = '';

CREATE TABLE IF NOT EXISTS sales_link_sku_erp_mappings (
  id TEXT PRIMARY KEY,
  salesLinkSkuId TEXT NOT NULL,
  erpSkuId TEXT NOT NULL,
  mappingType TEXT NOT NULL DEFAULT 'single',
  quantity REAL NOT NULL DEFAULT 1,
  currentState TEXT NOT NULL DEFAULT 'active',
  sourceType TEXT NOT NULL DEFAULT 'legacy_migration',
  sourceBatchId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  invalidatedAt TEXT,
  FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  UNIQUE(salesLinkSkuId,erpSkuId),
  CHECK(mappingType IN ('single','combo')),
  CHECK(quantity > 0),
  CHECK(currentState IN ('active','inactive'))
);

CREATE INDEX IF NOT EXISTS idx_sales_link_sku_erp_mapping_link_state
  ON sales_link_sku_erp_mappings(salesLinkSkuId,currentState);
CREATE INDEX IF NOT EXISTS idx_sales_link_sku_erp_mapping_erp_state
  ON sales_link_sku_erp_mappings(erpSkuId,currentState);
CREATE INDEX IF NOT EXISTS idx_sales_link_sku_erp_mapping_batch
  ON sales_link_sku_erp_mappings(sourceBatchId);

CREATE TABLE IF NOT EXISTS wangdian_shop_mappings (
  id TEXT PRIMARY KEY,
  wangdianShopNo TEXT NOT NULL COLLATE NOCASE UNIQUE,
  wangdianShopId TEXT,
  shopId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(shopId) REFERENCES sales_shops(id)
);

CREATE TABLE IF NOT EXISTS wangdian_shop_discovery_batches (
  id TEXT PRIMARY KEY,
  targetShopId TEXT NOT NULL,
  requestStart TEXT NOT NULL,
  requestEnd TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  currentPage INTEGER NOT NULL DEFAULT 0,
  totalPages INTEGER,
  totalRows INTEGER,
  readRows INTEGER NOT NULL DEFAULT 0,
  errorMessage TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  startedAt TEXT,
  completedAt TEXT,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(targetShopId) REFERENCES sales_shops(id)
);

CREATE INDEX IF NOT EXISTS idx_wangdian_shop_discovery_status
  ON wangdian_shop_discovery_batches(status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS wangdian_shop_discovery_candidates (
  batchId TEXT NOT NULL,
  shopNo TEXT NOT NULL COLLATE NOCASE,
  returnedRows INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(batchId, shopNo),
  FOREIGN KEY(batchId) REFERENCES wangdian_shop_discovery_batches(id)
);

CREATE TABLE IF NOT EXISTS wangdian_shop_discovery_goods (
  batchId TEXT NOT NULL,
  shopNo TEXT NOT NULL COLLATE NOCASE,
  platformGoodsId TEXT NOT NULL,
  matched INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(batchId, shopNo, platformGoodsId),
  FOREIGN KEY(batchId) REFERENCES wangdian_shop_discovery_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_wangdian_shop_discovery_goods_match
  ON wangdian_shop_discovery_goods(batchId, matched, shopNo);

CREATE TABLE IF NOT EXISTS wangdian_platform_goods_sync_logs (
  id TEXT PRIMARY KEY,
  dataSyncBatchId TEXT,
  interfaceMethod TEXT NOT NULL DEFAULT 'goods.ApiGoods.search',
  importMode TEXT NOT NULL,
  requestStart TEXT,
  requestEnd TEXT,
  requestJson TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  windowCount INTEGER NOT NULL DEFAULT 0,
  pageCount INTEGER NOT NULL DEFAULT 0,
  sourceRowCount INTEGER NOT NULL DEFAULT 0,
  matchedCount INTEGER NOT NULL DEFAULT 0,
  exceptionCount INTEGER NOT NULL DEFAULT 0,
  createdCount INTEGER NOT NULL DEFAULT 0,
  updatedCount INTEGER NOT NULL DEFAULT 0,
  errorMessage TEXT,
  createdBy TEXT,
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY(dataSyncBatchId) REFERENCES data_sync_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_wangdian_platform_sync_time ON wangdian_platform_goods_sync_logs(startedAt DESC);

CREATE TABLE IF NOT EXISTS wangdian_platform_goods_sync_exceptions (
  id TEXT PRIMARY KEY,
  syncLogId TEXT NOT NULL,
  rowNumber INTEGER,
  exceptionType TEXT NOT NULL,
  shopNo TEXT,
  platformGoodsId TEXT,
  platformSkuId TEXT,
  merchantNo TEXT,
  message TEXT NOT NULL,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  FOREIGN KEY(syncLogId) REFERENCES wangdian_platform_goods_sync_logs(id)
);

CREATE INDEX IF NOT EXISTS idx_wangdian_platform_exceptions_log ON wangdian_platform_goods_sync_exceptions(syncLogId,exceptionType);

CREATE TABLE IF NOT EXISTS wangdian_inventory_sync_batches (
  id TEXT PRIMARY KEY,
  dataSyncBatchId TEXT,
  interfaceMethod TEXT NOT NULL DEFAULT 'wms.StockSpec.search2',
  importMode TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  requestStart TEXT,
  requestEnd TEXT,
  requestJson TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  windowCount INTEGER NOT NULL DEFAULT 0,
  pageCount INTEGER NOT NULL DEFAULT 0,
  sourceRowCount INTEGER NOT NULL DEFAULT 0,
  matchedCount INTEGER NOT NULL DEFAULT 0,
  exceptionCount INTEGER NOT NULL DEFAULT 0,
  createdCount INTEGER NOT NULL DEFAULT 0,
  updatedCount INTEGER NOT NULL DEFAULT 0,
  unchangedCount INTEGER NOT NULL DEFAULT 0,
  errorMessage TEXT,
  createdBy TEXT,
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY(dataSyncBatchId) REFERENCES data_sync_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_wangdian_inventory_sync_time ON wangdian_inventory_sync_batches(startedAt DESC);
CREATE INDEX IF NOT EXISTS idx_wangdian_inventory_sync_date ON wangdian_inventory_sync_batches(businessDate,status);

CREATE TABLE IF NOT EXISTS wangdian_inventory_sync_exceptions (
  id TEXT PRIMARY KEY,
  syncBatchId TEXT NOT NULL,
  rowNumber INTEGER,
  exceptionType TEXT NOT NULL,
  specNo TEXT,
  warehouseId TEXT,
  warehouseNo TEXT,
  message TEXT NOT NULL,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  FOREIGN KEY(syncBatchId) REFERENCES wangdian_inventory_sync_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_wangdian_inventory_exceptions_batch ON wangdian_inventory_sync_exceptions(syncBatchId,exceptionType);

CREATE TABLE IF NOT EXISTS erp_sku_warehouse_inventory_facts (
  id TEXT PRIMARY KEY,
  businessDate TEXT NOT NULL,
  erpSkuId TEXT NOT NULL,
  warehouseId TEXT NOT NULL,
  warehouseNo TEXT,
  warehouseName TEXT,
  warehouseType INTEGER,
  stockNum REAL NOT NULL DEFAULT 0,
  availableSendStock REAL NOT NULL DEFAULT 0,
  costPrice REAL,
  sales7d REAL NOT NULL DEFAULT 0,
  salesMonth REAL NOT NULL DEFAULT 0,
  sales90d REAL NOT NULL DEFAULT 0,
  sourceModifiedAt TEXT,
  sourceRecordId TEXT,
  rawSourceData TEXT NOT NULL DEFAULT '{}',
  syncBatchId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(syncBatchId) REFERENCES wangdian_inventory_sync_batches(id),
  UNIQUE(businessDate,erpSkuId,warehouseId)
);

CREATE INDEX IF NOT EXISTS idx_erp_sku_warehouse_inventory_sku_date ON erp_sku_warehouse_inventory_facts(erpSkuId,businessDate);
CREATE INDEX IF NOT EXISTS idx_erp_sku_warehouse_inventory_warehouse_date ON erp_sku_warehouse_inventory_facts(warehouseId,businessDate);

CREATE TABLE IF NOT EXISTS erp_sku_inventory_daily_summaries (
  id TEXT PRIMARY KEY,
  businessDate TEXT NOT NULL,
  erpSkuId TEXT NOT NULL,
  warehouseCount INTEGER NOT NULL DEFAULT 0,
  stockNum REAL NOT NULL DEFAULT 0,
  availableSendStock REAL NOT NULL DEFAULT 0,
  costPrice REAL,
  inventoryCostAmount REAL,
  sales7d REAL NOT NULL DEFAULT 0,
  salesMonth REAL NOT NULL DEFAULT 0,
  sales90d REAL NOT NULL DEFAULT 0,
  syncBatchId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(syncBatchId) REFERENCES wangdian_inventory_sync_batches(id),
  UNIQUE(businessDate,erpSkuId)
);

CREATE INDEX IF NOT EXISTS idx_erp_sku_inventory_summary_date ON erp_sku_inventory_daily_summaries(businessDate,erpSkuId);

CREATE TABLE IF NOT EXISTS connection_profiles (
  id TEXT PRIMARY KEY,
  salesLinkId TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mainImage TEXT,
  imageSource TEXT,
  ownerId TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  level TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  originSource TEXT NOT NULL DEFAULT 'legacy_unknown',
  originImportBatchId TEXT,
  identifiedAt TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
  FOREIGN KEY(originImportBatchId) REFERENCES connection_import_batches(id),
  FOREIGN KEY(ownerId) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_connection_profiles_owner_status
  ON connection_profiles(ownerId, status);

CREATE TABLE IF NOT EXISTS connection_benchmark_targets (
  id TEXT PRIMARY KEY,
  connectionId TEXT NOT NULL,
  targetType TEXT NOT NULL DEFAULT 'external',
  internalConnectionId TEXT,
  targetUrl TEXT,
  platform TEXT,
  title TEXT NOT NULL,
  mainImage TEXT,
  price REAL,
  salesInfo TEXT,
  reviewInfo TEXT,
  sellingPoints TEXT,
  detailContent TEXT,
  notes TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(connectionId) REFERENCES connection_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(internalConnectionId) REFERENCES connection_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  CHECK(targetType IN ('external','internal')),
  CHECK(internalConnectionId IS NULL OR connectionId <> internalConnectionId)
);

CREATE INDEX IF NOT EXISTS idx_connection_benchmark_targets_connection
  ON connection_benchmark_targets(connectionId, createdAt DESC);

CREATE TABLE IF NOT EXISTS connection_follows (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  connectionId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(userId) REFERENCES persons(id) ON DELETE CASCADE,
  FOREIGN KEY(connectionId) REFERENCES connection_profiles(id) ON DELETE CASCADE,
  UNIQUE(userId, connectionId)
);

CREATE INDEX IF NOT EXISTS idx_connection_follows_user_created
  ON connection_follows(userId, createdAt DESC);

CREATE TABLE IF NOT EXISTS connection_actions (
  id TEXT PRIMARY KEY,
  connectionProfileId TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  ownerId TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  dueDate TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(connectionProfileId) REFERENCES connection_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(ownerId) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_connection_actions_profile_created
  ON connection_actions(connectionProfileId, createdAt DESC);

CREATE TABLE IF NOT EXISTS connection_data_mappings (
  id TEXT PRIMARY KEY,
  sourceType TEXT NOT NULL,
  connectionId TEXT,
  salesLinkId TEXT,
  externalType TEXT NOT NULL,
  externalId TEXT NOT NULL,
  externalShopId TEXT NOT NULL DEFAULT '',
  externalDataJson TEXT NOT NULL DEFAULT '{}',
  matchStatus TEXT NOT NULL DEFAULT 'pending',
  matchMethod TEXT,
  confirmedBy TEXT,
  confirmedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  deletedBy TEXT,
  FOREIGN KEY(connectionId) REFERENCES connection_profiles(id),
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
  FOREIGN KEY(confirmedBy) REFERENCES persons(id),
  FOREIGN KEY(deletedBy) REFERENCES persons(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_data_mappings_external_active
  ON connection_data_mappings(sourceType, externalId, externalShopId)
  WHERE deletedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_connection_data_mappings_status_source
  ON connection_data_mappings(sourceType, matchStatus, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_connection_data_mappings_connection
  ON connection_data_mappings(connectionId, salesLinkId);

CREATE TABLE IF NOT EXISTS connection_import_batches (
  id TEXT PRIMARY KEY,
  sourceType TEXT NOT NULL,
  externalShopId TEXT NOT NULL DEFAULT '',
  fileName TEXT NOT NULL,
  fileHash TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  periodStart TEXT,
  periodEnd TEXT,
  periodType TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  totalRows INTEGER NOT NULL DEFAULT 0,
  matchedRows INTEGER NOT NULL DEFAULT 0,
  pendingRows INTEGER NOT NULL DEFAULT 0,
  errorRows INTEGER NOT NULL DEFAULT 0,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  importType TEXT,
  templateVersionId TEXT,
  sourcePlatform TEXT,
  previewSummaryJson TEXT NOT NULL DEFAULT '{}',
  completedAt TEXT,
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_connection_import_batches_source_created
  ON connection_import_batches(sourceType, createdAt DESC);

CREATE TABLE IF NOT EXISTS connection_import_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sourcePlatform TEXT NOT NULL DEFAULT '',
  dataType TEXT NOT NULL,
  currentVersionId TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_import_templates_name_type
  ON connection_import_templates(name,dataType);

CREATE TABLE IF NOT EXISTS connection_import_template_versions (
  id TEXT PRIMARY KEY,
  templateId TEXT NOT NULL,
  version INTEGER NOT NULL,
  fieldMappingsJson TEXT NOT NULL DEFAULT '{}',
  requiredFieldsJson TEXT NOT NULL DEFAULT '[]',
  fieldTypesJson TEXT NOT NULL DEFAULT '{}',
  matchRulesJson TEXT NOT NULL DEFAULT '{}',
  changeNote TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(templateId) REFERENCES connection_import_templates(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  UNIQUE(templateId,version)
);

CREATE TABLE IF NOT EXISTS connection_import_rows (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  rowNumber INTEGER NOT NULL,
  externalKey TEXT,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  normalizedDataJson TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  errorType TEXT,
  errorMessage TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(batchId) REFERENCES connection_import_batches(id),
  UNIQUE(batchId,rowNumber)
);

CREATE INDEX IF NOT EXISTS idx_connection_import_rows_batch_status
  ON connection_import_rows(batchId,status,rowNumber);

CREATE TABLE IF NOT EXISTS connection_sku_sales_facts (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  salesLinkId TEXT NOT NULL,
  salesLinkSkuId TEXT NOT NULL,
  erpSkuId TEXT,
  platformGoodsId TEXT NOT NULL,
  skuCode TEXT NOT NULL,
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  shippedQuantity REAL,
  salesAmount REAL,
  costAmount REAL,
  profitAmount REAL,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  FOREIGN KEY(batchId) REFERENCES connection_import_batches(id),
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
  FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_link_period
  ON connection_sku_sales_facts(salesLinkId,periodEnd DESC,periodStart DESC);

CREATE TABLE IF NOT EXISTS connection_sku_inventory_facts (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  salesLinkSkuId TEXT NOT NULL,
  skuCode TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  currentStock REAL,
  availableStock REAL,
  unitCost REAL,
  salesVelocity REAL,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  FOREIGN KEY(batchId) REFERENCES connection_import_batches(id),
  FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
  UNIQUE(salesLinkSkuId,businessDate)
);

CREATE INDEX IF NOT EXISTS idx_connection_sku_inventory_sku_date
  ON connection_sku_inventory_facts(salesLinkSkuId,businessDate DESC);

CREATE TABLE IF NOT EXISTS connection_period_snapshots (
  id TEXT PRIMARY KEY,
  connectionId TEXT,
  salesLinkId TEXT NOT NULL,
  mappingId TEXT NOT NULL,
  importBatchId TEXT NOT NULL,
  sourceType TEXT NOT NULL,
  externalId TEXT NOT NULL,
  externalDataJson TEXT NOT NULL DEFAULT '{}',
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  periodType TEXT NOT NULL DEFAULT 'rolling_30d',
  visitorCount REAL,
  viewCount REAL,
  cartCount REAL,
  orderBuyerCount REAL,
  payBuyerCount REAL,
  conversionRate REAL,
  payAmount REAL,
  payQuantity REAL,
  refundAmount REAL,
  competitionScore REAL,
  metricsJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  FOREIGN KEY(connectionId) REFERENCES connection_profiles(id),
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
  FOREIGN KEY(mappingId) REFERENCES connection_data_mappings(id),
  FOREIGN KEY(importBatchId) REFERENCES connection_import_batches(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_period_snapshots_link_period
  ON connection_period_snapshots(sourceType, salesLinkId, periodStart, periodEnd);

CREATE INDEX IF NOT EXISTS idx_connection_period_snapshots_connection_period
  ON connection_period_snapshots(connectionId, salesLinkId, periodEnd DESC, periodStart DESC);

CREATE INDEX IF NOT EXISTS idx_connection_period_snapshots_sales_link_period
  ON connection_period_snapshots(salesLinkId, periodEnd DESC, periodStart DESC);

CREATE TABLE IF NOT EXISTS connection_health_records (
  id TEXT PRIMARY KEY,
  connectionId TEXT NOT NULL,
  snapshotId TEXT NOT NULL,
  healthScore REAL NOT NULL,
  healthStatus TEXT NOT NULL,
  problemsJson TEXT NOT NULL DEFAULT '[]',
  suggestionsJson TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(connectionId) REFERENCES connection_profiles(id),
  FOREIGN KEY(snapshotId) REFERENCES connection_period_snapshots(id),
  UNIQUE(connectionId, snapshotId)
);

CREATE INDEX IF NOT EXISTS idx_connection_health_records_status_created
  ON connection_health_records(healthStatus, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_connection_health_records_connection_created
  ON connection_health_records(connectionId, createdAt DESC);

CREATE TABLE IF NOT EXISTS connection_diagnosis_entries (
  id TEXT PRIMARY KEY,
  connectionId TEXT NOT NULL,
  initiatedBy TEXT,
  joinedAt TEXT NOT NULL,
  anomalyReasonsJson TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(connectionId) REFERENCES connection_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(initiatedBy) REFERENCES persons(id),
  CHECK(status IN ('active','closed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_diagnosis_entries_active
  ON connection_diagnosis_entries(connectionId) WHERE status='active';

CREATE INDEX IF NOT EXISTS idx_connection_diagnosis_entries_joined
  ON connection_diagnosis_entries(status, joinedAt DESC);

CREATE TABLE IF NOT EXISTS connection_improvements (
  id TEXT PRIMARY KEY,
  connectionId TEXT NOT NULL,
  healthRecordId TEXT NOT NULL,
  actionId TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  beforeMetricsJson TEXT NOT NULL DEFAULT '{}',
  afterMetricsJson TEXT NOT NULL DEFAULT '{}',
  resultSummary TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(connectionId) REFERENCES connection_profiles(id),
  FOREIGN KEY(healthRecordId) REFERENCES connection_health_records(id),
  FOREIGN KEY(actionId) REFERENCES process_instances(id),
  UNIQUE(healthRecordId, actionId)
);

CREATE INDEX IF NOT EXISTS idx_connection_improvements_connection_status
  ON connection_improvements(connectionId, status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS platform_sku_manual_bindings (
  id TEXT PRIMARY KEY,
  salesLinkSkuId TEXT NOT NULL UNIQUE,
  productId TEXT NOT NULL,
  createdBy TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
  FOREIGN KEY(productId) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS finance_import_batches (
  id TEXT PRIMARY KEY,
  fileName TEXT NOT NULL,
  fileHash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'parsed',
  totalRows INTEGER NOT NULL DEFAULT 0,
  matchedRows INTEGER NOT NULL DEFAULT 0,
  pendingRows INTEGER NOT NULL DEFAULT 0,
  previewJson TEXT NOT NULL DEFAULT '[]',
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_finance_import_batches_created
  ON finance_import_batches(createdAt DESC);

CREATE TABLE IF NOT EXISTS finance_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keywordsJson TEXT NOT NULL DEFAULT '[]',
  entryType TEXT NOT NULL,
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'active',
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_finance_rules_status_priority
  ON finance_rules(status, priority ASC, createdAt ASC);

CREATE TABLE IF NOT EXISTS finance_entries (
  id TEXT PRIMARY KEY,
  importBatchId TEXT,
  businessDate TEXT NOT NULL,
  entryType TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  platform TEXT,
  productId TEXT,
  salesLinkId TEXT,
  externalId TEXT,
  sourceDataJson TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'confirmed',
  createdBy TEXT,
  approvedBy TEXT,
  approvedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(importBatchId) REFERENCES finance_import_batches(id),
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  FOREIGN KEY(approvedBy) REFERENCES persons(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_entries_batch_external
  ON finance_entries(importBatchId, externalId)
  WHERE importBatchId IS NOT NULL AND externalId IS NOT NULL AND externalId <> '';

CREATE INDEX IF NOT EXISTS idx_finance_entries_date_type
  ON finance_entries(businessDate, entryType, status);

CREATE INDEX IF NOT EXISTS idx_finance_entries_product_date
  ON finance_entries(productId, businessDate);

CREATE INDEX IF NOT EXISTS idx_finance_entries_link_date
  ON finance_entries(salesLinkId, businessDate);

CREATE TABLE IF NOT EXISTS product_lifecycle_events (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  fromStatus TEXT,
  toStatus TEXT NOT NULL,
  reason TEXT,
  changedBy TEXT,
  changedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(changedBy) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_product_lifecycle_events_product_time
  ON product_lifecycle_events(productId, changedAt DESC);

CREATE TABLE IF NOT EXISTS product_health_records (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  snapshotKey TEXT NOT NULL,
  healthScore REAL,
  healthStatus TEXT NOT NULL,
  metricsJson TEXT NOT NULL DEFAULT '{}',
  problemsJson TEXT NOT NULL DEFAULT '[]',
  suggestionsJson TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  UNIQUE(productId, snapshotKey)
);

CREATE INDEX IF NOT EXISTS idx_product_health_records_status_time
  ON product_health_records(healthStatus, updatedAt DESC);

CREATE TABLE IF NOT EXISTS product_issues (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  healthRecordId TEXT NOT NULL,
  issueType TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  detailJson TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(healthRecordId) REFERENCES product_health_records(id),
  UNIQUE(healthRecordId, issueType)
);

CREATE INDEX IF NOT EXISTS idx_product_issues_product_status
  ON product_issues(productId, status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS product_improvements (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  issueId TEXT NOT NULL,
  actionId TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  beforeMetricsJson TEXT NOT NULL DEFAULT '{}',
  afterMetricsJson TEXT NOT NULL DEFAULT '{}',
  resultSummary TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(issueId) REFERENCES product_issues(id),
  FOREIGN KEY(actionId) REFERENCES process_instances(id),
  UNIQUE(issueId, actionId)
);

CREATE INDEX IF NOT EXISTS idx_product_improvements_product_status
  ON product_improvements(productId, status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contactName TEXT,
  contactPhone TEXT,
  contactEmail TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_status_name ON suppliers(status, name);

CREATE TABLE IF NOT EXISTS supplier_products (
  id TEXT PRIMARY KEY,
  supplierId TEXT NOT NULL,
  productId TEXT NOT NULL,
  productErpMappingId TEXT,
  supplierSkuCode TEXT,
  unitCost REAL,
  safetyStock REAL,
  leadTimeDays INTEGER,
  isPrimary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(supplierId) REFERENCES suppliers(id),
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(productErpMappingId) REFERENCES product_erp_mappings(id),
  UNIQUE(supplierId, productId, productErpMappingId)
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_product ON supplier_products(productId, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_products_unique_product_level
  ON supplier_products(supplierId, productId) WHERE productErpMappingId IS NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(supplierId, status);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  businessCode TEXT NOT NULL UNIQUE,
  supplierId TEXT NOT NULL,
  orderType TEXT NOT NULL DEFAULT 'purchase',
  status TEXT NOT NULL DEFAULT 'draft',
  expectedAt TEXT,
  orderedAt TEXT,
  receivedAt TEXT,
  notes TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(supplierId) REFERENCES suppliers(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_status ON purchase_orders(supplierId, status, expectedAt);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchaseOrderId TEXT NOT NULL,
  productId TEXT NOT NULL,
  productErpMappingId TEXT,
  quantity REAL NOT NULL,
  receivedQuantity REAL NOT NULL DEFAULT 0,
  unitCost REAL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(purchaseOrderId) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(productErpMappingId) REFERENCES product_erp_mappings(id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(purchaseOrderId);

CREATE TABLE IF NOT EXISTS supplier_quality_issues (
  id TEXT PRIMARY KEY,
  supplierId TEXT NOT NULL,
  productId TEXT,
  purchaseOrderId TEXT,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  description TEXT,
  resultSummary TEXT,
  ownerId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(supplierId) REFERENCES suppliers(id),
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(purchaseOrderId) REFERENCES purchase_orders(id),
  FOREIGN KEY(ownerId) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_quality_issues_supplier_status ON supplier_quality_issues(supplierId, status, createdAt DESC);

CREATE TABLE IF NOT EXISTS supplier_evaluations (
  id TEXT PRIMARY KEY,
  supplierId TEXT NOT NULL,
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  costScore REAL NOT NULL,
  deliveryScore REAL NOT NULL,
  qualityScore REAL NOT NULL,
  cooperationScore REAL NOT NULL,
  totalScore REAL NOT NULL,
  notes TEXT,
  evaluatedBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(supplierId) REFERENCES suppliers(id),
  FOREIGN KEY(evaluatedBy) REFERENCES persons(id),
  UNIQUE(supplierId, periodStart, periodEnd)
);

CREATE INDEX IF NOT EXISTS idx_supplier_evaluations_supplier_period ON supplier_evaluations(supplierId, periodEnd DESC);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  customerCode TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL,
  businessType TEXT NOT NULL,
  sourceChannel TEXT,
  externalCustomerId TEXT,
  memberExternalId TEXT,
  phone TEXT,
  email TEXT,
  city TEXT,
  lifecycleStatus TEXT NOT NULL DEFAULT 'new',
  privacyLevel TEXT NOT NULL DEFAULT 'restricted',
  ownerId TEXT,
  notes TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(ownerId) REFERENCES persons(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  UNIQUE(businessType, sourceChannel, externalCustomerId)
);
CREATE INDEX IF NOT EXISTS idx_customers_type_lifecycle ON customers(businessType,lifecycleStatus,updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(ownerId,lifecycleStatus);

CREATE TABLE IF NOT EXISTS customer_consumptions (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  businessType TEXT NOT NULL,
  externalOrderId TEXT,
  sourceChannel TEXT,
  productId TEXT,
  salesLinkId TEXT,
  consumedAt TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(customerId) REFERENCES customers(id),
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
  UNIQUE(businessType,sourceChannel,externalOrderId)
);
CREATE INDEX IF NOT EXISTS idx_customer_consumptions_customer_date ON customer_consumptions(customerId,consumedAt DESC);

CREATE TABLE IF NOT EXISTS customer_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  color TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_tag_relations (
  customerId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(customerId,tagId),
  FOREIGN KEY(customerId) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY(tagId) REFERENCES customer_tags(id) ON DELETE CASCADE,
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);

CREATE TABLE IF NOT EXISTS customer_followups (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  followupType TEXT NOT NULL,
  content TEXT NOT NULL,
  nextFollowupAt TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(customerId) REFERENCES customers(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);
CREATE INDEX IF NOT EXISTS idx_customer_followups_customer ON customer_followups(customerId,createdAt DESC);

CREATE TABLE IF NOT EXISTS ai_analysis_records (
  id TEXT PRIMARY KEY,
  analysisType TEXT NOT NULL,
  objectType TEXT,
  objectId TEXT,
  title TEXT NOT NULL,
  question TEXT,
  providerMode TEXT NOT NULL,
  ruleVersion TEXT NOT NULL,
  sourceSnapshotJson TEXT NOT NULL,
  sourceReferencesJson TEXT NOT NULL,
  findingsJson TEXT NOT NULL,
  suggestionsJson TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  generatedBy TEXT NOT NULL,
  confirmedBy TEXT,
  confirmedAt TEXT,
  actionId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(generatedBy) REFERENCES persons(id),
  FOREIGN KEY(confirmedBy) REFERENCES persons(id),
  FOREIGN KEY(actionId) REFERENCES process_instances(id)
);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_records_user_status ON ai_analysis_records(generatedBy,status,createdAt DESC);
