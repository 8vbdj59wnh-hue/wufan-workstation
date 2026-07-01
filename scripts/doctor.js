import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const databasePath = path.join(projectRoot, "data", "workstation.db");
const uploadsDir = path.join(projectRoot, "uploads");
const checks = [];

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

function checkPathWritable(label, targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.R_OK | fs.constants.W_OK);
    addCheck(label, true, targetPath);
  } catch (error) {
    const sandboxBlocked = error.code === "EPERM";
    addCheck(
      label,
      sandboxBlocked,
      sandboxBlocked
        ? `${targetPath} 当前终端无直接检查权限，将以后端健康检查为准。`
        : `${targetPath} 不可读写：${error.message}`,
    );
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve({ statusCode: response.statusCode ?? 0, data: JSON.parse(body || "{}") });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(5000, () => {
      request.destroy(new Error("请求超时"));
    });
    request.on("error", reject);
  });
}

async function checkHealth() {
  const url = "http://127.0.0.1:3001/api/health";
  try {
    const { statusCode, data } = await getJson(url);
    const ok = statusCode >= 200 && statusCode < 300 && data.ok === true && data.databaseWritable === true && data.uploadsWritable === true;
    addCheck("后端健康检查", ok, `${statusCode} ${JSON.stringify(data)}`);
  } catch (error) {
    try {
      const output = execFileSync("curl", ["--noproxy", "*", "-sS", url], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const data = JSON.parse(output || "{}");
      const ok = data.ok === true && data.databaseWritable === true && data.uploadsWritable === true;
      addCheck("后端健康检查", ok, `curl ${JSON.stringify(data)}`);
    } catch {
      addCheck("后端健康检查", false, `${url} 无法访问：${error.message}`);
    }
  }
}

function checkCommand(label, command, args = []) {
  try {
    const output = execFileSync(command, args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    addCheck(label, true, output.trim().split("\n").slice(0, 6).join("\n"));
  } catch (error) {
    addCheck(label, false, error.stderr?.toString().trim() || error.message);
  }
}

checkPathWritable("SQLite 数据库文件可读写", databasePath);
checkPathWritable("uploads 目录可读写", uploadsDir);
checkCommand("代码语法检查", "npm", ["run", "check"]);
await checkHealth();

console.log("\n屋范工作站稳定性体检\n");
for (const check of checks) {
  console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}`);
  if (check.detail !== "") console.log(`  ${check.detail}`);
}

if (checks.some((check) => !check.ok)) {
  console.log("\n体检未通过，请先修复 FAIL 项。");
  process.exit(1);
}

console.log("\n体检通过。");
