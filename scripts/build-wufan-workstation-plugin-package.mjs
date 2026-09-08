import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginName = "wufan-workstation-readonly";
const pluginRoot = path.join(root, "plugins", pluginName);
const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const releaseVersion = manifest.version.split("+")[0];
const outputDirectory = path.join(root, "release-packages");
const outputPath = path.join(outputDirectory, `${pluginName}-${releaseVersion}.zip`);

const forbiddenNames = new Set([".env", "token.jwt", "auth.secret", "workstation.db"]);
const jwtPattern = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u;
const zip = new JSZip();

function addDirectory(source, archivePrefix) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (forbiddenNames.has(entry.name)) throw new Error(`禁止把敏感文件打包：${entry.name}`);
    const absolute = path.join(source, entry.name);
    const archive = `${archivePrefix}/${entry.name}`.replace(/^\/+/, "");
    if (entry.isDirectory()) {
      addDirectory(absolute, archive);
      continue;
    }
    let data = fs.readFileSync(absolute);
    // cmd.exe can misparse UTF-8 batch files extracted with Unix-only line endings.
    // Normalize launchers in the distributable ZIP while keeping repository files portable.
    if (archive.toLowerCase().endsWith(".cmd")) {
      data = Buffer.from(data.toString("utf8").replace(/\r?\n/gu, "\r\n"), "utf8");
    }
    if (jwtPattern.test(data.toString("utf8"))) throw new Error(`检测到疑似JWT，停止打包：${absolute}`);
    const executable = /(?:\.sh|\/launch_wufan_workstation_mcp)$/u.test(archive);
    zip.file(archive, data, { unixPermissions: executable ? 0o100755 : 0o100644 });
  }
}

addDirectory(pluginRoot, `plugins/${pluginName}`);
zip.file(".agents/plugins/marketplace.json", fs.readFileSync(marketplacePath), { unixPermissions: 0o100644 });
zip.file("README.md", fs.readFileSync(path.join(pluginRoot, "README.md")), { unixPermissions: 0o100644 });
zip.file("交给Codex的安装提示词.txt", fs.readFileSync(path.join(pluginRoot, "INSTALL_PROMPT_CN.txt")), { unixPermissions: 0o100644 });
zip.file("install-windows.ps1", [
  "$ErrorActionPreference = \"Stop\"",
  `$installer = Join-Path $PSScriptRoot \"plugins\\${pluginName}\\setup\\setup-windows.ps1\"`,
  "& $installer @args",
  "exit $LASTEXITCODE",
  "",
].join("\r\n"), { unixPermissions: 0o100644 });
zip.file("install-unix.sh", [
  "#!/bin/sh",
  "set -eu",
  "script_dir=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
  `exec \"$script_dir/plugins/${pluginName}/setup/setup-unix.sh\" \"$@\"`,
  "",
].join("\n"), { unixPermissions: 0o100755 });

fs.mkdirSync(outputDirectory, { recursive: true });
const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
fs.writeFileSync(outputPath, content);
console.log(outputPath);
