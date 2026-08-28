import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { productBusinessIdentityParams, productBusinessIdentityPredicate, resolveProductBusinessIdentity, upsertProductBusinessProfile } from "./productBusinessProfileService.js";

const text = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const id = () => `product-marketing-${crypto.randomUUID()}`;

function parseArray(value) {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function normalizeList(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, limit);
}

function normalizeSellingPoints(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ id: typeof item === "object" ? text(item?.id) : "", text: typeof item === "string" ? text(item) : text(item?.text) }))
    .filter((item) => item.text).slice(0, 50)
    .map((point, index) => ({ id: point.id || `point-${index + 1}`, text: point.text, sortOrder: index + 1 }));
}

function readProduct(productId) {
  const product = resolveProductBusinessIdentity(productId);
  const legacyRequest = text(productId) === product.legacyProductId;
  return { ...product, id: product.erpSkuId,
    mainImage: legacyRequest ? product.legacyMainImage || product.mainImage : product.mainImage,
    galleryImages: product.legacyGalleryImages || "[]", series: product.legacySeries, material: product.legacyMaterial,
    color: product.legacyColor, specification: product.legacySpecification };
}

function mapAsset(row) {
  if (!row) return null;
  return { ...row, usageScenarios: parseArray(row.usageScenariosJson), sellingPoints: parseArray(row.sellingPointsJson).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)), keywords: parseArray(row.keywordsJson) };
}

export function getProductMarketingAsset(productId) {
  const product = readProduct(productId);
  const asset = mapAsset(getDatabase().prepare(`SELECT * FROM product_marketing_assets record WHERE ${productBusinessIdentityPredicate("record")}`).get(productBusinessIdentityParams(product)));
  return { product, asset };
}

export function saveProductMarketingAsset(productId, input, userId) {
  const product = readProduct(productId);
  const database = getDatabase();
  const current = database.prepare(`SELECT * FROM product_marketing_assets record WHERE ${productBusinessIdentityPredicate("record")}`).get(productBusinessIdentityParams(product));
  const timestamp = now();
  upsertProductBusinessProfile(product.erpSkuId, {}, userId, { database });
  const asset = {
    id: current?.id || id(), productId: product.legacyProductId, erpSkuId: product.erpSkuId,
    positioning: text(input?.positioning) || null,
    targetAudience: text(input?.targetAudience) || null,
    usageScenariosJson: JSON.stringify(normalizeList(input?.usageScenarios)),
    sellingPointsJson: JSON.stringify(normalizeSellingPoints(input?.sellingPoints)),
    productStory: text(input?.productStory) || null,
    keywordsJson: JSON.stringify(normalizeList(input?.keywords)),
    createdBy: current?.createdBy || text(userId) || null,
    updatedBy: text(userId) || null,
    createdAt: current?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  database.prepare(`INSERT INTO product_marketing_assets
      (id,productId,erpSkuId,positioning,targetAudience,usageScenariosJson,sellingPointsJson,productStory,keywordsJson,createdBy,updatedBy,createdAt,updatedAt)
    VALUES (@id,@productId,@erpSkuId,@positioning,@targetAudience,@usageScenariosJson,@sellingPointsJson,@productStory,@keywordsJson,@createdBy,@updatedBy,@createdAt,@updatedAt)
    ON CONFLICT(erpSkuId) WHERE erpSkuId IS NOT NULL DO UPDATE SET positioning=excluded.positioning,targetAudience=excluded.targetAudience,
      usageScenariosJson=excluded.usageScenariosJson,sellingPointsJson=excluded.sellingPointsJson,productStory=excluded.productStory,
      keywordsJson=excluded.keywordsJson,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`).run(asset);
  return getProductMarketingAsset(product.erpSkuId).asset;
}

function field(label, value) { return `${label}：${text(value) || "未维护"}`; }
function listField(label, values) { return `${label}：${values.length ? values.join("、") : "未维护"}`; }

export function exportProductMarketingAsset(productId) {
  const { product, asset } = getProductMarketingAsset(productId);
  const marketing = asset || { usageScenarios: [], sellingPoints: [], keywords: [] };
  const lines = [
    "# 产品 AI 资料", field("产品名称", product.name), field("产品编码", product.skuCode), field("品牌", product.brand), field("类目", product.category),
    field("系列", product.series), field("材质", product.material), field("颜色", product.color), field("规格", product.specification), "", "## 营销资产", field("产品定位", marketing.positioning), field("目标人群", marketing.targetAudience),
    listField("使用场景", marketing.usageScenarios || []), field("产品故事", marketing.productStory), listField("关键词", marketing.keywords || []), "", "## 核心卖点",
    ...(marketing.sellingPoints?.length ? marketing.sellingPoints.map((point, index) => `${index + 1}. ${point.text}`) : ["未维护"]),
  ];
  const images = [...new Set([product.mainImage, ...parseArray(product.galleryImages)].filter(Boolean))];
  return { formatVersion: "product-ai-export-v1", fileName: `${product.skuCode || product.name}-AI资料.txt`, text: lines.join("\n"), images,
    packageManifest: { formatVersion: "product-marketing-package-v1", productId: product.legacyProductId, erpSkuId: product.erpSkuId, textFile: `${product.skuCode || product.name}-营销信息.txt`, imageCount: images.length } };
}
