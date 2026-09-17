import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("connection cockpit product mappings are limited to ERP SKUs referenced by requested link relations", () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "../server/connectionBusinessCockpitService.js"), "utf8");
  const start = source.indexOf("function readProductMappingsForErpSkus");
  const end = source.indexOf("function readProductChannels", start);
  const attributionSource = source.slice(start, end);
  assert.match(attributionSource, /m\.erpSkuId IN \(\$\{chunk\.map/);
  assert.doesNotMatch(attributionSource, /m\.erpSkuId IS NOT NULL/);
  assert.match(attributionSource, /relation\?\.isUsable/);
});
