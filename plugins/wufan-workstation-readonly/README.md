# 极简工作站助手插件（受控发起关键行动）

这个插件让 Codex 通过极简工作站正式 API 读取目标、关键行动、任务、产品、ERP SKU、Link、经营数据、数据中心状态、异常摘要、驾驶舱和通知摘要，并在用户查看预览、明确确认后发起关键行动。

## 最简安装

把完整 ZIP 文件交给目标电脑上的 Codex，再粘贴 ZIP 根目录中的《交给Codex的安装提示词.txt》。用户只需在本机保密窗口输入一次助手账号密码，之后短期 JWT 自动续期。

公司局域网 API 是 `http://192.168.31.11:3001`；Tailscale 地址是 `http://100.123.85.59:3001`。`5173` 是网页端口，不能配置为插件 API。

## 权限与安全边界

- `wufan-assistant` 只需正式的读取权限，以及唯一新增的 `keyActions.launch`（发起关键行动）权限；该权限依赖查看关键行动、查看行动标准。
- 查询工具调用固定白名单 GET 接口；预览接口只校验和查重，不写业务数据。
- 真正发起必须使用预览返回的15分钟短时确认凭证，且内容不能发生变化。Codex 必须先展示预览，再等待用户当前对话中的明确确认。
- 不连接 SQLite，不使用 SSH，不读取服务器文件。
- 不提供任务执行、编辑/取消行动、产品/Link/财务写入、删除、审批、导入、同步执行、通知状态或权限管理工具。
- 除受控发起接口外，设备会话会在服务器层拒绝所有非读取请求。
- 原有只读设备会话不会因为账号增加 `keyActions.launch` 而失效；需要发起能力的设备必须重新运行安装脚本，单独取得 `key_action_launcher` 会话。

## Windows

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\plugins\wufan-workstation-readonly\setup\setup-windows.ps1 -BaseUrl "http://192.168.31.11:3001"
```

脚本在本机保密输入密码，将短期 JWT 和设备续期凭证保存到 `%USERPROFILE%\.codex\wufan-workstation\`，并把凭证文件权限限制为当前 Windows 用户。

## macOS / Linux

```sh
chmod +x ./plugins/wufan-workstation-readonly/setup/setup-unix.sh
./plugins/wufan-workstation-readonly/setup/setup-unix.sh --base-url=http://192.168.31.11:3001
```

## 验收

重启 Codex、开启新任务后确认：

1. `wufan_workstation` 可分页读取目标、任务、产品、Link、经营与异常数据。
2. 可以读取可发起行动标准及正式表单字段。
3. 预览不产生工作计划、流程实例或任务。
4. 未确认、确认过期、内容变化或重复行动均不能提交。
5. 成功确认只创建一条关键行动及其标准步骤任务。
6. 任务、产品、Link、财务、同步、通知、导入、审批、删除和权限写接口仍为403。

JWT、设备续期凭证、密码、数据库文件和服务器凭据禁止放进插件目录或分发压缩包。
