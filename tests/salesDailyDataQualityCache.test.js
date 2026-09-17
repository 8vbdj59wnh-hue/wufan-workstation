import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { readSalesDailyQualityCacheRevision } from "../server/salesDailyDataQualityService.js";

test("quality cache revision changes for same-connection and external writes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sales-quality-cache-"));
  const databasePath = path.join(directory, "cache.db");
  const primary = new Database(databasePath);
  primary.exec("CREATE TABLE changes (id INTEGER PRIMARY KEY,value TEXT)");
  const initial = readSalesDailyQualityCacheRevision(primary);
  primary.prepare("INSERT INTO changes(value) VALUES (?)").run("same-connection");
  const afterLocalWrite = readSalesDailyQualityCacheRevision(primary);
  assert.notEqual(afterLocalWrite, initial);

  const secondary = new Database(databasePath);
  secondary.prepare("INSERT INTO changes(value) VALUES (?)").run("external-connection");
  secondary.close();
  const afterExternalWrite = readSalesDailyQualityCacheRevision(primary);
  assert.notEqual(afterExternalWrite, afterLocalWrite);
  primary.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
