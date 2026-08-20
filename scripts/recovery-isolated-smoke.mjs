import { getDatabase } from "../server/db.js";
import { resolveLinkSkuRelationForRead } from "../server/capabilities/resolveLinkSkuRelationRead.js";
import { createToken } from "../server/security.js";

const baseUrl = String(process.env.WUFAN_RECOVERY_BASE_URL ?? "http://127.0.0.1:3301").replace(/\/$/u, "");
const database = getDatabase();

async function request(pathname, token = "") {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(`recovery_smoke_failed:${pathname}:${response.status}:${JSON.stringify(body)}`);
  }
  return { status: response.status, body };
}

const admin = database.prepare(`
  SELECT *
  FROM persons
  WHERE status='active' AND canLogin=1 AND authRole='admin'
  ORDER BY createdAt ASC
  LIMIT 1
`).get();
if (!admin) throw new Error("recovery_smoke_admin_not_found");

const product = database.prepare("SELECT id FROM products ORDER BY createdAt ASC LIMIT 1").get();
const connection = database.prepare("SELECT id FROM connection_profiles ORDER BY createdAt ASC LIMIT 1").get();
const relation = database.prepare(`
  SELECT linkSkuId
  FROM sales_link_sku_sales_object_relations
  WHERE status='active'
  ORDER BY createdAt ASC
  LIMIT 1
`).get();
if (!product || !connection || !relation) throw new Error("recovery_smoke_business_sample_missing");

const token = createToken(admin);
const checks = {};
checks.health = await request("/api/health");
checks.authenticatedSession = await request("/api/auth/me", token);
checks.productList = await request("/api/product-center-v2/skus?page=1&pageSize=1", token);
checks.productDetail = await request(`/api/product-management/products/${encodeURIComponent(product.id)}`, token);
checks.productBusiness = await request("/api/product-management/business-dashboard?page=1&pageSize=1", token);
checks.bundleList = await request("/api/product-center-v2/combo-skus?page=1&pageSize=1", token);
checks.connectionList = await request("/api/connections?page=1&pageSize=1", token);
checks.connectionDetail = await request(`/api/connections/${encodeURIComponent(connection.id)}`, token);
checks.dataSyncCenter = await request("/api/data-sync-center", token);

const resolved = resolveLinkSkuRelationForRead({ salesLinkSkuId: relation.linkSkuId }, { scope: "productWorkspace" });
if (!resolved || !Array.isArray(resolved.mappings) || resolved.mappings.length === 0) {
  throw new Error("recovery_smoke_resolver_empty");
}

if (process.env.WUFAN_RECOVERY_CHECK_WANGDIAN === "1") {
  checks.wangdianSuiteRead = await request("/api/products/wangdian/suites/search?suiteNo=FZH0103-11", token);
}

const compact = Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, { status: value.status }]));
process.stdout.write(`${JSON.stringify({
  status: "ok",
  checks: compact,
  resolver: { linkSkuId: relation.linkSkuId, componentCount: resolved.mappings.length },
})}\n`);
