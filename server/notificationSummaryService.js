import { getDatabase } from "./db.js";

export function readNotificationSummary(userId, options = {}) {
  const database = options.database || getDatabase();
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(options.limit ?? "12"), 10) || 12));
  const normalizedUserId = String(userId ?? "");
  const items = database.prepare(`SELECT id,userId,taskId,processInstanceId,type,title,message,status,severity,dueDate,readAt,createdAt,updatedAt
    FROM notifications
    WHERE userId=?
    ORDER BY CASE status WHEN 'unread' THEN 0 ELSE 1 END,
      CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      createdAt DESC,id DESC
    LIMIT ?`).all(normalizedUserId, limit);
  const unreadCount = Number(database.prepare("SELECT COUNT(*) count FROM notifications WHERE userId=? AND status='unread'").get(normalizedUserId)?.count || 0);
  return { unreadCount, items };
}

export function markAllUserNotificationsRead(userId, options = {}) {
  const database = options.database || getDatabase();
  const readAt = options.readAt || new Date().toISOString();
  const result = database.prepare(`UPDATE notifications
    SET status='read',readAt=?,updatedAt=?
    WHERE userId=? AND status='unread'`).run(readAt, readAt, String(userId ?? ""));
  return { updatedCount: Number(result.changes || 0), readAt };
}
