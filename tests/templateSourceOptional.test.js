import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("视觉模板不上传源文件也可以保存", async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "template-source-optional-"));
  process.env.WUFAN_DB_PATH = path.join(tempDirectory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, createResource, initializeDatabase } = await import("../server/db.js");

  try {
    initializeDatabase({ reset: true });
    const now = "2026-08-19T10:00:00.000Z";
    const saved = createResource("templates", {
      id: "template-source-optional-test",
      name: "无源文件视觉模板",
      previewImage: {
        fileName: "preview.png",
        fileUrl: "/uploads/images/preview.png",
      },
      fileType: "image",
      tags: { scene: ["商品展示"] },
      createdAt: now,
      updatedAt: now,
    });

    assert.equal(saved.name, "无源文件视觉模板");
    assert.deepEqual(saved.sourceFile, {});
    assert.equal(saved.previewImage.fileUrl, "/uploads/images/preview.png");
  } finally {
    closeDatabase();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
