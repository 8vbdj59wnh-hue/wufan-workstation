import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API进程提前退出：${child.exitCode}\n${child.capturedError || ""}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("API启动超时。");
}

async function request(baseUrl, pathname, { token = "", method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("只读助手设备可长期续期、逐台撤销且不能获得业务写权限", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-device-session-"));
  const databasePath = path.join(directory, "workstation.db");
  process.env.WUFAN_DB_PATH = databasePath;
  process.env.WUFAN_AUTH_SECRET_PATH = path.join(directory, "auth.secret");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { hashPassword } = await import("../server/security.js");
  const { createEmptyPermissions } = await import("../shared/permissions.js");
  let child;
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const people = database.prepare("SELECT id FROM persons WHERE lower(COALESCE(username,''))<>'admin' ORDER BY id LIMIT 2").all();
    assert.equal(people.length, 2);
    const readPermissions = createEmptyPermissions("all");
    for (const permission of ["goals", "keyActions", "tasks", "products", "skus", "links", "dataCenter", "cockpit"]) {
      readPermissions[permission].view = true;
    }
    const writePermissions = structuredClone(readPermissions);
    writePermissions.tasks.execute = true;
    const update = database.prepare(`UPDATE persons SET username=?,passwordHash=?,canLogin=1,authRole='user',role='member',
      permissionTemplateId=NULL,permissionOverrides=NULL,permissions=?,status='active' WHERE id=?`);
    update.run("assistant-read-test", hashPassword("read-password"), JSON.stringify(readPermissions), people[0].id);
    update.run("assistant-write-test", hashPassword("write-password"), JSON.stringify(writePermissions), people[1].id);
    closeDatabase();

    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server/index.js"], {
      cwd: projectRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), V3_AUTO_PROJECTION: "off", V3_SHADOW_ENABLED: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.capturedError = "";
    child.stderr.on("data", (chunk) => { child.capturedError += chunk.toString(); });
    await waitForServer(baseUrl, child);

    const loginA = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { username: "assistant-read-test", password: "read-password", assistantDeviceName: "Windows-A" },
    });
    const loginB = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { username: "assistant-read-test", password: "read-password", assistantDeviceName: "Windows-B" },
    });
    assert.equal(loginA.status, 200);
    assert.equal(loginB.status, 200);
    assert.match(loginA.body.refreshToken, /^wfr1\./u);
    assert.notEqual(loginA.body.refreshToken, loginB.body.refreshToken);
    const tokenPayload = JSON.parse(Buffer.from(loginA.body.token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(tokenPayload.mode, "assistant_read_only");
    assert.equal(tokenPayload.sid, loginA.body.deviceSession.id);
    const assetPayload = JSON.parse(Buffer.from(loginA.body.assetToken.split(".")[1], "base64url").toString("utf8"));
    assert.equal(assetPayload.mode, "assistant_read_only");
    assert.equal(assetPayload.sid, loginA.body.deviceSession.id);

    const businessWrite = await request(baseUrl, "/api/notifications/read-all", { method: "POST", token: loginA.body.token });
    assert.equal(businessWrite.status, 403);
    const sessions = await request(baseUrl, "/api/auth/device-sessions", { token: loginB.body.token });
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.sessions.length, 2);
    assert.equal(Object.hasOwn(sessions.body.sessions[0], "tokenHash"), false);
    const credentialAudit = new Database(databasePath, { readonly: true });
    try {
      const stored = credentialAudit.prepare("SELECT tokenHash FROM assistant_device_sessions WHERE id=?").get(loginA.body.deviceSession.id);
      assert.notEqual(stored.tokenHash, loginA.body.refreshToken);
      assert.match(stored.tokenHash, /^[0-9a-f]{64}$/u);
    } finally { credentialAudit.close(); }

    const refreshedB = await request(baseUrl, "/api/auth/device-sessions/refresh", {
      method: "POST",
      body: { refreshToken: loginB.body.refreshToken },
    });
    assert.equal(refreshedB.status, 200);
    const revokeA = await request(baseUrl, `/api/auth/device-sessions/${loginA.body.deviceSession.id}`, {
      method: "DELETE",
      token: refreshedB.body.token,
    });
    assert.equal(revokeA.status, 200);
    assert.equal((await request(baseUrl, "/api/notifications/summary?limit=1", { token: loginA.body.token })).status, 401);
    assert.equal((await fetch(`${baseUrl}/uploads/does-not-exist.png?access_token=${encodeURIComponent(loginA.body.assetToken)}`)).status, 401);
    assert.equal((await request(baseUrl, "/api/notifications/summary?limit=1", { token: refreshedB.body.token })).status, 200);
    assert.equal((await request(baseUrl, "/api/auth/device-sessions/refresh", {
      method: "POST",
      body: { refreshToken: loginA.body.refreshToken },
    })).status, 401);

    const writeAccountDeviceLogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { username: "assistant-write-test", password: "write-password", assistantDeviceName: "Unsafe-device" },
    });
    assert.equal(writeAccountDeviceLogin.status, 403);

    const passwordChange = new Database(databasePath);
    try {
      passwordChange.prepare("UPDATE persons SET passwordHash=? WHERE id=?").run(hashPassword("new-read-password"), people[0].id);
    } finally { passwordChange.close(); }
    assert.equal((await request(baseUrl, "/api/notifications/summary?limit=1", { token: refreshedB.body.token })).status, 200);
    assert.equal((await request(baseUrl, "/api/auth/device-sessions/refresh", {
      method: "POST",
      body: { refreshToken: loginB.body.refreshToken },
    })).status, 200);

    const direct = new Database(databasePath);
    try {
      direct.prepare("UPDATE persons SET permissions=? WHERE id=?").run(JSON.stringify(writePermissions), people[0].id);
    } finally { direct.close(); }
    assert.equal((await request(baseUrl, "/api/notifications/summary?limit=1", { token: refreshedB.body.token })).status, 403);

    const integrity = new Database(databasePath, { readonly: true });
    try {
      assert.equal(integrity.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(integrity.pragma("foreign_key_check"), []);
    } finally { integrity.close(); }
  } finally {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    closeDatabase();
  }
});
