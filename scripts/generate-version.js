import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function run(command, fallback = "") {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] ?? "";
}

const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
const version = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const commit = run("git rev-parse --short HEAD", "unknown");
const description = getArgValue("--description") || process.env.DEPLOY_DESCRIPTION || "Tailscale deployment";

const payload = {
  version,
  time,
  commit,
  description,
};

const publicDir = path.resolve("public");
fs.mkdirSync(publicDir, { recursive: true });

const json = `${JSON.stringify(payload, null, 2)}\n`;
fs.writeFileSync(path.join(publicDir, "version.json"), json);
fs.writeFileSync(path.resolve("version.json"), json);

console.log(`Generated public/version.json and version.json for ${version} (${commit})`);
