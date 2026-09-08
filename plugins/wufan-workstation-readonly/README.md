# 极简工作站只读助手插件

这个插件让 Codex 通过极简工作站正式 API 读取目标、关键行动、任务、产品、ERP SKU、Link、经营数据、数据中心状态、异常摘要、驾驶舱和通知摘要。

## 最简安装方式

把完整 ZIP 文件交给目标电脑上的 Codex，再粘贴 ZIP 根目录中的《交给Codex的安装提示词.txt》。后续环境检查、安装、配置和验收均由 Codex 完成；用户只需在 Codex 明确询问时提供新签发的短期只读 JWT。

## 安全边界

- 只调用固定白名单中的 `GET /api/...` 正式接口。
- 不连接 SQLite，不使用 SSH，不读取服务器文件。
- 不提供新增、修改、删除、审批、导入、同步执行或权限管理工具。
- 每次请求都携带本机配置的短期 JWT，由工作站正式权限和 Data Scope 再次校验。
- 所有 MCP 工具均声明 `readOnlyHint: true`、`destructiveHint: false`。
- 单次响应默认限制为 8 MiB；产品和 Link 列表强制服务端分页，最大每页 100 条。

## 安装前准备

1. 安装并登录 Codex 桌面端和 Codex CLI。安装脚本需要 `codex plugin` 命令完成本地插件登记。
2. 通过 Tailscale 或公司正式网络访问工作站 API。
3. 为本机签发 `wufan-assistant` 的短期 JWT。不要复制其他电脑的旧 Token。

Windows 如果尚无 `codex` 命令，可在 PowerShell 使用 OpenAI 官方独立安装器：

```powershell
irm https://chatgpt.com/codex/install.ps1 | iex
```

## Windows

在解压后的市场目录中打开 PowerShell：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\plugins\wufan-workstation-readonly\setup\setup-windows.ps1
```

如果工作站地址不是默认地址：

```powershell
.\plugins\wufan-workstation-readonly\setup\setup-windows.ps1 -BaseUrl "https://workstation.example.internal"
```

JWT 保存到 `%USERPROFILE%\.codex\wufan-workstation\token.jwt`，脚本会把文件 ACL 限制为当前 Windows 用户。

## macOS / Linux

```sh
chmod +x ./plugins/wufan-workstation-readonly/setup/setup-unix.sh
./plugins/wufan-workstation-readonly/setup/setup-unix.sh
```

配置和 JWT 保存到 `~/.codex/wufan-workstation/`，文件权限为 `600`。

## 更新短期 JWT

重新运行对应系统的配置脚本即可覆盖旧 Token。只更新 Token 时可跳过重复安装：

```powershell
.\plugins\wufan-workstation-readonly\setup\setup-windows.ps1 -SkipPluginInstall
```

```sh
./plugins/wufan-workstation-readonly/setup/setup-unix.sh --skip-plugin-install
```

## 验收

重启 Codex 并开始新任务，然后检查：

1. `/mcp` 中存在 `wufan_workstation`。
2. 可以分页读取目标、任务、产品和 Link。
3. 可以按产品 ID、ERP SKU 编码或产品编码精确查询。
4. 数据中心状态查询不会触发同步。
5. 插件工具列表中不存在任何写入工具。
6. 使用同一 JWT 直接抽样工作站写接口时仍返回 403。

JWT、密码、数据库文件和服务器凭据禁止放进此插件目录或分发压缩包。
