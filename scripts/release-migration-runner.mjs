import {
  closeDatabase,
  databasePath,
  initializeDatabase,
  readAllData,
} from "../server/db.js";
import path from "node:path";

if (process.env.WUFAN_MIGRATION_PREVIEW !== "1") {
  throw new Error("release-migration-runner requires WUFAN_MIGRATION_PREVIEW=1");
}
if (process.env.WUFAN_ENV !== "migration-preview") {
  throw new Error("release-migration-runner requires WUFAN_ENV=migration-preview");
}

const requestedPath = String(process.env.WUFAN_DB_PATH ?? "").trim();
if (requestedPath === "") {
  throw new Error("release-migration-runner requires an explicit WUFAN_DB_PATH");
}
if (databasePath !== path.resolve(requestedPath)) {
  throw new Error("release-migration-runner database path mismatch");
}

console.log(`[migration-preview] databasePath=${databasePath}`);
initializeDatabase();
const data = readAllData();
console.log(
  `[migration-preview] readOnlyCounts=${JSON.stringify({
    companies: data.companies?.length ?? 0,
    people: data.people?.length ?? 0,
    goals: data.goals?.length ?? 0,
    tasks: data.tasks?.length ?? 0,
    processTemplates: data.processTemplates?.length ?? 0,
    products: data.products?.length ?? 0,
  })}`,
);
closeDatabase();
