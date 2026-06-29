import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const passwordIterations = 120_000;
const tokenMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const authSecretPath = path.join(dataDir, "auth.secret");

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getAuthSecret() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(authSecretPath)) {
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

export function createToken(user) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.authRole ?? "user",
    exp: Date.now() + tokenMaxAgeMs,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyToken(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const unsigned = `${header}.${payload}`;
  if (signature !== sign(unsigned)) return null;

  try {
    const decoded = JSON.parse(base64UrlDecode(payload));
    if (typeof decoded.exp !== "number" || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}
