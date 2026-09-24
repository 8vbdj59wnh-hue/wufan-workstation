import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const releaseScript = fs.readFileSync(new URL("../scripts/release-from-package.sh", import.meta.url), "utf8");

test("no-op release restarts a backend stopped by bootstrap maintenance fallback before health checks", () => {
  assert.match(
    releaseScript,
    /if \[\[ "\$BOOTSTRAP_SERVER_STOPPED" == true \|\| "\$REQUIRES_SERVER_RESTART" == "true" \]\]; then\s+"\$PM2_COMMAND" restart wufan-server --update-env\s+BOOTSTRAP_SERVER_STOPPED=false\s+fi/u,
  );
  assert.ok(
    releaseScript.indexOf('STAGE="service-restart"') < releaseScript.indexOf('STAGE="service-stabilization"'),
    "the bootstrap recovery restart must happen before service stabilization",
  );
});
