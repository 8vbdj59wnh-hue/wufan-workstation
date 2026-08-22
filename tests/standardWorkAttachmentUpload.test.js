import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function waitForServer(child, port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("附件隔离验证服务提前退出。");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("附件隔离验证服务启动超时。");
}

async function upload(port, token, name, type, bytes) {
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type }), name);
  const response = await fetch(`http://127.0.0.1:${port}/api/uploads/standard-work-attachment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  return { response, data: await response.json() };
}

test("关键行动与任务共用接口可上传、记录并下载 XMind", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xmind-attachment-"));
  const databasePath = path.join(directory, "workstation.db");
  const port = 3700 + (process.pid % 200);
  const child = spawn(process.env.WUFAN_TEST_NODE_BINARY ?? process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      WUFAN_ENV: "test",
      WUFAN_DB_PATH: databasePath,
      WUFAN_TEST_DATABASE_ROOT: directory,
      WUFAN_ALLOW_DB_RESET: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const uploadedPaths = [];
  try {
    await waitForServer(child, port);
    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123456" }),
    });
    const login = await loginResponse.json();
    assert.equal(loginResponse.status, 200);
    const xmindBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

    for (const name of ["关键行动思维导图.xmind", "任务思维导图.xmind"]) {
      const result = await upload(port, login.token, name, "application/x-xmind", xmindBytes);
      assert.equal(result.response.status, 200);
      assert.equal(result.data.originalName, name);
      assert.equal(result.data.ext, ".xmind");
      uploadedPaths.push(path.join(projectRoot, result.data.filePath));

      const download = await fetch(`http://127.0.0.1:${port}${result.data.filePath}`);
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), xmindBytes);
    }

    const rejected = await upload(port, login.token, "危险脚本.exe", "application/octet-stream", Buffer.from("bad"));
    assert.equal(rejected.response.status, 400);
  } finally {
    if (child.exitCode === null) {
      const childExit = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await childExit;
    }
    for (const uploadedPath of uploadedPaths) fs.rmSync(uploadedPath, { force: true });

    if (fs.existsSync(databasePath)) {
      const database = new Database(databasePath, { readonly: true });
      const success = database.prepare("SELECT COUNT(*) AS count FROM upload_audits WHERE status = 'success' AND originalNamesJson LIKE '%xmind%'").get().count;
      const rejected = database.prepare("SELECT COUNT(*) AS count FROM upload_audits WHERE status = 'rejected'").get().count;
      database.close();
      assert.equal(success, 2);
      assert.ok(rejected >= 1);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
