import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAuthSecretPath } from "./runtimePaths.js";

const passwordIterations = 120_000;
const tokenMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const assetTokenMaxAgeMs = 24 * 60 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const authSecretPath = resolveAuthSecretPath({ defaultDataDir: dataDir });
const productionEnvironment = String(process.env.WUFAN_ENV ?? "").trim().toLowerCase() === "production";

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getAuthSecret() {
  if (!fs.existsSync(authSecretPath)) {
    if (productionEnvironment) {
      const error = new Error("production_auth_secret_missing");
      error.code = "production_auth_secret_missing";
      throw error;
    }
    fs.mkdirSync(path.dirname(authSecretPath), { recursive: true });
    fs.writeFileSync(authSecretPath, crypto.randomBytes(48).toString("base64url"), { mode: 0o600 });
  }
  return fs.readFileSync(authSecretPath, "utf8").trim();
}

function sign(value) {
  return crypto.createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, passwordIterations, 32, "sha256").toString("base64url");
  return `pbkdf2$${passwordIterations}$${salt}$${hash}`;
}

export function verifyPassword(password, passwordHash) {
  const [algorithm, iterationsText, salt, storedHash] = String(passwordHash ?? "").split("$");
  if (algorithm !== "pbkdf2" || !iterationsText || !salt || !storedHash) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  if (hash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

function createSignedToken(user, audience, maxAgeMs, additionalClaims = {}) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.authRole ?? "user",
    aud: audience,
    exp: Date.now() + maxAgeMs,
    ...additionalClaims,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  return `${unsigned}.${sign(unsigned)}`;
}

function verifySignedToken(token, audience, { allowMissingAudience = false } = {}) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const unsigned = `${header}.${payload}`;
  const expectedSignature = sign(unsigned);
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedSignatureBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) return null;

  try {
    const decodedHeader = JSON.parse(base64UrlDecode(header));
    const decoded = JSON.parse(base64UrlDecode(payload));
    if (decodedHeader.alg !== "HS256" || decodedHeader.typ !== "JWT") return null;
    if (typeof decoded.exp !== "number" || decoded.exp < Date.now()) return null;
    if (decoded.aud !== audience && !(allowMissingAudience && decoded.aud === undefined)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function createToken(user) {
  return createSignedToken(user, "api", tokenMaxAgeMs);
}

export function createReadOnlyAssistantToken(user, sessionId) {
  return createSignedToken(user, "api", tokenMaxAgeMs, {
    mode: "assistant_read_only",
    sid: String(sessionId ?? ""),
  });
}

export function createScopedAssistantToken(user, sessionId, accessProfile = "read_only") {
  return createSignedToken(user, "api", tokenMaxAgeMs, {
    mode: "assistant_scoped",
    sid: String(sessionId ?? ""),
    assistantAccessProfile: String(accessProfile ?? "read_only"),
  });
}

export function createKeyActionLaunchConfirmationToken(userId, fingerprint) {
  return createSignedToken({ id: String(userId ?? ""), username: "assistant", authRole: "user" }, "key-action-launch-confirmation", 15 * 60 * 1000, {
    fingerprint: String(fingerprint ?? ""),
  });
}

export function verifyKeyActionLaunchConfirmationToken(token) {
  return verifySignedToken(token, "key-action-launch-confirmation");
}

export function verifyToken(token) {
  return verifySignedToken(token, "api", { allowMissingAudience: true });
}

export function createAssetToken(user) {
  return createSignedToken(user, "assets", assetTokenMaxAgeMs);
}

export function createReadOnlyAssistantAssetToken(user, sessionId) {
  return createSignedToken(user, "assets", assetTokenMaxAgeMs, {
    mode: "assistant_read_only",
    sid: String(sessionId ?? ""),
  });
}

export function createScopedAssistantAssetToken(user, sessionId, accessProfile = "read_only") {
  return createSignedToken(user, "assets", assetTokenMaxAgeMs, {
    mode: "assistant_scoped",
    sid: String(sessionId ?? ""),
    assistantAccessProfile: String(accessProfile ?? "read_only"),
  });
}

export function verifyAssetToken(token) {
  return verifySignedToken(token, "assets");
}
