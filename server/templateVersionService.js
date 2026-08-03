import { getDatabase, readRouteResourceItem, updateResource } from "./db.js";

export const versionedTemplateResources = new Set(["templates", "task-templates", "standard-work-forms", "methodologies"]);

const assetTypes = {
  templates: "visual",
  "task-templates": "action",
  "standard-work-forms": "form",
  methodologies: "manual",
};

const resourcesByAssetType = Object.fromEntries(Object.entries(assetTypes).map(([resource, type]) => [type, resource]));
const now = () => new Date().toISOString();
const id = () => `template-version-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const json = (value) => JSON.stringify(value ?? {});
const parse = (value, fallback = {}) => { try { return JSON.parse(value ?? ""); } catch { return fallback; } };

export function ensureTemplateVersionSchema() {
  getDatabase().exec(`
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
  `);
}

function resourceForType(assetType) {
  const resource = resourcesByAssetType[assetType];
  if (!resource) throw new Error("不支持的模板类型。");
  return resource;
}

function usageCount(assetType, content) {
  const db = getDatabase();
  if (assetType === "action") return db.prepare("SELECT COUNT(*) count FROM process_instances WHERE taskTemplateId = ?").get(content.id)?.count ?? 0;
  if (assetType === "form") return db.prepare("SELECT COUNT(*) count FROM tasks WHERE taskTemplateId = ?").get(content.standardWorkId)?.count ?? 0;
  if (assetType === "manual") return db.prepare("SELECT COUNT(*) count FROM tasks WHERE processNodeId = ? OR taskTemplateId = ?").get(content.processNodeId, content.taskTemplateId)?.count ?? 0;
  return 0;
}

function decorate(row) {
  const content = parse(row.contentJson);
  return { ...row, content, useCount: usageCount(row.assetType, content) };
}

export function ensureInitialTemplateVersion(resource, item, userId = "") {
  if (!versionedTemplateResources.has(resource) || !item?.id) return null;
  ensureTemplateVersionSchema();
  const assetType = assetTypes[resource];
  const existing = getDatabase().prepare("SELECT id FROM template_asset_versions WHERE assetType = ? AND assetId = ? LIMIT 1").get(assetType, item.id);
  if (existing) return existing;
  const createdAt = item.createdAt || now();
  const row = { id: id(), assetType, assetId: item.id, versionNumber: "V1.0", majorVersion: 1, minorVersion: 0, status: "active", contentJson: json(item), changeSummary: "初始版本", createdBy: userId, createdAt, activatedAt: createdAt };
  getDatabase().prepare(`INSERT INTO template_asset_versions (id,assetType,assetId,versionNumber,majorVersion,minorVersion,status,contentJson,changeSummary,createdBy,createdAt,activatedAt) VALUES (@id,@assetType,@assetId,@versionNumber,@majorVersion,@minorVersion,@status,@contentJson,@changeSummary,@createdBy,@createdAt,@activatedAt)`).run(row);
  return decorate(row);
}

export function bootstrapTemplateVersions(userId = "system") {
  ensureTemplateVersionSchema();
  for (const resource of versionedTemplateResources) {
    const type = assetTypes[resource];
    const table = { visual: "templates", action: "task_templates", form: "standard_work_forms", manual: "methodologies" }[type];
    const rows = getDatabase().prepare(`SELECT * FROM ${table}`).all();
    rows.forEach((row) => ensureInitialTemplateVersion(resource, readRouteResourceItem(resource, row.id), userId));
  }
}

export function listTemplateVersions(assetType = "", assetId = "") {
  ensureTemplateVersionSchema();
  const clauses = [], args = [];
  if (assetType) { resourceForType(assetType); clauses.push("assetType = ?"); args.push(assetType); }
  if (assetId) { clauses.push("assetId = ?"); args.push(assetId); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDatabase().prepare(`SELECT * FROM template_asset_versions ${where} ORDER BY assetType, assetId, majorVersion DESC, minorVersion DESC`).all(...args).map(decorate);
}

export function iterateTemplate(assetType, assetId, input, userId = "") {
  const resource = resourceForType(assetType);
  const current = readRouteResourceItem(resource, assetId);
  if (!current) throw new Error("模板不存在。");
  ensureInitialTemplateVersion(resource, current, userId);
  const latest = getDatabase().prepare("SELECT * FROM template_asset_versions WHERE assetType = ? AND assetId = ? ORDER BY majorVersion DESC, minorVersion DESC LIMIT 1").get(assetType, assetId);
  const bump = input.bump === "major" ? "major" : "minor";
  const majorVersion = bump === "major" ? latest.majorVersion + 1 : latest.majorVersion;
  const minorVersion = bump === "major" ? 0 : latest.minorVersion + 1;
  const createdAt = now();
  const content = { ...current, ...(input.content ?? {}), id: assetId, updatedAt: input.content?.updatedAt ?? createdAt };
  const row = { id: id(), assetType, assetId, versionNumber: `V${majorVersion}.${minorVersion}`, majorVersion, minorVersion, status: "active", contentJson: json(content), changeSummary: String(input.changeSummary ?? "版本迭代").trim() || "版本迭代", createdBy: userId, createdAt, activatedAt: createdAt };
  return getDatabase().transaction(() => {
    getDatabase().prepare("UPDATE template_asset_versions SET status = 'superseded', deactivatedAt = ? WHERE assetType = ? AND assetId = ? AND status = 'active'").run(createdAt, assetType, assetId);
    const updated = updateResource(resource, assetId, content);
    row.contentJson = json(updated);
    getDatabase().prepare(`INSERT INTO template_asset_versions (id,assetType,assetId,versionNumber,majorVersion,minorVersion,status,contentJson,changeSummary,createdBy,createdAt,activatedAt) VALUES (@id,@assetType,@assetId,@versionNumber,@majorVersion,@minorVersion,@status,@contentJson,@changeSummary,@createdBy,@createdAt,@activatedAt)`).run(row);
    return { item: updated, version: decorate(row) };
  })();
}

export function changeTemplateVersionStatus(assetType, assetId, versionId, action, userId = "") {
  const resource = resourceForType(assetType);
  const version = getDatabase().prepare("SELECT * FROM template_asset_versions WHERE id = ? AND assetType = ? AND assetId = ?").get(versionId, assetType, assetId);
  if (!version) throw new Error("模板版本不存在。");
  const changedAt = now();
  return getDatabase().transaction(() => {
    if (action === "activate") {
      getDatabase().prepare("UPDATE template_asset_versions SET status = 'superseded', deactivatedAt = ? WHERE assetType = ? AND assetId = ? AND status = 'active'").run(changedAt, assetType, assetId);
      const content = parse(version.contentJson);
      if (assetType === "action") content.status = "active";
      updateResource(resource, assetId, content);
      getDatabase().prepare("UPDATE template_asset_versions SET status = 'active', activatedAt = ?, deactivatedAt = NULL, archivedAt = NULL WHERE id = ?").run(changedAt, versionId);
    } else if (action === "deactivate") {
      if (version.status !== "active") throw new Error("只有当前启用版本可以停用。");
      if (assetType === "action") updateResource(resource, assetId, { ...parse(version.contentJson), status: "inactive", updatedAt: changedAt });
      getDatabase().prepare("UPDATE template_asset_versions SET status = 'inactive', deactivatedAt = ? WHERE id = ?").run(changedAt, versionId);
    } else if (action === "archive") {
      if (version.status === "active" && assetType === "action") updateResource(resource, assetId, { ...parse(version.contentJson), status: "inactive", updatedAt: changedAt });
      getDatabase().prepare("UPDATE template_asset_versions SET status = 'archived', deactivatedAt = COALESCE(deactivatedAt, ?), archivedAt = ? WHERE id = ?").run(changedAt, changedAt, versionId);
    } else throw new Error("不支持的版本操作。");
    return listTemplateVersions(assetType, assetId);
  })();
}
