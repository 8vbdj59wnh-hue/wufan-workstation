import crypto from "node:crypto";
import { createEmptyPermissions, normalizePermissions, permissionGroups } from "../shared/permissions.js";
import { findLoginUserById, getDatabase, getPublicUser } from "./db.js";

const sessionIdleLifetimeMs = 180 * 24 * 60 * 60 * 1000;
const refreshTokenPrefix = "wfr1";
export const AssistantAccessProfile = Object.freeze({
  ReadOnly: "read_only",
  KeyActionLauncher: "key_action_launcher",
});
const allowedProfiles = new Set(Object.values(AssistantAccessProfile));

function cleanText(value, maximumLength = 160) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

function sessionError(message, status = 401, code = "assistant_session_invalid") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

function parseRefreshToken(token) {
  const value = String(token ?? "").trim();
  const [prefix, sessionId, secret, ...extra] = value.split(".");
  if (prefix !== refreshTokenPrefix || !/^[0-9a-f-]{36}$/iu.test(sessionId) || !/^[A-Za-z0-9_-]{32,}$/u.test(secret) || extra.length) {
    throw sessionError("设备续期凭证无效，请重新授权这台设备。");
  }
  return { sessionId, value };
}

function isExpired(session, at = Date.now()) {
  const expiresAt = Date.parse(session?.expiresAt ?? "");
  return !Number.isFinite(expiresAt) || expiresAt <= at;
}

function requireScopedAssistantUser(row, requestedProfile = AssistantAccessProfile.ReadOnly) {
  const user = getPublicUser(row);
  if (!user || ["admin", "system_admin"].includes(user.role)) {
    throw sessionError("管理员账号不能建立助手设备会话。", 403, "assistant_session_profile_rejected");
  }
  const accessProfile = cleanText(requestedProfile, 40) || AssistantAccessProfile.ReadOnly;
  if (!allowedProfiles.has(accessProfile)) throw sessionError("助手设备访问类型无效。", 400, "assistant_session_profile_invalid");
  const permissions = normalizePermissions(user.permissions, user.role);
  let readableCapabilityCount = 0;
  for (const group of permissionGroups) {
    for (const permission of group.permissions) {
      if (permissions[group.key]?.[permission.key] !== true) continue;
      const permittedAccountWrite = group.key === "keyActions" && permission.key === "launch";
      if (permission.key !== "view" && !permittedAccountWrite) {
        throw sessionError("该账号包含当前助手访问类型不允许的写入或管理权限。", 403, "assistant_session_profile_rejected");
      }
      if (permission.key === "view") readableCapabilityCount += 1;
    }
  }
  if (readableCapabilityCount === 0) {
    throw sessionError("该账号没有可供助手使用的读取权限。", 403, "assistant_session_profile_rejected");
  }
  if (accessProfile === AssistantAccessProfile.KeyActionLauncher && permissions.keyActions.launch !== true) {
    throw sessionError("该账号尚未获得“发起关键行动”权限。", 403, "assistant_session_launch_permission_required");
  }
  return { user, permissions, accessProfile };
}

function publicSession(session) {
  return {
    id: session.id,
    deviceName: session.deviceName,
    accessProfile: session.accessProfile ?? AssistantAccessProfile.ReadOnly,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt ?? null,
  };
}

function readActiveSession(sessionId, expectedUserId = "") {
  const session = getDatabase().prepare("SELECT * FROM assistant_device_sessions WHERE id=? LIMIT 1").get(cleanText(sessionId, 80));
  if (!session || (expectedUserId && session.userId !== expectedUserId) || session.revokedAt || isExpired(session)) {
    throw sessionError("助手设备会话已失效或已撤销，请重新授权这台设备。");
  }
  const row = findLoginUserById(session.userId);
  if (!row || !row.canLogin || row.status !== "active") {
    throw sessionError("助手账号已停用或不允许登录。");
  }
  const scoped = requireScopedAssistantUser(row, session.accessProfile ?? AssistantAccessProfile.ReadOnly);
  return { session, row, ...scoped };
}

export function createAssistantDeviceSession(row, deviceName, requestedProfile = AssistantAccessProfile.ReadOnly) {
  const { user, accessProfile } = requireScopedAssistantUser(row, requestedProfile);
  const name = cleanText(deviceName, 120);
  if (!name) throw sessionError("请提供设备名称。", 400, "assistant_device_name_required");
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(48).toString("base64url");
  const refreshToken = `${refreshTokenPrefix}.${id}.${secret}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + sessionIdleLifetimeMs).toISOString();
  getDatabase().prepare(`INSERT INTO assistant_device_sessions
    (id,userId,deviceName,accessProfile,tokenHash,createdAt,lastUsedAt,expiresAt,revokedAt)
    VALUES(?,?,?,?,?,?,?,?,NULL)`).run(id, user.id, name, accessProfile, hashToken(refreshToken), createdAt, createdAt, expiresAt);
  return {
    refreshToken,
    session: { id, deviceName: name, accessProfile, createdAt, lastUsedAt: createdAt, expiresAt, revokedAt: null },
  };
}

export function refreshAssistantDeviceSession(refreshToken) {
  const parsed = parseRefreshToken(refreshToken);
  const result = readActiveSession(parsed.sessionId);
  const actualHash = Buffer.from(hashToken(parsed.value));
  const expectedHash = Buffer.from(result.session.tokenHash);
  if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(actualHash, expectedHash)) {
    throw sessionError("设备续期凭证无效，请重新授权这台设备。");
  }
  const lastUsedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + sessionIdleLifetimeMs).toISOString();
  getDatabase().prepare("UPDATE assistant_device_sessions SET lastUsedAt=?,expiresAt=? WHERE id=?")
    .run(lastUsedAt, expiresAt, result.session.id);
  return {
    row: result.row,
    user: result.user,
    session: publicSession({ ...result.session, lastUsedAt, expiresAt }),
  };
}

export function validateAssistantDeviceSession(sessionId, userId) {
  const result = readActiveSession(sessionId, userId);
  return { ...publicSession(result.session), accessProfile: result.accessProfile };
}

export function restrictUserToReadOnlyAssistant(user) {
  const source = normalizePermissions(user.permissions, user.role);
  const permissions = createEmptyPermissions(source.dataScope);
  for (const group of permissionGroups) {
    const view = group.permissions.find((permission) => permission.key === "view");
    if (view) permissions[group.key].view = source[group.key]?.view === true;
  }
  return { ...user, role: "user", permissions, assistantReadOnly: true };
}

export function restrictUserToAssistantProfile(user, accessProfile = AssistantAccessProfile.ReadOnly) {
  const restricted = restrictUserToReadOnlyAssistant(user);
  if (accessProfile !== AssistantAccessProfile.KeyActionLauncher) return { ...restricted, assistantAccessProfile: AssistantAccessProfile.ReadOnly };
  const source = normalizePermissions(user.permissions, user.role);
  restricted.permissions.keyActions.launch = source.keyActions.launch === true;
  restricted.permissions.keyActions.launchTemplateScope = source.keyActions.launchTemplateScope;
  restricted.permissions.keyActions.launchTemplateIds = [...source.keyActions.launchTemplateIds];
  return { ...restricted, assistantReadOnly: false, assistantScoped: true, assistantAccessProfile: accessProfile };
}

export function listAssistantDeviceSessions(userId) {
  return getDatabase().prepare(`SELECT id,deviceName,accessProfile,createdAt,lastUsedAt,expiresAt,revokedAt
    FROM assistant_device_sessions WHERE userId=? ORDER BY createdAt DESC`).all(cleanText(userId, 120)).map(publicSession);
}

export function revokeAssistantDeviceSession(userId, sessionId) {
  const revokedAt = new Date().toISOString();
  const result = getDatabase().prepare(`UPDATE assistant_device_sessions SET revokedAt=?
    WHERE id=? AND userId=? AND revokedAt IS NULL`).run(revokedAt, cleanText(sessionId, 80), cleanText(userId, 120));
  if (result.changes === 0) throw sessionError("未找到可撤销的助手设备会话。", 404, "assistant_session_not_found");
  return { id: cleanText(sessionId, 80), revokedAt };
}

export function assistantSessionHttpStatus(error) {
  return Number.isInteger(error?.status) ? error.status : 500;
}
