import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssetToken,
  createToken,
  verifyAssetToken,
  verifyToken,
} from "../server/security.js";

const user = { id: "person-security-test", username: "security-test", authRole: "user" };

test("API and asset tokens cannot be used across audiences", () => {
  const apiToken = createToken(user);
  const assetToken = createAssetToken(user);

  assert.equal(verifyToken(apiToken)?.sub, user.id);
  assert.equal(verifyAssetToken(assetToken)?.sub, user.id);
  assert.equal(verifyToken(assetToken), null);
  assert.equal(verifyAssetToken(apiToken), null);
});

test("tampered asset tokens are rejected", () => {
  const assetToken = createAssetToken(user);
  const replacement = assetToken.endsWith("a") ? "b" : "a";
  assert.equal(verifyAssetToken(`${assetToken.slice(0, -1)}${replacement}`), null);
});

test("malformed unicode signatures are rejected without throwing", () => {
  const assetToken = createAssetToken(user);
  const [header, payload, signature] = assetToken.split(".");
  const malformed = `${header}.${payload}.${"💥".repeat(signature.length)}`;

  assert.doesNotThrow(() => verifyAssetToken(malformed));
  assert.equal(verifyAssetToken(malformed), null);
});
