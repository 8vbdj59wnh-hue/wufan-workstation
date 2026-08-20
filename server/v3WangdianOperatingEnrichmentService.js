import { getDatabase } from "./db.js";
import { adaptWangdianGoodsResponse } from "./wangdianGoodsAdapter.js";
import { queryWangdianGoods, queryWangdianSuites } from "./wangdianClient.js";
import { searchWangdianSuites } from "./wangdianSuiteService.js";

const clean = (value) => String(value ?? "").trim();
const normalized = (value) => clean(value).replace(/\.0+$/u, "").toLowerCase();

function targets(database) {
  return database.prepare(`SELECT DISTINCT m.merchantSkuCode,m.normalizedCode
    FROM operating_erp_set_members m
    LEFT JOIN erp_skus e ON lower(trim(e.merchantSkuCode))=m.normalizedCode AND e.currentState='active'
    LEFT JOIN sales_objects o ON o.normalizedObjectCode=m.normalizedCode AND o.status='active' AND o.sourceType='wangdian_suite_api'
    WHERE m.lifecycleStatus IN ('active','sales_active','unresolved') AND e.id IS NULL AND o.id IS NULL
    ORDER BY m.normalizedCode`).all();
}

export async function enrichOperatingErpObjects(input = {}, options = {}) {
  const database = options.database || input.database || getDatabase();
  const queryGoods = options.queryGoods || ((request) => queryWangdianGoods(request));
  const querySuites = options.querySuites || ((request) => queryWangdianSuites(request));
  const rows = targets(database);
  const erpByCode = new Map(database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE currentState='active'").all().map((item) => [normalized(item.merchantSkuCode), item]));
  const liveObservations = {};
  const bundleSources = {};
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, Number(options.concurrency || 8)), rows.length) }, async () => {
    while (cursor < rows.length) {
      const target = rows[cursor]; cursor += 1;
      const code = clean(target.merchantSkuCode);
      const observation = { code, checkedAt: new Date().toISOString(), goodsChecked: false, suiteChecked: false, goods: null, suite: null, goodsError: null, suiteError: null };
      await Promise.all([
        (async () => { try {
          const payload = await queryGoods({ params: { spec_no: code, hide_deleted: 0 }, pageSize: 100 });
          const exact = adaptWangdianGoodsResponse(payload).filter((item) => normalized(item.merchantSkuCode) === normalized(code));
          observation.goods = exact[0] || null; observation.goodsChecked = true;
        } catch (error) { observation.goodsError = error.message || String(error); } })(),
        (async () => { try {
          const result = await searchWangdianSuites({ suiteNo: code, pageSize: 100, hideDeleted: false }, { querySuites });
          observation.suite = result.items.find((item) => normalized(item.suiteCode) === normalized(code)) || null; observation.suiteChecked = true;
        } catch (error) { observation.suiteError = error.message || String(error); } })(),
      ]);
      liveObservations[normalized(code)] = observation;
      if (observation.suite && !observation.suite.deleted) {
        const components = observation.suite.components.filter((item) => !item.deleted).map((item) => ({
          erpSkuId: erpByCode.get(normalized(item.skuCode))?.id || null,
          skuCode: clean(item.skuCode), quantity: Number(item.quantity),
        }));
        bundleSources[normalized(code)] = { sourceUpdatedAt: observation.suite.modifiedAt || null, components };
      }
    }
  });
  await Promise.all(workers);
  const observations = Object.values(liveObservations);
  const sourceFailures = observations.filter((item) => item.goodsError || item.suiteError).length;
  const bomPending = Object.values(bundleSources).filter((item) => !item.components.length || item.components.some((component) => !component.erpSkuId || !(component.quantity > 0))).length;
  return { status: sourceFailures ? "source_unavailable" : bomPending ? "bundle_bom_pending" : "completed", changedCodes: rows.length, sourceFailures, bomPending, liveObservations, bundleSources };
}

export default enrichOperatingErpObjects;
