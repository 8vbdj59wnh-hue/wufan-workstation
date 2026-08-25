import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { markAllUserNotificationsRead, readNotificationSummary } from "../server/notificationSummaryService.js";

function fixture() {
  const database = new Database(":memory:");
  database.exec(`CREATE TABLE notifications(
    id TEXT PRIMARY KEY,userId TEXT,taskId TEXT,processInstanceId TEXT,type TEXT,title TEXT,message TEXT,status TEXT,severity TEXT,
    dueDate TEXT,readAt TEXT,createdAt TEXT,updatedAt TEXT
  )`);
  const insert = database.prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insert.run("n1", "user-1", "task-1", null, "due", "高优先", "", "unread", "high", null, null, "2026-08-20", "2026-08-20");
  insert.run("n2", "user-1", "task-2", null, "due", "普通", "", "unread", "normal", null, null, "2026-08-21", "2026-08-21");
  insert.run("n3", "user-1", "task-3", null, "due", "已读", "", "read", "high", null, "2026-08-22", "2026-08-22", "2026-08-22");
  insert.run("n4", "user-2", "task-4", null, "due", "其他用户", "", "unread", "high", null, null, "2026-08-23", "2026-08-23");
  return database;
}

test("通知启动只返回当前用户的有限摘要并保留完整未读数", () => {
  const database = fixture();
  const summary = readNotificationSummary("user-1", { database, limit: 2 });
  assert.equal(summary.unreadCount, 2);
  assert.deepEqual(summary.items.map((item) => item.id), ["n1", "n2"]);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 10_000);
  database.close();
});

test("批量已读只修改当前用户", () => {
  const database = fixture();
  const result = markAllUserNotificationsRead("user-1", { database, readAt: "2026-08-25T12:00:00Z" });
  assert.equal(result.updatedCount, 2);
  assert.equal(readNotificationSummary("user-1", { database }).unreadCount, 0);
  assert.equal(readNotificationSummary("user-2", { database }).unreadCount, 1);
  database.close();
});
