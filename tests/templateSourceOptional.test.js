import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("视觉模板支持不填源文件或保存私有云源文件链接", async () => {
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

    const linked = createResource("templates", {
      id: "template-source-link-test",
      name: "私有云源文件视觉模板",
      previewImage: {
        fileName: "linked-preview.png",
        fileUrl: "/uploads/images/linked-preview.png",
      },
      sourceFile: {
        sourceUrl: "https://private-cloud.example.com/templates/source-file.psd",
      },
      fileType: "design",
      tags: { scene: ["商品展示"] },
      createdAt: now,
      updatedAt: now,
    });

    assert.deepEqual(linked.sourceFile, {
      sourceUrl: "https://private-cloud.example.com/templates/source-file.psd",
    });

    const projectRoot = path.resolve(import.meta.dirname, "..");
    const templateCenterSource = fs.readFileSync(path.join(projectRoot, "src/templateCenterPage.js"), "utf8");
    const taskPageSource = fs.readFileSync(path.join(projectRoot, "src/tasksPage.js"), "utf8");
    const contentPageSource = fs.readFileSync(path.join(projectRoot, "src/contentSchedulePage.js"), "utf8");
    assert.match(templateCenterSource, /data-template-source-url/);
    assert.match(templateCenterSource, /sourceFile: sourceUrl === "" \? \{\} : \{ sourceUrl \}/);
    assert.doesNotMatch(templateCenterSource, /data-template-(?:edit-)?source-upload/);
    assert.doesNotMatch(templateCenterSource, /uploadGenericFile/);
    assert.doesNotMatch(`${templateCenterSource}\n${taskPageSource}\n${contentPageSource}`, /下载源文件/);
  } finally {
    closeDatabase();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
