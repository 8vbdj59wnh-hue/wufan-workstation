import assert from "node:assert/strict";
import test from "node:test";
import { createLoginRateLimiter } from "../server/loginRateLimit.js";

test("login failures are limited per address and normalized username", () => {
  const limiter = createLoginRateLimiter({ windowMs: 60_000, maxFailures: 3 });
  limiter.recordFailure("127.0.0.1", "Admin", 1_000);
  limiter.recordFailure("127.0.0.1", "admin", 1_100);
  assert.equal(limiter.read("127.0.0.1", "ADMIN", 1_200).blocked, false);
  assert.equal(limiter.recordFailure("127.0.0.1", "admin", 1_300).blocked, true);
  assert.equal(limiter.read("127.0.0.1", "admin", 1_300).retryAfterSeconds, 60);
});

test("successful login clearing and window expiry restore access", () => {
  const limiter = createLoginRateLimiter({ windowMs: 1_000, maxFailures: 1 });
  assert.equal(limiter.recordFailure("127.0.0.1", "admin", 1_000).blocked, true);
  limiter.clear("127.0.0.1", "admin");
  assert.equal(limiter.read("127.0.0.1", "admin", 1_100).blocked, false);
  assert.equal(limiter.recordFailure("127.0.0.1", "admin", 2_000).blocked, true);
  assert.equal(limiter.read("127.0.0.1", "admin", 3_001).blocked, false);
});
