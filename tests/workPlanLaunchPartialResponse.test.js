import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("work plan launch routes return affected resources without a full data snapshot", () => {
  const server = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  const start = server.indexOf('app.post("/api/work-plans/:id/launch"');
  const end = server.indexOf('app.post(\n  "/api/content-note-import/parse"', start);
  const routes = server.slice(start, end);
  assert.doesNotMatch(routes, /readAllData\s*\(/);
  assert.match(routes, /readRouteResourceItem\("work-plans"/);
  assert.match(routes, /readLaunchMutationSnapshot/);
});

test("adjacent process mutations use precise reads and partial mutation snapshots", () => {
  const server = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  const start = server.indexOf('app.post("/api/process-instances/:id/cancel"');
  const end = server.indexOf('app.put("/api/process-instances/:id/tasks/:taskId/executor"', start);
  const routes = server.slice(start, end);
  assert.doesNotMatch(routes, /readAllData\s*\(/);
  assert.match(routes, /readRouteResourceItem\("process-instances"/);
  assert.match(routes, /readResourceItems\("processInstances"/);
  assert.ok((routes.match(/readLaunchMutationSnapshot/g) || []).length >= 4);
});

test("launch clients merge partial responses and preserve unrelated module state", () => {
  const appState = fs.readFileSync(path.join(root, "src/appState.js"), "utf8");
  const singleStart = appState.indexOf("export async function launchWorkPlanAsProcess");
  const singleEnd = appState.indexOf("export async function updateActionProducts", singleStart);
  assert.match(appState.slice(singleStart, singleEnd), /applyDataMutationSnapshot\(data\.data\)/);
  const batchStart = appState.indexOf("export async function batchLaunchWorkPlanDrafts");
  const batchEnd = appState.indexOf("export async function parseContentNoteImport", batchStart);
  assert.match(appState.slice(batchStart, batchEnd), /applyDataMutationSnapshot\(body\.data\)/);
});

test("task executor and task-wave visibility checks avoid the global snapshot", () => {
  const server = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  const executorStart = server.indexOf('app.put("/api/process-instances/:id/tasks/:taskId/executor"');
  const executorEnd = server.indexOf('app.post("/api/key-actions/launch"', executorStart);
  assert.doesNotMatch(server.slice(executorStart, executorEnd), /readAllData\s*\(/);
  assert.match(server.slice(executorStart, executorEnd), /readRouteResourceItem\("persons"/);

  const visibilityStart = server.indexOf("function getVisibleTaskIds");
  const visibilityEnd = server.indexOf('app.get("/api/task-waves"', visibilityStart);
  assert.doesNotMatch(server.slice(visibilityStart, visibilityEnd), /readAllData\s*\(/);
  assert.match(server.slice(visibilityStart, visibilityEnd), /readResourceItems\("processInstances"/);
});
