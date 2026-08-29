import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = {
  location: { protocol: "http:", hostname: "127.0.0.1" },
};

const { collectActionProductIds } = await import("../src/actionProductRelations.js");

test("keeps previously selected ERP SKUs when search results are replaced", () => {
  const selector = {
    dataset: { selectedProductIds: JSON.stringify(["erp-sku-a"]) },
    matches: () => true,
    querySelectorAll: () => [{ value: "erp-sku-b", checked: true }],
  };

  assert.deepEqual(collectActionProductIds(selector), ["erp-sku-a", "erp-sku-b"]);
});

test("deduplicates stored and currently visible ERP SKU selections", () => {
  const selector = {
    dataset: { selectedProductIds: JSON.stringify(["erp-sku-a", "erp-sku-b"]) },
    matches: () => true,
    querySelectorAll: () => [{ value: "erp-sku-b", checked: true }],
  };

  assert.deepEqual(collectActionProductIds(selector), ["erp-sku-a", "erp-sku-b"]);
});
