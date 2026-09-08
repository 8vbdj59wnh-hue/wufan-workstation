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

CREATE TABLE IF NOT EXISTS assistant_device_sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  deviceName TEXT NOT NULL,
  tokenHash TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  lastUsedAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  revokedAt TEXT,
  FOREIGN KEY(userId) REFERENCES persons(id)
);
CREATE INDEX IF NOT EXISTS idx_assistant_device_sessions_user ON assistant_device_sessions(userId,createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_device_sessions_expiry ON assistant_device_sessions(expiresAt,revokedAt);

CREATE TABLE IF NOT EXISTS permission_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS upload_audits (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  requestPath TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fileCount INTEGER NOT NULL DEFAULT 0,
  originalNamesJson TEXT NOT NULL DEFAULT '[]',
  mimeTypesJson TEXT NOT NULL DEFAULT '[]',
  byteSize INTEGER NOT NULL DEFAULT 0,
  reservedBytes INTEGER NOT NULL DEFAULT 0,
  quotaLimitBytes INTEGER NOT NULL,
  responseStatus INTEGER,
  reasonCode TEXT,
  reasonMessage TEXT,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL,
  completedAt TEXT,
  CHECK(status IN ('pending','success','rejected')),
  CHECK(fileCount >= 0),
  CHECK(byteSize >= 0),
  CHECK(reservedBytes >= 0),
  CHECK(quotaLimitBytes > 0)
);
CREATE INDEX IF NOT EXISTS idx_upload_audits_user_created ON upload_audits(userId,createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_upload_audits_status_created ON upload_audits(status,createdAt DESC);

CREATE TABLE IF NOT EXISTS api_usage_ledger (
  method TEXT NOT NULL,
  routePattern TEXT NOT NULL,
  source TEXT NOT NULL,
  callCount INTEGER NOT NULL DEFAULT 0,
  successCount INTEGER NOT NULL DEFAULT 0,
  clientErrorCount INTEGER NOT NULL DEFAULT 0,
  serverErrorCount INTEGER NOT NULL DEFAULT 0,
  firstAccessAt TEXT NOT NULL,
  lastAccessAt TEXT NOT NULL,
  lastStatusCode INTEGER,
  PRIMARY KEY (method, routePattern, source),
  CHECK(callCount >= 0),
  CHECK(successCount >= 0),
  CHECK(clientErrorCount >= 0),
  CHECK(serverErrorCount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_api_usage_ledger_last_access ON api_usage_ledger(lastAccessAt DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_ledger_route_method ON api_usage_ledger(routePattern,method);

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

CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status,dueDate,id);
CREATE INDEX IF NOT EXISTS idx_tasks_executor_status_due ON tasks(executorId,status,dueDate,id);
CREATE INDEX IF NOT EXISTS idx_tasks_department_status_due ON tasks(departmentId,status,dueDate,id);
CREATE INDEX IF NOT EXISTS idx_tasks_process_instance ON tasks(processInstanceId,id);
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goalId,id);
CREATE INDEX IF NOT EXISTS idx_tasks_template_usage ON tasks(taskTemplateId,updatedAt,id);
CREATE INDEX IF NOT EXISTS idx_tasks_process_node_usage ON tasks(processNodeId,updatedAt,id);

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

CREATE INDEX IF NOT EXISTS idx_process_instances_goal_created ON process_instances(goalId,createdAt DESC,id);
CREATE INDEX IF NOT EXISTS idx_process_instances_task_template ON process_instances(taskTemplateId,createdAt,id);
CREATE INDEX IF NOT EXISTS idx_process_instances_template ON process_instances(templateId,createdAt,id);

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

CREATE INDEX IF NOT EXISTS idx_work_plans_process_type ON work_plans(processInstanceId,workType,id);

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

CREATE TABLE IF NOT EXISTS product_marketing_assets (
  id TEXT PRIMARY KEY,
  productId TEXT,
  erpSkuId TEXT,
  positioning TEXT,
  targetAudience TEXT,
  usageScenariosJson TEXT NOT NULL DEFAULT '[]',
  sellingPointsJson TEXT NOT NULL DEFAULT '[]',
  productStory TEXT,
  keywordsJson TEXT NOT NULL DEFAULT '[]',
  createdBy TEXT,
  updatedBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  FOREIGN KEY(updatedBy) REFERENCES persons(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_product_marketing_assets_product
  ON product_marketing_assets(productId);

CREATE TABLE IF NOT EXISTS product_business_profiles (
  id TEXT PRIMARY KEY,
  erpSkuId TEXT NOT NULL UNIQUE,
  businessStatus TEXT,
  lifecycle TEXT,
  ownerId TEXT,
  brandOverride TEXT,
  categoryOverride TEXT,
  businessRole TEXT,
  displayNameOverride TEXT,
  createdBy TEXT,
  updatedBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(ownerId) REFERENCES persons(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  FOREIGN KEY(updatedBy) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_product_business_profiles_owner_status
  ON product_business_profiles(ownerId,businessStatus,updatedAt DESC);

CREATE TABLE IF NOT EXISTS action_products (
  id TEXT PRIMARY KEY,
  actionId TEXT NOT NULL,
  productId TEXT,
  erpSkuId TEXT,
  createdAt TEXT,
  UNIQUE(actionId, productId),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
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

CREATE TABLE IF NOT EXISTS erp_sku_business_usages (
  id TEXT PRIMARY KEY,
  erpSkuId TEXT NOT NULL,
  usageType TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  sourceType TEXT NOT NULL,
  reviewedBy TEXT,
  reviewedAt TEXT,
  decisionNote TEXT,
  supersedesUsageId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(reviewedBy) REFERENCES persons(id),
  FOREIGN KEY(supersedesUsageId) REFERENCES erp_sku_business_usages(id),
  CHECK(usageType IN ('product','accounting_auxiliary','shipping_adjustment','other_adjustment')),
  CHECK(status IN ('proposed','active','inactive','superseded','conflict')),
  CHECK(sourceType IN ('manual_confirmation','system_suggestion','system_migration','erp_import')),
  CHECK(status <> 'active' OR (reviewedBy IS NOT NULL AND reviewedAt IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_sku_business_usages_one_active
  ON erp_sku_business_usages(erpSkuId) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_sku_business_usages_open_suggestion
  ON erp_sku_business_usages(erpSkuId,usageType,sourceType) WHERE status='proposed';
CREATE INDEX IF NOT EXISTS idx_erp_sku_business_usages_status_updated
  ON erp_sku_business_usages(status,updatedAt DESC);

-- Architecture Upgrade-003 Phase 9B: ERP purpose is independent from the
-- operating lifecycle and from the legacy sales-line business usage contract.
-- Automatic evidence remains a read-only projection; this table stores only an
-- administrator's explicit confirmation and must not be overwritten by sync.
CREATE TABLE IF NOT EXISTS erp_sku_usage_profiles (
  erpSkuId TEXT PRIMARY KEY,
  confirmedPrimaryUsage TEXT NOT NULL,
  confirmedSaleGoods INTEGER NOT NULL DEFAULT 0,
  confirmedBundleComponent INTEGER NOT NULL DEFAULT 0,
  confirmedBy TEXT NOT NULL,
  confirmedAt TEXT NOT NULL,
  evidenceNote TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(confirmedBy) REFERENCES persons(id),
  CHECK(confirmedPrimaryUsage IN ('sale_goods','packaging_material','consumable_auxiliary','unknown')),
  CHECK(confirmedSaleGoods IN (0,1)),
  CHECK(confirmedBundleComponent IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_erp_sku_usage_profiles_usage
  ON erp_sku_usage_profiles(confirmedPrimaryUsage,updatedAt DESC);

CREATE TRIGGER IF NOT EXISTS trg_erp_sku_usage_supersedes_insert
  BEFORE INSERT ON erp_sku_business_usages
  WHEN NEW.supersedesUsageId IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM erp_sku_business_usages previous
      WHERE previous.id=NEW.supersedesUsageId AND previous.erpSkuId=NEW.erpSkuId
    )
  BEGIN
    SELECT RAISE(ABORT,'superseded ERP SKU usage must belong to the same ERP SKU');
  END;

CREATE TRIGGER IF NOT EXISTS trg_erp_sku_usage_supersedes_update
  BEFORE UPDATE OF supersedesUsageId,erpSkuId ON erp_sku_business_usages
  WHEN NEW.supersedesUsageId IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM erp_sku_business_usages previous
      WHERE previous.id=NEW.supersedesUsageId AND previous.erpSkuId=NEW.erpSkuId
    )
  BEGIN
    SELECT RAISE(ABORT,'superseded ERP SKU usage must belong to the same ERP SKU');
  END;

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
  resolvedReason TEXT,
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
  ('sync-task-wangdian-suites','wangdian_suites','旺店通组合装同步','wangdian_suites','wangdian_api','goods.Suite.search','api','both','incremental','15 2 * * *','每天02:15','paused','{"baseline":"combo_master_excel"}',datetime('now'),datetime('now')),
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
  shopId TEXT,
  platform TEXT,
  platformGoodsId TEXT,
  platformSkuId TEXT,
  merchantSkuCode TEXT,
  systemGoodsType TEXT,
  salesLinkId TEXT,
  salesLinkSkuId TEXT,
  erpSkuId TEXT,
  action TEXT NOT NULL,
  shopAction TEXT,
  linkAction TEXT,
  skuAction TEXT,
  relationAction TEXT,
  exceptionType TEXT,
  message TEXT,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(batchId,rowNumber),
  FOREIGN KEY(batchId) REFERENCES data_sync_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_platform_goods_excel_rows_action
  ON platform_goods_excel_import_rows(batchId,action);

CREATE TABLE IF NOT EXISTS platform_goods_excel_source_files (
  sourceFileHash TEXT PRIMARY KEY,
  fileName TEXT NOT NULL,
  contentBlob BLOB NOT NULL,
  firstUploadedAt TEXT NOT NULL,
  lastUploadedAt TEXT NOT NULL,
  uploadedBy TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_goods_excel_source_files_time
  ON platform_goods_excel_source_files(lastUploadedAt DESC);
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
  status TEXT,
  activityStatus TEXT,
  category TEXT,
  displayName TEXT,
  ownerId TEXT,
  managementStatus TEXT NOT NULL DEFAULT 'active',
  managementNotes TEXT,
  mainImage TEXT,
  imageSource TEXT,
  managementLevel TEXT NOT NULL DEFAULT 'new',
  managementOriginSource TEXT NOT NULL DEFAULT 'asset_native',
  managementOriginImportBatchId TEXT,
  managementIdentifiedAt TEXT,
  managementCreatedBy TEXT,
  identityStrength TEXT NOT NULL,
  originSource TEXT NOT NULL DEFAULT 'legacy_unknown',
  enrichmentStatus TEXT NOT NULL DEFAULT 'complete',
  lastModifiedAt TEXT,
  currentState TEXT NOT NULL DEFAULT 'active',
  missingAt TEXT,
  lastImportedAt TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  FOREIGN KEY(shopId) REFERENCES sales_shops(id),
  FOREIGN KEY(ownerId) REFERENCES persons(id),
  FOREIGN KEY(managementOriginImportBatchId) REFERENCES connection_import_batches(id),
  FOREIGN KEY(managementCreatedBy) REFERENCES persons(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_links_goods_identity
  ON sales_links(shopId, platformGoodsId) WHERE platformGoodsId IS NOT NULL AND platformGoodsId <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_links_url_identity
  ON sales_links(shopId, canonicalUrl) WHERE (platformGoodsId IS NULL OR platformGoodsId = '') AND canonicalUrl IS NOT NULL AND canonicalUrl <> '';

CREATE TABLE IF NOT EXISTS sales_link_skus (
  id TEXT PRIMARY KEY,
  salesLinkId TEXT NOT NULL,
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
  currentState TEXT NOT NULL DEFAULT 'active',
  missingAt TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_link_skus_platform_id
  ON sales_link_skus(salesLinkId, platformSkuId) WHERE platformSkuId IS NOT NULL AND platformSkuId <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_link_skus_fallback
  ON sales_link_skus(salesLinkId, normalizedPlatformSkuCode, normalizedSpecificationName)
  WHERE platformSkuId IS NULL OR platformSkuId = '';

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
CREATE INDEX IF NOT EXISTS idx_erp_sku_inventory_summary_sku_date ON erp_sku_inventory_daily_summaries(erpSkuId,businessDate DESC,updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_sales_link_skus_link_state ON sales_link_skus(salesLinkId,currentState);

CREATE TABLE IF NOT EXISTS connection_business_profiles (
  id TEXT PRIMARY KEY,
  connectionId TEXT NOT NULL,
  positioningType TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  effectiveFrom TEXT NOT NULL,
  effectiveTo TEXT,
  decisionReason TEXT NOT NULL,
  decidedBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(connectionId) REFERENCES sales_links(id),
  FOREIGN KEY(decidedBy) REFERENCES persons(id),
  CHECK(positioningType IN ('sales_growth','balanced_sales','long_tail','profit_contribution')),
  CHECK(status IN ('active','historical')),
  CHECK(length(trim(decisionReason)) > 0),
  CHECK(effectiveTo IS NULL OR effectiveTo >= effectiveFrom)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_business_profiles_one_active
  ON connection_business_profiles(connectionId) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_connection_business_profiles_history
  ON connection_business_profiles(connectionId,effectiveFrom DESC,id DESC);

CREATE TABLE IF NOT EXISTS connection_goal_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  positioningType TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  windowDays INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK(positioningType IN ('sales_growth','balanced_sales','long_tail','profit_contribution')),
  CHECK(version > 0),
  CHECK(windowDays > 0),
  CHECK(status IN ('active','inactive')),
  UNIQUE(code,version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_goal_templates_one_active
  ON connection_goal_templates(positioningType) WHERE status='active';

CREATE TABLE IF NOT EXISTS connection_goal_template_metrics (
  id TEXT PRIMARY KEY,
  templateId TEXT NOT NULL,
  metricCode TEXT NOT NULL,
  weight REAL NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(templateId) REFERENCES connection_goal_templates(id),
  CHECK(metricCode IN ('sales_amount','profit_amount')),
  CHECK(weight > 0 AND weight <= 1),
  UNIQUE(templateId,metricCode)
);

CREATE INDEX IF NOT EXISTS idx_connection_goal_template_metrics_order
  ON connection_goal_template_metrics(templateId,sortOrder,id);

CREATE TRIGGER IF NOT EXISTS trg_connection_goal_templates_no_delete
  BEFORE DELETE ON connection_goal_templates
  BEGIN
    SELECT RAISE(ABORT, '目标模板不可直接删除，请停用或创建新版本');
  END;

CREATE TRIGGER IF NOT EXISTS trg_connection_goal_template_metrics_weight_limit_insert
  BEFORE INSERT ON connection_goal_template_metrics
  WHEN NOT EXISTS (
    SELECT 1 FROM connection_goal_template_metrics
    WHERE id=NEW.id OR (templateId=NEW.templateId AND metricCode=NEW.metricCode)
  )
  AND (SELECT COALESCE(SUM(weight),0) FROM connection_goal_template_metrics WHERE templateId=NEW.templateId) + NEW.weight > 1.000001
  BEGIN
    SELECT RAISE(ABORT, '目标模板指标权重合计不能超过100%');
  END;

CREATE TRIGGER IF NOT EXISTS trg_connection_goal_template_metrics_weight_limit_update
  BEFORE UPDATE OF weight,templateId ON connection_goal_template_metrics
  WHEN (SELECT COALESCE(SUM(weight),0) FROM connection_goal_template_metrics WHERE templateId=NEW.templateId AND id<>OLD.id) + NEW.weight > 1.000001
  BEGIN
    SELECT RAISE(ABORT, '目标模板指标权重合计不能超过100%');
  END;

INSERT OR IGNORE INTO connection_goal_templates
  (id,code,name,positioningType,version,windowDays,status,createdAt,updatedAt)
VALUES
  ('connection-goal-template-sales-growth-v1','sales_growth','引流爆款模板','sales_growth',1,30,'active','2026-08-18T00:00:00.000Z','2026-08-18T00:00:00.000Z'),
  ('connection-goal-template-balanced-sales-v1','balanced_sales','优质动销款模板','balanced_sales',1,30,'active','2026-08-18T00:00:00.000Z','2026-08-18T00:00:00.000Z'),
  ('connection-goal-template-long-tail-v1','long_tail','长尾动销款模板','long_tail',1,30,'active','2026-08-18T00:00:00.000Z','2026-08-18T00:00:00.000Z'),
  ('connection-goal-template-profit-contribution-v1','profit_contribution','高毛利款模板','profit_contribution',1,30,'active','2026-08-18T00:00:00.000Z','2026-08-18T00:00:00.000Z');

INSERT OR IGNORE INTO connection_goal_template_metrics
  (id,templateId,metricCode,weight,sortOrder)
VALUES
  ('connection-goal-template-sales-growth-sales','connection-goal-template-sales-growth-v1','sales_amount',0.70,1),
  ('connection-goal-template-sales-growth-profit','connection-goal-template-sales-growth-v1','profit_amount',0.30,2),
  ('connection-goal-template-balanced-sales-sales','connection-goal-template-balanced-sales-v1','sales_amount',0.50,1),
  ('connection-goal-template-balanced-sales-profit','connection-goal-template-balanced-sales-v1','profit_amount',0.50,2),
  ('connection-goal-template-long-tail-sales','connection-goal-template-long-tail-v1','sales_amount',0.60,1),
  ('connection-goal-template-long-tail-profit','connection-goal-template-long-tail-v1','profit_amount',0.40,2),
  ('connection-goal-template-profit-contribution-sales','connection-goal-template-profit-contribution-v1','sales_amount',0.30,1),
  ('connection-goal-template-profit-contribution-profit','connection-goal-template-profit-contribution-v1','profit_amount',0.70,2);

CREATE TABLE IF NOT EXISTS connection_goal_plans (
  id TEXT PRIMARY KEY,
  connectionId TEXT NOT NULL,
  positioningId TEXT NOT NULL,
  templateId TEXT NOT NULL,
  templateVersion INTEGER NOT NULL,
  targetMode TEXT NOT NULL,
  status TEXT NOT NULL,
  baselineStart TEXT,
  baselineEnd TEXT,
  effectiveFrom TEXT,
  effectiveTo TEXT,
  createdBy TEXT NOT NULL,
  approvedBy TEXT,
  approvalReason TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(connectionId) REFERENCES sales_links(id),
  FOREIGN KEY(positioningId) REFERENCES connection_business_profiles(id),
  FOREIGN KEY(templateId) REFERENCES connection_goal_templates(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  FOREIGN KEY(approvedBy) REFERENCES persons(id),
  CHECK(targetMode IN ('system_suggested','manual','hybrid')),
  CHECK(status IN ('draft','pending_confirm','active','expired','cancelled')),
  CHECK(templateVersion > 0),
  CHECK((status <> 'active') OR (effectiveFrom IS NOT NULL AND effectiveTo IS NOT NULL AND approvedBy IS NOT NULL)),
  CHECK(effectiveTo IS NULL OR effectiveFrom IS NULL OR effectiveTo >= effectiveFrom)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_goal_plans_one_active
  ON connection_goal_plans(connectionId) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_connection_goal_plans_history
  ON connection_goal_plans(connectionId,createdAt DESC,id DESC);

CREATE TABLE IF NOT EXISTS connection_goal_metrics (
  id TEXT PRIMARY KEY,
  goalPlanId TEXT NOT NULL,
  metricCode TEXT NOT NULL,
  baselineValue REAL,
  suggestedTargetValue REAL,
  finalTargetValue REAL,
  weight REAL NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(goalPlanId) REFERENCES connection_goal_plans(id),
  CHECK(metricCode IN ('sales_amount','profit_amount')),
  CHECK(weight > 0 AND weight <= 1),
  CHECK(metricCode <> 'sales_amount' OR finalTargetValue IS NULL OR finalTargetValue >= 0),
  UNIQUE(goalPlanId,metricCode)
);

CREATE INDEX IF NOT EXISTS idx_connection_goal_metrics_plan
  ON connection_goal_metrics(goalPlanId,metricCode);

CREATE TABLE IF NOT EXISTS connection_goal_evaluations (
  id TEXT PRIMARY KEY,
  connectionId TEXT NOT NULL,
  goalPlanId TEXT NOT NULL UNIQUE,
  periodStart TEXT,
  periodEnd TEXT,
  salesActual REAL,
  profitActual REAL,
  salesAchievement REAL,
  profitAchievement REAL,
  totalAchievement REAL,
  grade TEXT,
  evaluationStatus TEXT NOT NULL,
  statusReason TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(connectionId) REFERENCES sales_links(id),
  FOREIGN KEY(goalPlanId) REFERENCES connection_goal_plans(id),
  CHECK(evaluationStatus IN ('evaluated','pending')),
  CHECK(grade IS NULL OR grade IN ('excellent','good','on_target','underperforming')),
  CHECK(periodEnd IS NULL OR periodStart IS NULL OR periodEnd >= periodStart)
);

CREATE INDEX IF NOT EXISTS idx_connection_goal_evaluations_connection
  ON connection_goal_evaluations(connectionId,updatedAt DESC);

CREATE TABLE IF NOT EXISTS connection_goal_init_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  CHECK(length(trim(name)) > 0),
  CHECK(status IN ('draft','positioning','target_confirm','evaluation','completed'))
);

CREATE INDEX IF NOT EXISTS idx_connection_goal_init_batches_status
  ON connection_goal_init_batches(status,createdAt DESC,id DESC);

CREATE TABLE IF NOT EXISTS connection_goal_init_batch_links (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  connectionId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'selected',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(batchId) REFERENCES connection_goal_init_batches(id),
  FOREIGN KEY(connectionId) REFERENCES sales_links(id),
  CHECK(status IN ('selected','positioning_pending','target_pending','active','excluded')),
  UNIQUE(batchId,connectionId)
);

CREATE INDEX IF NOT EXISTS idx_connection_goal_init_batch_links_batch_status
  ON connection_goal_init_batch_links(batchId,status,updatedAt DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_connection_goal_init_batch_links_connection
  ON connection_goal_init_batch_links(connectionId,createdAt DESC,id DESC);

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
  FOREIGN KEY(connectionId) REFERENCES sales_links(id) ON DELETE CASCADE,
  FOREIGN KEY(internalConnectionId) REFERENCES sales_links(id) ON DELETE SET NULL,
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
  FOREIGN KEY(connectionId) REFERENCES sales_links(id) ON DELETE CASCADE,
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
  FOREIGN KEY(connectionProfileId) REFERENCES sales_links(id) ON DELETE CASCADE,
  FOREIGN KEY(ownerId) REFERENCES persons(id)
);

CREATE INDEX IF NOT EXISTS idx_connection_actions_profile_created
  ON connection_actions(connectionProfileId, createdAt DESC);

CREATE TABLE IF NOT EXISTS connection_inspection_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  currentVersionId TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK(status IN ('active','inactive','archived'))
);

CREATE TABLE IF NOT EXISTS connection_inspections (
  id TEXT PRIMARY KEY,
  salesLinkId TEXT NOT NULL,
  inspectorId TEXT NOT NULL,
  templateVersionId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  gradeACount INTEGER NOT NULL DEFAULT 0,
  gradeBCount INTEGER NOT NULL DEFAULT 0,
  gradeCCount INTEGER NOT NULL DEFAULT 0,
  gradeDCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id) ON DELETE CASCADE,
  FOREIGN KEY(inspectorId) REFERENCES persons(id),
  FOREIGN KEY(templateVersionId) REFERENCES template_asset_versions(id),
  CHECK(status IN ('draft','completed')),
  CHECK(gradeACount >= 0 AND gradeBCount >= 0 AND gradeCCount >= 0 AND gradeDCount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_inspections_single_draft
  ON connection_inspections(salesLinkId) WHERE status='draft';
CREATE INDEX IF NOT EXISTS idx_connection_inspections_link_completed
  ON connection_inspections(salesLinkId,completedAt DESC,createdAt DESC);

CREATE TABLE IF NOT EXISTS connection_inspection_results (
  id TEXT PRIMARY KEY,
  inspectionId TEXT NOT NULL,
  itemCode TEXT NOT NULL,
  itemNameSnapshot TEXT NOT NULL,
  itemDescriptionSnapshot TEXT NOT NULL DEFAULT '',
  itemSortOrder INTEGER NOT NULL,
  criterionCode TEXT NOT NULL,
  criterionNameSnapshot TEXT NOT NULL,
  criterionDescriptionSnapshot TEXT NOT NULL DEFAULT '',
  criterionSortOrder INTEGER NOT NULL,
  grade TEXT,
  note TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(inspectionId) REFERENCES connection_inspections(id) ON DELETE CASCADE,
  CHECK(grade IS NULL OR grade IN ('A','B','C','D')),
  UNIQUE(inspectionId,criterionCode)
);

CREATE INDEX IF NOT EXISTS idx_connection_inspection_results_inspection
  ON connection_inspection_results(inspectionId,itemSortOrder,criterionSortOrder);

CREATE TABLE IF NOT EXISTS connection_inspection_issues (
  id TEXT PRIMARY KEY,
  inspectionId TEXT NOT NULL,
  inspectionResultId TEXT NOT NULL UNIQUE,
  salesLinkId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  itemNameSnapshot TEXT NOT NULL,
  criterionNameSnapshot TEXT NOT NULL,
  gradeSnapshot TEXT NOT NULL,
  noteSnapshot TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(inspectionId) REFERENCES connection_inspections(id) ON DELETE CASCADE,
  FOREIGN KEY(inspectionResultId) REFERENCES connection_inspection_results(id) ON DELETE CASCADE,
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id) ON DELETE CASCADE,
  CHECK(status IN ('candidate','action_created','awaiting_reinspection','closed')),
  CHECK(gradeSnapshot IN ('B','C','D'))
);

CREATE INDEX IF NOT EXISTS idx_connection_inspection_issues_link_status
  ON connection_inspection_issues(salesLinkId,status,createdAt DESC);

CREATE TABLE IF NOT EXISTS connection_inspection_issue_actions (
  id TEXT PRIMARY KEY,
  inspectionIssueId TEXT NOT NULL,
  actionId TEXT NOT NULL,
  sourceGrade TEXT NOT NULL,
  sourceNote TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  FOREIGN KEY(inspectionIssueId) REFERENCES connection_inspection_issues(id) ON DELETE CASCADE,
  FOREIGN KEY(actionId) REFERENCES connection_actions(id) ON DELETE CASCADE,
  CHECK(sourceGrade IN ('B','C','D')),
  UNIQUE(inspectionIssueId,actionId)
);

CREATE TABLE IF NOT EXISTS connection_action_tasks (
  id TEXT PRIMARY KEY,
  actionId TEXT NOT NULL,
  taskId TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(actionId) REFERENCES connection_actions(id) ON DELETE CASCADE,
  FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(actionId,taskId)
);

CREATE TABLE IF NOT EXISTS connection_inspection_schedules (
  id TEXT PRIMARY KEY,
  salesLinkId TEXT NOT NULL UNIQUE,
  assigneeId TEXT NOT NULL,
  cadenceType TEXT NOT NULL DEFAULT 'manual',
  intervalDays INTEGER,
  enabled INTEGER NOT NULL DEFAULT 0,
  lastInspectionAt TEXT,
  nextInspectionAt TEXT,
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id) ON DELETE CASCADE,
  FOREIGN KEY(assigneeId) REFERENCES persons(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  CHECK(cadenceType IN ('manual','days_30','days_60','days_90','custom')),
  CHECK(enabled IN (0,1)),
  CHECK((cadenceType='manual' AND intervalDays IS NULL AND enabled=0) OR
    (cadenceType<>'manual' AND intervalDays IS NOT NULL AND intervalDays>0))
);

CREATE INDEX IF NOT EXISTS idx_connection_inspection_schedules_due
  ON connection_inspection_schedules(enabled,nextInspectionAt);

CREATE TABLE IF NOT EXISTS connection_inspection_schedule_tasks (
  id TEXT PRIMARY KEY,
  scheduleId TEXT NOT NULL,
  dueDate TEXT NOT NULL,
  taskId TEXT NOT NULL UNIQUE,
  inspectionId TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(scheduleId) REFERENCES connection_inspection_schedules(id) ON DELETE CASCADE,
  FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(inspectionId) REFERENCES connection_inspections(id) ON DELETE SET NULL,
  UNIQUE(scheduleId,dueDate)
);

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
  FOREIGN KEY(connectionId) REFERENCES sales_links(id),
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
  resolvedAt TEXT,
  resolvedReason TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(batchId) REFERENCES connection_import_batches(id),
  UNIQUE(batchId,rowNumber)
);

CREATE INDEX IF NOT EXISTS idx_connection_import_rows_batch_status
  ON connection_import_rows(batchId,status,rowNumber);

CREATE TABLE IF NOT EXISTS connection_bulk_platform_import_batches (
  id TEXT PRIMARY KEY,
  batchHash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting',
  fileCount INTEGER NOT NULL DEFAULT 0,
  processedCount INTEGER NOT NULL DEFAULT 0,
  completedCount INTEGER NOT NULL DEFAULT 0,
  failedCount INTEGER NOT NULL DEFAULT 0,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY(createdBy) REFERENCES persons(id)
);

CREATE TABLE IF NOT EXISTS connection_bulk_platform_import_files (
  id TEXT PRIMARY KEY,
  bulkBatchId TEXT NOT NULL,
  sequenceNo INTEGER NOT NULL,
  fileName TEXT NOT NULL,
  fileHash TEXT NOT NULL,
  contentBlob BLOB,
  status TEXT NOT NULL DEFAULT 'waiting',
  foundationBatchId TEXT,
  platform TEXT,
  shopId TEXT,
  shop TEXT,
  summaryJson TEXT NOT NULL DEFAULT '{}',
  idempotent INTEGER NOT NULL DEFAULT 0,
  errorMessage TEXT,
  startedAt TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(bulkBatchId) REFERENCES connection_bulk_platform_import_batches(id),
  FOREIGN KEY(foundationBatchId) REFERENCES connection_import_batches(id),
  UNIQUE(bulkBatchId,sequenceNo)
);

CREATE INDEX IF NOT EXISTS idx_connection_bulk_platform_files_queue
  ON connection_bulk_platform_import_files(status,createdAt,sequenceNo);

CREATE TABLE IF NOT EXISTS connection_sku_sales_daily_facts (
  id TEXT PRIMARY KEY,
  salesLinkId TEXT NOT NULL,
  salesLinkSkuId TEXT NOT NULL,
  erpSkuId TEXT NOT NULL,
  saleDate TEXT NOT NULL,
  quantity REAL,
  salesAmount REAL,
  costAmount REAL,
  profitAmount REAL,
  incomeAmount REAL,
  refundAmount REAL,
  returnAmount REAL,
  postageIncomeAmount REAL,
  goodsCostAmount REAL,
  returnCostAmount REAL,
  postageCostAmount REAL,
  otherAdjustmentAmount REAL,
  feeAmount REAL,
  receivedAmount REAL,
  factType TEXT NOT NULL DEFAULT 'normal',
  sourceBatchId TEXT NOT NULL,
  sourceRowNumber INTEGER NOT NULL,
  rawDataJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
  FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(sourceBatchId) REFERENCES connection_import_batches(id),
  UNIQUE(salesLinkSkuId,erpSkuId,saleDate),
  CHECK(factType IN ('normal','combo_component')),
  CHECK(length(saleDate)=10 AND saleDate GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK(sourceRowNumber > 0)
);

CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_daily_link_date
  ON connection_sku_sales_daily_facts(salesLinkId,saleDate);
CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_daily_erp_date
  ON connection_sku_sales_daily_facts(erpSkuId,saleDate);
CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_daily_date
  ON connection_sku_sales_daily_facts(saleDate);
CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_daily_batch
  ON connection_sku_sales_daily_facts(sourceBatchId);

CREATE TABLE IF NOT EXISTS sales_link_sku_erp_mapping_candidates (
  id TEXT PRIMARY KEY,
  salesLinkSkuId TEXT NOT NULL,
  erpSkuId TEXT NOT NULL,
  candidateType TEXT NOT NULL,
  suggestedQuantity REAL NOT NULL DEFAULT 1,
  sourceType TEXT NOT NULL,
  sourceBatchId TEXT NOT NULL,
  sourceFileHash TEXT NOT NULL,
  sourceRowNumber INTEGER NOT NULL,
  evidenceJson TEXT NOT NULL DEFAULT '{}',
  affectedRowCount INTEGER NOT NULL DEFAULT 0,
  affectedDateStart TEXT,
  affectedDateEnd TEXT,
  salesAmount REAL,
  profitAmount REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewedBy TEXT,
  reviewedAt TEXT,
  decisionNote TEXT,
  mappingId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(sourceBatchId) REFERENCES connection_import_batches(id),
  FOREIGN KEY(reviewedBy) REFERENCES persons(id),
  UNIQUE(salesLinkSkuId,erpSkuId,sourceBatchId),
  CHECK(candidateType IN ('single','combo')),
  CHECK(status IN ('pending','approved','rejected','superseded','conflict')),
  CHECK(suggestedQuantity > 0),
  CHECK(sourceRowNumber > 0),
  CHECK(affectedRowCount > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_relation_candidates_status_type
  ON sales_link_sku_erp_mapping_candidates(status,candidateType,createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_sales_relation_candidates_batch
  ON sales_link_sku_erp_mapping_candidates(sourceBatchId,status);
CREATE INDEX IF NOT EXISTS idx_sales_relation_candidates_link_sku
  ON sales_link_sku_erp_mapping_candidates(salesLinkSkuId,status);
CREATE INDEX IF NOT EXISTS idx_sales_relation_candidates_erp_sku
  ON sales_link_sku_erp_mapping_candidates(erpSkuId,status);

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
  salesObjectStructureId TEXT,
  structureVersion INTEGER,
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
  FOREIGN KEY(salesObjectStructureId) REFERENCES sales_object_structures(id),
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
  salesObjectStructureId TEXT,
  structureVersion INTEGER,
  executionMode TEXT NOT NULL,
  outcome TEXT NOT NULL,
  oldMappingsSnapshotJson TEXT NOT NULL,
  generatedMappingsJson TEXT NOT NULL,
  errorMessage TEXT,
  appliedBy TEXT,
  appliedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(applicationItemId) REFERENCES product_structure_application_items(id),
  FOREIGN KEY(salesObjectStructureId) REFERENCES sales_object_structures(id),
  FOREIGN KEY(appliedBy) REFERENCES persons(id),
  CHECK(executionMode IN ('isolated_simulation','production')),
  CHECK(outcome IN ('applied','idempotent','failed','rolled_back'))
);
CREATE INDEX IF NOT EXISTS idx_product_structure_application_audits_item
  ON product_structure_application_audits(applicationItemId,appliedAt DESC);

CREATE TABLE IF NOT EXISTS sales_daily_anomaly_governance_decisions (
  id TEXT PRIMARY KEY,
  sourceBatchId TEXT NOT NULL,
  sourceRowNumber INTEGER NOT NULL,
  anomalyType TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  salesLinkSkuId TEXT,
  erpSkuId TEXT,
  decisionNote TEXT NOT NULL,
  snapshotJson TEXT NOT NULL,
  routeJson TEXT NOT NULL,
  reviewedBy TEXT NOT NULL,
  reviewedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(sourceBatchId) REFERENCES connection_import_batches(id),
  FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(reviewedBy) REFERENCES persons(id),
  UNIQUE(sourceBatchId,sourceRowNumber),
  CHECK(anomalyType IN ('identity_error','missing_relation','relation_conflict','incomplete_structure')),
  CHECK(action IN ('add','replace','ignore')),
  CHECK(status IN ('pending_formal_approval','reviewed_ignore'))
);
CREATE INDEX IF NOT EXISTS idx_sales_daily_anomaly_governance_queue
  ON sales_daily_anomaly_governance_decisions(sourceBatchId,anomalyType,status,updatedAt DESC);

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
  FOREIGN KEY(connectionId) REFERENCES sales_links(id),
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
  productId TEXT,
  erpSkuId TEXT,
  fromStatus TEXT,
  toStatus TEXT NOT NULL,
  reason TEXT,
  changedBy TEXT,
  changedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(changedBy) REFERENCES persons(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_product_lifecycle_events_product_time
  ON product_lifecycle_events(productId, changedAt DESC);

CREATE TABLE IF NOT EXISTS product_health_records (
  id TEXT PRIMARY KEY,
  productId TEXT,
  erpSkuId TEXT,
  snapshotKey TEXT NOT NULL,
  healthScore REAL,
  healthStatus TEXT NOT NULL,
  metricsJson TEXT NOT NULL DEFAULT '{}',
  problemsJson TEXT NOT NULL DEFAULT '[]',
  suggestionsJson TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  UNIQUE(productId, snapshotKey),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_product_health_records_status_time
  ON product_health_records(healthStatus, updatedAt DESC);

CREATE TABLE IF NOT EXISTS product_issues (
  id TEXT PRIMARY KEY,
  productId TEXT,
  erpSkuId TEXT,
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
  UNIQUE(healthRecordId, issueType),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_product_issues_product_status
  ON product_issues(productId, status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS product_improvements (
  id TEXT PRIMARY KEY,
  productId TEXT,
  erpSkuId TEXT,
  issueId TEXT NOT NULL,
  actionId TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  beforeMetricsJson TEXT NOT NULL DEFAULT '{}',
  afterMetricsJson TEXT NOT NULL DEFAULT '{}',
  improvementMeasures TEXT,
  resultSummary TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(issueId) REFERENCES product_issues(id),
  FOREIGN KEY(actionId) REFERENCES process_instances(id),
  UNIQUE(issueId, actionId),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_product_improvements_product_status
  ON product_improvements(productId, status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS product_strategy_versions (
  id TEXT PRIMARY KEY,
  productId TEXT,
  erpSkuId TEXT,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'current',
  effectiveAt TEXT NOT NULL,
  endedAt TEXT,
  changedBy TEXT,
  contentJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(productId, version),
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_strategy_current
  ON product_strategy_versions(productId) WHERE status='current';
CREATE INDEX IF NOT EXISTS idx_product_strategy_history
  ON product_strategy_versions(productId, version DESC);

CREATE TABLE IF NOT EXISTS product_strategy_action_links (
  id TEXT PRIMARY KEY,
  strategyVersionId TEXT NOT NULL,
  strategyItemId TEXT NOT NULL,
  actionId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(strategyVersionId, strategyItemId, actionId),
  FOREIGN KEY(strategyVersionId) REFERENCES product_strategy_versions(id),
  FOREIGN KEY(actionId) REFERENCES process_instances(id)
);

CREATE INDEX IF NOT EXISTS idx_product_strategy_action_version
  ON product_strategy_action_links(strategyVersionId);
CREATE INDEX IF NOT EXISTS idx_product_strategy_action_action
  ON product_strategy_action_links(actionId);

CREATE TABLE IF NOT EXISTS product_insights (
  id TEXT PRIMARY KEY,
  productId TEXT,
  erpSkuId TEXT,
  insightType TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  importance INTEGER,
  description TEXT,
  frequencyText TEXT,
  note TEXT,
  impactLevel TEXT,
  handlingStatus TEXT,
  opportunityType TEXT,
  priority TEXT,
  status TEXT,
  relatedStrategyVersionId TEXT,
  relatedImprovementId TEXT,
  relatedActionId TEXT,
  providerId TEXT NOT NULL DEFAULT 'manual',
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(relatedStrategyVersionId) REFERENCES product_strategy_versions(id),
  FOREIGN KEY(relatedImprovementId) REFERENCES product_improvements(id),
  FOREIGN KEY(relatedActionId) REFERENCES process_instances(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_product_insights_product_type
  ON product_insights(productId, insightType, updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_product_insights_improvement
  ON product_insights(relatedImprovementId) WHERE relatedImprovementId IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_insights_action
  ON product_insights(relatedActionId) WHERE relatedActionId IS NOT NULL;

CREATE TABLE IF NOT EXISTS product_clearance_plans (
  id TEXT PRIMARY KEY,
  productId TEXT,
  erpSkuId TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  startDate TEXT NOT NULL,
  targetDays INTEGER NOT NULL,
  targetEndDate TEXT NOT NULL,
  initialInventoryQuantity REAL,
  targetInventoryQuantity REAL NOT NULL DEFAULT 0,
  note TEXT,
  createdBy TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(productId) REFERENCES products(id),
  FOREIGN KEY(createdBy) REFERENCES persons(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_clearance_plans_active
  ON product_clearance_plans(productId) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_product_clearance_plans_status_end
  ON product_clearance_plans(status, targetEndDate, updatedAt DESC);

CREATE TABLE IF NOT EXISTS sales_objects (
  id TEXT PRIMARY KEY,
  objectCode TEXT NOT NULL,
  normalizedObjectCode TEXT NOT NULL UNIQUE,
  objectType TEXT NOT NULL,
  source TEXT NOT NULL,
  sourceType TEXT NOT NULL,
  sourceCode TEXT NOT NULL,
  sourceBatchId TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  blockedReason TEXT,
  firstSeenAt TEXT NOT NULL,
  lastSeenAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK(objectType IN ('single','bundle')),
  CHECK(status IN ('active','inactive','blocked','superseded'))
);
CREATE INDEX IF NOT EXISTS idx_sales_objects_status_type ON sales_objects(status,objectType,updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_sales_objects_source_code ON sales_objects(source,normalizedObjectCode);

CREATE TABLE IF NOT EXISTS sales_link_sku_sales_object_relations (
  id TEXT PRIMARY KEY,
  linkSkuId TEXT NOT NULL,
  salesObjectId TEXT NOT NULL,
  effectiveFrom TEXT NOT NULL,
  effectiveTo TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  sourceType TEXT NOT NULL,
  sourceBatchId TEXT,
  sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
  reviewedBy TEXT,
  reviewedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(linkSkuId) REFERENCES sales_link_skus(id),
  FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
  FOREIGN KEY(reviewedBy) REFERENCES persons(id),
  CHECK(status IN ('active','inactive','superseded','conflict')),
  CHECK((status='active' AND effectiveTo IS NULL) OR status<>'active')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_link_sku_sales_object_one_active ON sales_link_sku_sales_object_relations(linkSkuId) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_sales_link_sku_sales_object_object ON sales_link_sku_sales_object_relations(salesObjectId,status);

CREATE TABLE IF NOT EXISTS sales_object_structures (
  id TEXT PRIMARY KEY,
  salesObjectId TEXT NOT NULL,
  version INTEGER NOT NULL,
  structureHash TEXT NOT NULL,
  effectiveFrom TEXT NOT NULL,
  effectiveTo TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sourceType TEXT NOT NULL,
  sourceBatchId TEXT,
  sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
  validityBasis TEXT NOT NULL DEFAULT 'unknown',
  sourceState TEXT NOT NULL DEFAULT 'active',
  sourceUpdatedAt TEXT,
  lastVerifiedAt TEXT,
  syncedAt TEXT,
  supersedesStructureId TEXT,
  reviewedBy TEXT,
  reviewedAt TEXT,
  activatedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
  FOREIGN KEY(supersedesStructureId) REFERENCES sales_object_structures(id),
  FOREIGN KEY(reviewedBy) REFERENCES persons(id),
  UNIQUE(id,salesObjectId),
  UNIQUE(salesObjectId,version),
  UNIQUE(salesObjectId,structureHash),
  CHECK(version>0),
  CHECK(validityBasis IN ('exact','inferred','legacy_evidence','unknown')),
  CHECK(sourceState IN ('active','source_removed')),
  CHECK(status IN ('draft','pending_review','active','superseded','blocked')),
  CHECK((status='active' AND effectiveTo IS NULL AND reviewedBy IS NOT NULL AND reviewedAt IS NOT NULL AND activatedAt IS NOT NULL) OR status<>'active')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_object_structures_one_active ON sales_object_structures(salesObjectId) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_sales_object_structures_status ON sales_object_structures(status,updatedAt DESC);

CREATE TABLE IF NOT EXISTS sales_object_structure_effective_periods (
  id TEXT PRIMARY KEY,
  structureId TEXT NOT NULL,
  salesObjectId TEXT NOT NULL,
  validFrom TEXT NOT NULL,
  validTo TEXT,
  sourceState TEXT NOT NULL DEFAULT 'active',
  validityBasis TEXT NOT NULL DEFAULT 'unknown',
  sourceUpdatedAt TEXT,
  firstVerifiedAt TEXT NOT NULL,
  lastVerifiedAt TEXT NOT NULL,
  syncedAt TEXT NOT NULL,
  sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(structureId,salesObjectId) REFERENCES sales_object_structures(id,salesObjectId),
  FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
  CHECK(validTo IS NULL OR validTo>=validFrom),
  CHECK(sourceState IN ('active','source_removed')),
  CHECK(validityBasis IN ('exact','inferred','legacy_evidence','unknown'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_object_structure_period_one_open
  ON sales_object_structure_effective_periods(salesObjectId) WHERE validTo IS NULL AND sourceState='active';
CREATE INDEX IF NOT EXISTS idx_sales_object_structure_period_lookup
  ON sales_object_structure_effective_periods(salesObjectId,validFrom,validTo);

CREATE TABLE IF NOT EXISTS sales_object_structure_components (
  id TEXT PRIMARY KEY,
  structureId TEXT NOT NULL,
  salesObjectId TEXT NOT NULL,
  erpSkuId TEXT NOT NULL,
  quantity REAL NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  sourceType TEXT NOT NULL,
  sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(structureId,salesObjectId) REFERENCES sales_object_structures(id,salesObjectId),
  FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  UNIQUE(structureId,erpSkuId),
  CHECK(quantity>0),
  CHECK(status IN ('active','invalid'))
);
CREATE INDEX IF NOT EXISTS idx_sales_object_components_object ON sales_object_structure_components(salesObjectId,status);
CREATE INDEX IF NOT EXISTS idx_sales_object_components_erp ON sales_object_structure_components(erpSkuId,status);

CREATE TABLE IF NOT EXISTS operating_erp_set_members (
  normalizedCode TEXT PRIMARY KEY COLLATE NOCASE,
  merchantSkuCode TEXT NOT NULL,
  erpSkuId TEXT,
  salesObjectId TEXT,
  lifecycleStatus TEXT NOT NULL,
  sourceCount INTEGER NOT NULL DEFAULT 0,
  firstSeenAt TEXT NOT NULL,
  lastSeenAt TEXT NOT NULL,
  calculatedAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
  CHECK(lifecycleStatus IN ('active','active_dependency','sales_active','archived','external_unused','unresolved')),
  CHECK(sourceCount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_operating_erp_members_lifecycle
  ON operating_erp_set_members(lifecycleStatus,updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_operating_erp_members_erp
  ON operating_erp_set_members(erpSkuId,lifecycleStatus);
CREATE INDEX IF NOT EXISTS idx_operating_erp_members_object
  ON operating_erp_set_members(salesObjectId,lifecycleStatus);

CREATE TABLE IF NOT EXISTS operating_erp_set_evidence (
  id TEXT PRIMARY KEY,
  normalizedCode TEXT NOT NULL COLLATE NOCASE,
  sourceType TEXT NOT NULL,
  sourceObjectType TEXT NOT NULL,
  sourceObjectId TEXT NOT NULL,
  sourceBatchId TEXT,
  firstSeenAt TEXT NOT NULL,
  lastSeenAt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  calculatedAt TEXT NOT NULL,
  metadataJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(normalizedCode) REFERENCES operating_erp_set_members(normalizedCode),
  CHECK(sourceType IN ('platform_active','bundle_dependency','sales_active')),
  CHECK(active IN (0,1)),
  UNIQUE(normalizedCode,sourceType,sourceObjectType,sourceObjectId)
);
CREATE INDEX IF NOT EXISTS idx_operating_erp_evidence_active_source
  ON operating_erp_set_evidence(active,sourceType,normalizedCode);
CREATE INDEX IF NOT EXISTS idx_operating_erp_evidence_object
  ON operating_erp_set_evidence(sourceObjectType,sourceObjectId,active);

CREATE TABLE IF NOT EXISTS operating_erp_lifecycle_events (
  id TEXT PRIMARY KEY,
  normalizedCode TEXT NOT NULL COLLATE NOCASE,
  erpSkuId TEXT,
  fromStatus TEXT,
  toStatus TEXT NOT NULL,
  sourceTypesJson TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  calculatedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(normalizedCode) REFERENCES operating_erp_set_members(normalizedCode),
  FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
  CHECK(fromStatus IS NULL OR fromStatus IN ('active','active_dependency','sales_active','archived','external_unused','unresolved')),
  CHECK(toStatus IN ('active','active_dependency','sales_active','archived','external_unused','unresolved'))
);
CREATE INDEX IF NOT EXISTS idx_operating_erp_lifecycle_events_code_time
  ON operating_erp_lifecycle_events(normalizedCode,calculatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_operating_erp_lifecycle_events_transition
  ON operating_erp_lifecycle_events(fromStatus,toStatus,calculatedAt DESC);

-- Architecture Upgrade-003 Phase 2: read-only Wangdian identity observations.
-- These tables are a shadow contract only. They do not replace ERP SKU, Sales Object,
-- Link SKU relations, Product mappings, facts, inventory, or the production resolver.
CREATE TABLE IF NOT EXISTS operating_erp_identity_observations (
  normalizedCode TEXT PRIMARY KEY COLLATE NOCASE,
  merchantSkuCode TEXT NOT NULL,
  inOperatingErpSet INTEGER NOT NULL DEFAULT 0,
  inOperatingObjectSet INTEGER NOT NULL DEFAULT 0,
  goodsStatus TEXT NOT NULL,
  suiteStatus TEXT NOT NULL,
  resolvedIdentityType TEXT NOT NULL,
  identityStatus TEXT NOT NULL,
  goodsErpSkuId TEXT,
  suiteSalesObjectId TEXT,
  sourceMode TEXT NOT NULL,
  sourceCheckedAt TEXT,
  sourceUpdatedAt TEXT,
  detailJson TEXT NOT NULL DEFAULT '{}',
  calculatedAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(goodsErpSkuId) REFERENCES erp_skus(id),
  FOREIGN KEY(suiteSalesObjectId) REFERENCES sales_objects(id),
  CHECK(inOperatingErpSet IN (0,1)),
  CHECK(inOperatingObjectSet IN (0,1)),
  CHECK(goodsStatus IN ('found','not_found','source_unavailable','not_checked')),
  CHECK(suiteStatus IN ('found','not_found','source_unavailable','not_checked')),
  CHECK(resolvedIdentityType IN ('single','bundle','conflict','unresolved')),
  CHECK(identityStatus IN ('confirmed','sku_type_conflict','source_conflict','erp_not_found','source_unavailable','not_checked')),
  CHECK(sourceMode IN ('materialized','live','mixed'))
);
CREATE INDEX IF NOT EXISTS idx_operating_erp_identity_status
  ON operating_erp_identity_observations(identityStatus,resolvedIdentityType,updatedAt DESC);

CREATE TABLE IF NOT EXISTS operating_erp_identity_shadow_comparisons (
  normalizedCode TEXT PRIMARY KEY COLLATE NOCASE,
  merchantSkuCode TEXT NOT NULL,
  currentIdentityType TEXT NOT NULL,
  v3IdentityType TEXT NOT NULL,
  comparisonStatus TEXT NOT NULL,
  currentSalesObjectId TEXT,
  projectedSalesObjectCode TEXT,
  bundleStructureStatus TEXT NOT NULL,
  productMappingStatus TEXT NOT NULL,
  detailJson TEXT NOT NULL DEFAULT '{}',
  calculatedAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(normalizedCode) REFERENCES operating_erp_identity_observations(normalizedCode),
  FOREIGN KEY(currentSalesObjectId) REFERENCES sales_objects(id),
  CHECK(currentIdentityType IN ('single','bundle','conflict','unresolved','none')),
  CHECK(v3IdentityType IN ('single','bundle','conflict','unresolved')),
  CHECK(comparisonStatus IN ('consistent','v3_fill','type_conflict','source_conflict','erp_not_found','source_unavailable','current_extra')),
  CHECK(bundleStructureStatus IN ('not_applicable','complete','bom_missing','component_missing','quantity_invalid','structure_conflict','not_checked')),
  CHECK(productMappingStatus IN ('complete','partial','missing','not_applicable','not_checked'))
);
CREATE INDEX IF NOT EXISTS idx_operating_erp_shadow_status
  ON operating_erp_identity_shadow_comparisons(comparisonStatus,bundleStructureStatus,updatedAt DESC);

-- Architecture Upgrade-003 Phase 6: bounded production shadow diagnostics.
-- Shadow records may describe business assets but must never become a relation source.
CREATE TABLE IF NOT EXISTS v3_relation_shadow_runs (
  id TEXT PRIMARY KEY,
  triggerType TEXT NOT NULL,
  triggerObjectId TEXT,
  sourceBatchId TEXT,
  status TEXT NOT NULL,
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  durationMs REAL,
  metricsJson TEXT NOT NULL DEFAULT '{}',
  protectedBeforeJson TEXT NOT NULL DEFAULT '{}',
  protectedAfterJson TEXT NOT NULL DEFAULT '{}',
  errorMessage TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK(status IN ('running','completed','failed'))
);
CREATE INDEX IF NOT EXISTS idx_v3_shadow_runs_time
  ON v3_relation_shadow_runs(startedAt DESC,status);

CREATE TABLE IF NOT EXISTS v3_relation_shadow_differences (
  id TEXT PRIMARY KEY,
  objectType TEXT NOT NULL,
  objectId TEXT NOT NULL,
  normalizedCode TEXT,
  differenceType TEXT NOT NULL,
  currentResultJson TEXT NOT NULL DEFAULT '{}',
  v3ResultJson TEXT NOT NULL DEFAULT '{}',
  firstSeenAt TEXT NOT NULL,
  lastSeenAt TEXT NOT NULL,
  occurrenceCount INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  lastRunId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(lastRunId) REFERENCES v3_relation_shadow_runs(id) ON DELETE SET NULL,
  UNIQUE(objectType,objectId,differenceType),
  CHECK(occurrenceCount>0),
  CHECK(status IN ('active','resolved'))
);
CREATE INDEX IF NOT EXISTS idx_v3_shadow_differences_active
  ON v3_relation_shadow_differences(status,differenceType,lastSeenAt DESC);

CREATE TRIGGER IF NOT EXISTS trg_sales_object_structure_activate_components
  BEFORE UPDATE OF status ON sales_object_structures
  WHEN NEW.status='active' AND NOT EXISTS (SELECT 1 FROM sales_object_structure_components c WHERE c.structureId=NEW.id AND c.salesObjectId=NEW.salesObjectId AND c.status='active')
BEGIN SELECT RAISE(ABORT,'sales object structure cannot be active without components'); END;
CREATE TRIGGER IF NOT EXISTS trg_sales_object_structure_insert_active
  BEFORE INSERT ON sales_object_structures
  WHEN NEW.status='active'
BEGIN SELECT RAISE(ABORT,'sales object structure must be created before activation'); END;
CREATE TRIGGER IF NOT EXISTS trg_sales_object_structure_single_shape
  BEFORE UPDATE OF status ON sales_object_structures
  WHEN NEW.status='active' AND (SELECT objectType FROM sales_objects WHERE id=NEW.salesObjectId)='single'
    AND (SELECT COUNT(*) FROM sales_object_structure_components c WHERE c.structureId=NEW.id AND c.status='active')<>1
BEGIN SELECT RAISE(ABORT,'single sales object requires exactly one component'); END;
CREATE TRIGGER IF NOT EXISTS trg_sales_object_structure_single_quantity
  BEFORE UPDATE OF status ON sales_object_structures
  WHEN NEW.status='active' AND (SELECT objectType FROM sales_objects WHERE id=NEW.salesObjectId)='single'
    AND EXISTS (SELECT 1 FROM sales_object_structure_components c WHERE c.structureId=NEW.id AND c.status='active' AND c.quantity<>1)
BEGIN SELECT RAISE(ABORT,'single sales object component quantity must equal one'); END;
CREATE TRIGGER IF NOT EXISTS trg_sales_object_component_protect_active_structure_insert
  BEFORE INSERT ON sales_object_structure_components
  WHEN (SELECT status FROM sales_object_structures WHERE id=NEW.structureId)='active'
BEGIN SELECT RAISE(ABORT,'active sales object structure components are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_sales_object_component_protect_active_structure_update
  BEFORE UPDATE ON sales_object_structure_components
  WHEN (SELECT status FROM sales_object_structures WHERE id=OLD.structureId)='active'
    OR (SELECT status FROM sales_object_structures WHERE id=NEW.structureId)='active'
BEGIN SELECT RAISE(ABORT,'active sales object structure components are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_sales_object_component_protect_active_structure_delete
  BEFORE DELETE ON sales_object_structure_components
  WHEN (SELECT status FROM sales_object_structures WHERE id=OLD.structureId)='active'
BEGIN SELECT RAISE(ABORT,'active sales object structure components are immutable'); END;
