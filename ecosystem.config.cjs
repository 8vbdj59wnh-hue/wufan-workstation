"use strict";

const projectDir = "/Users/meiyounaichatouyuna/Projects/goal-execution-system";
const node22 = "/opt/homebrew/opt/node@22/bin/node";
const pm2Logs = "/Users/meiyounaichatouyuna/.pm2/logs";

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
