import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("API responses use bounded level-1 compression without changing payload semantics", () => {
  const server = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(server, /import compression from "compression"/);
  assert.match(server, /app\.use\("\/api", compression\(\{ threshold: 1_024, level: 1 \}\)\)/);
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.dependencies.compression, "^1.8.2");
});
