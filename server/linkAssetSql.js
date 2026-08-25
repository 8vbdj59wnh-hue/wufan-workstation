// 统一从正式 Link 资产读取原“经营档案”字段。该投影没有独立存储，
// 仅用于让旧调用方在迁移期间共享同一套 sales_links 字段命名。
export const LINK_ASSET_SELECT_SQL = `(SELECT
  id,
  id AS salesLinkId,
  COALESCE(NULLIF(displayName,''),NULLIF(title,''),platformGoodsId) AS name,
  mainImage,
  imageSource,
  ownerId,
  managementStatus AS status,
  managementLevel AS level,
  managementNotes AS notes,
  managementOriginSource AS originSource,
  managementOriginImportBatchId AS originImportBatchId,
  managementIdentifiedAt AS identifiedAt,
  managementCreatedBy AS createdBy,
  createdAt,
  updatedAt
FROM sales_links)`;
