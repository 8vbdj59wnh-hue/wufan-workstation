import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { areBackgroundJobsEnabled } from "../server/backgroundJobPolicy.js";

test("background jobs remain enabled by default for production compatibility", () => {
  assert.equal(areBackgroundJobsEnabled({}), true);
});

test("background jobs accept explicit enabled and disabled values", () => {
  for (const value of ["on", "true", "1", " ON "]) {
    assert.equal(areBackgroundJobsEnabled({ WUFAN_BACKGROUND_JOBS: value }), true);
  }
  for (const value of ["off", "false", "0", " OFF "]) {
    assert.equal(areBackgroundJobsEnabled({ WUFAN_BACKGROUND_JOBS: value }), false);
  }
});

test("background jobs reject ambiguous configuration", () => {
  assert.throws(
    () => areBackgroundJobsEnabled({ WUFAN_BACKGROUND_JOBS: "disabled" }),
    (error) => error.code === "wufan_background_jobs_invalid",
  );
});

test("server startup gates every automatic recovery and scheduler", () => {
  const source = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(source, /backgroundJobsEnabled && !isReleaseMaintenanceModeActive\(\)/u);
  assert.equal((source.match(/backgroundJobsEnabled \? setInterval/g) || []).length, 3);
});
