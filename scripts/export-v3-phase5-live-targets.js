import fs from "node:fs";
import Database from "better-sqlite3";

const databasePath = process.argv[2] || "/private/tmp/v3-relation-main-chain-phase5.db";
const outputPath = process.argv[3] || "/private/tmp/v3-phase5-live-targets.json";
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const targets = database.prepare(`SELECT merchantSkuCode code FROM operating_erp_identity_observations
  WHERE inOperatingObjectSet=1 AND identityStatus='not_checked' ORDER BY normalizedCode`).all();
fs.writeFileSync(outputPath, `${JSON.stringify(targets, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, targets: targets.length }));
database.close();
