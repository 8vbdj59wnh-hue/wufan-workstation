"use strict";

const { resolveProductionPaths } = require("./server/productionPaths.cjs");

const paths = resolveProductionPaths(process.env);
const projectDir = paths.projectDir;
const node22 = process.env.WUFAN_NODE22_BIN || "/opt/homebrew/opt/node@22/bin/node";
const pm2Logs = paths.pm2LogRoot;
const productionPathEnvironment = {
  WUFAN_PROJECT_DIR: paths.projectDir,
  WUFAN_DATA_ROOT: paths.dataRoot,
  WUFAN_DB_PATH: paths.databasePath,
  WUFAN_DB_BASELINE_PATH: paths.baselinePath,
  WUFAN_UPLOADS_PATH: paths.uploadsPath,
  WUFAN_AUTH_SECRET_PATH: paths.authSecretPath,
  WUFAN_RELEASE_ROOT: paths.releaseRoot,
};

module.exports = {
  apps: [
    {
      name: "wufan-client",
      cwd: projectDir,
      script: "scripts/static-server.js",
      interpreter: node22,
      env: {
        HOST: "0.0.0.0",
        PORT: "5173",
        ...productionPathEnvironment,
      },
      autorestart: true,
      restart_delay: 1000,
      max_restarts: 10,
      kill_timeout: 5000,
      out_file: `${pm2Logs}/wufan-client-out.log`,
      error_file: `${pm2Logs}/wufan-client-error.log`,
      merge_logs: true,
    },
    {
      name: "wufan-server",
      cwd: projectDir,
      script: "server/index.js",
      interpreter: node22,
      env: {
        HOST: "0.0.0.0",
        PORT: "3001",
        WUFAN_ENV: "production",
        ...productionPathEnvironment,
        V3_AUTO_PROJECTION: "off",
        V3_SHADOW_ENABLED: "off",
        V3_AUTO_RELATION_WRITE: "off",
        V3_RELATION_READ: "off",
      },
      autorestart: true,
      restart_delay: 1000,
      max_restarts: 10,
      kill_timeout: 10000,
      out_file: `${pm2Logs}/wufan-server-out.log`,
      error_file: `${pm2Logs}/wufan-server-error.log`,
      merge_logs: true,
    },
  ],
};
