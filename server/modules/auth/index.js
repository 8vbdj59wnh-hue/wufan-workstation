export { createAssetToken, createToken, verifyAssetToken, verifyPassword, verifyToken } from "../../security.js";
import {
  canAccessModule,
  canAccessTemplateCenter,
  canLaunchActionTemplate,
  getDataScope,
  hasPermission,
  validatePermissionDependencies,
} from "../../../shared/permissions.js";

export {
  canAccessModule,
  canAccessTemplateCenter,
  canLaunchActionTemplate,
  getDataScope,
  hasPermission,
  validatePermissionDependencies,
};

const personPermissionFields = new Set(["permissions", "permissionTemplateId", "permissionOverrides"]);
const personAccountFields = new Set(["username", "password", "passwordHash", "canLogin", "authRole", "mustChangePassword"]);

export function authorizePersonWrite(user, body = {}) {
  const hasField = (fields) => [...fields].some((key) => Object.prototype.hasOwnProperty.call(body, key));
  const permissionWrite = hasField(personPermissionFields);
  const accountWrite = hasField(personAccountFields);
  const metadataFields = new Set(["id", "createdAt", "updatedAt"]);
  const businessWrite = Object.keys(body).some((key) =>
    !personPermissionFields.has(key) && !personAccountFields.has(key) && !metadataFields.has(key));
  if (permissionWrite && !hasPermission(user, "permissions.manage")) return false;
  if (accountWrite && !hasPermission(user, "people.manageAccounts")) return false;
  if (businessWrite && !hasPermission(user, "people.manage")) return false;
  return permissionWrite || accountWrite || businessWrite;
}

const taskWorkflowPermissions = Object.freeze({
  start: "tasks.execute",
  submit: "tasks.execute",
  approve: "tasks.accept",
  reject: "tasks.accept",
  review_approve: "tasks.accept",
  review_reject: "tasks.accept",
  cancel: "tasks.cancel",
  return: "tasks.manage",
  activate: "tasks.manage",
  edit: "tasks.manage",
  restore: "tasks.manage",
});

export function getTaskWorkflowPermission(action) {
  return taskWorkflowPermissions[String(action ?? "").trim()];
}
