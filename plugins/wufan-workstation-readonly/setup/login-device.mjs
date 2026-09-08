import fs from "node:fs";
import path from "node:path";

const [baseUrlValue, configDirectory, usernameValue, deviceNameValue, accessProfileValue = "key_action_launcher"] = process.argv.slice(2);

function required(value, label, maximum = 2048) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maximum) throw new Error(`${label}无效。`);
  return text;
}

async function readPassword() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new Error("密码输入超过安全上限。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/u, "");
}

let password = "";
try {
  const baseUrl = new URL(required(baseUrlValue, "工作站地址"));
  if (!new Set(["http:", "https:"]).has(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("工作站地址无效。");
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/u, "") + "/api/auth/login";
  const directory = path.resolve(required(configDirectory, "配置目录"));
  const username = required(usernameValue, "登录账号", 120);
  const assistantDeviceName = required(deviceNameValue, "设备名称", 120);
  const assistantAccessProfile = required(accessProfileValue, "助手访问类型", 40);
  if (assistantAccessProfile !== "key_action_launcher") throw new Error("此安装包只允许受控发起关键行动访问类型。");
  password = await readPassword();
  if (!password) throw new Error("密码不能为空。");
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, assistantDeviceName, assistantAccessProfile }),
    redirect: "error",
  });
  const raw = await response.text();
  if (raw.length > 1024 * 1024) throw new Error("登录响应超过安全上限。");
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error("登录接口返回了无效JSON。"); }
  if (!response.ok || !payload?.token || !payload?.refreshToken) {
    throw new Error(payload?.message || `设备授权失败（HTTP ${response.status}）。`);
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, "token.jwt"), payload.token, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(path.join(directory, "refresh.token"), payload.refreshToken, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(path.join(directory, "token.jwt"), 0o600);
  fs.chmodSync(path.join(directory, "refresh.token"), 0o600);
  process.stdout.write(`助手设备授权成功：${payload.deviceSession?.deviceName || assistantDeviceName}\n`);
} catch (error) {
  process.stderr.write(`${error?.message || "助手设备授权失败。"}\n`);
  process.exitCode = 1;
} finally {
  password = "";
}
