param(
  [string]$BaseUrl = "http://100.123.85.59:3001",
  [string]$Username = "wufan-assistant",
  [string]$DeviceName = $env:COMPUTERNAME,
  [switch]$SkipPluginInstall,
  [switch]$SkipConnectionTest
)

$ErrorActionPreference = "Stop"
$PluginName = "wufan-workstation-readonly"
$MarketplaceName = "wufan-internal"
$MarketplaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$ConfigDirectory = Join-Path $env:USERPROFILE ".codex\wufan-workstation"
$ConfigPath = Join-Path $ConfigDirectory "config.json"
$TokenPath = Join-Path $ConfigDirectory "token.jwt"
$RefreshTokenPath = Join-Path $ConfigDirectory "refresh.token"

$parsedUrl = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$parsedUrl) -or
    $parsedUrl.Scheme -notin @("http", "https") -or
    $parsedUrl.UserInfo -or $parsedUrl.Query -or $parsedUrl.Fragment) {
  throw "工作站地址必须是无账号、无查询参数的HTTP或HTTPS地址。"
}
$BaseUrl = $BaseUrl.TrimEnd("/")

$Username = $Username.Trim()
$DeviceName = $DeviceName.Trim()
if ([string]::IsNullOrWhiteSpace($Username)) { throw "登录账号不能为空。" }
if ([string]::IsNullOrWhiteSpace($DeviceName)) { throw "设备名称不能为空。" }

$securePassword = Read-Host "请输入${Username}的登录密码（仅用于首次设备授权）" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$password = ""
$token = ""
$refreshToken = ""
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ([string]::IsNullOrWhiteSpace($password)) { throw "密码不能为空。" }

  $loginBody = @{ username = $Username; password = $password; assistantDeviceName = $DeviceName; assistantAccessProfile = "key_action_launcher" } | ConvertTo-Json
  try {
    $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body $loginBody
  } catch {
    throw "助手设备授权失败，请检查账号密码、发起关键行动权限和网络。"
  }
  $token = [string]$login.token
  $refreshToken = [string]$login.refreshToken
  if ([string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace($refreshToken)) {
    throw "工作站未返回完整的设备续期凭证，请确认正式服务已更新。"
  }

  New-Item -ItemType Directory -Force -Path $ConfigDirectory | Out-Null
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $config = @{ baseUrl = $BaseUrl; tokenFile = "token.jwt"; refreshTokenFile = "refresh.token"; timeoutMs = 30000; maxResponseBytes = 8388608 } | ConvertTo-Json
  [System.IO.File]::WriteAllText($ConfigPath, $config + [Environment]::NewLine, $utf8NoBom)
  [System.IO.File]::WriteAllText($TokenPath, $token, $utf8NoBom)
  [System.IO.File]::WriteAllText($RefreshTokenPath, $refreshToken, $utf8NoBom)

  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($secretPath in @($TokenPath, $RefreshTokenPath)) {
    $acl = Get-Acl -LiteralPath $secretPath
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($accessRule in @($acl.Access)) {
      [void]$acl.RemoveAccessRuleAll($accessRule)
    }
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, "Read,Write", "Allow")
    [void]$acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $secretPath -AclObject $acl
  }

  if (-not $SkipConnectionTest) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" | Out-Null
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/notifications/summary?limit=1" -Headers @{ Authorization = "Bearer $token" } | Out-Null
    Write-Host "工作站网络、受控行动访问和自动续期凭证验证成功。" -ForegroundColor Green
  }
} finally {
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  $password = $null
  $loginBody = $null
  $login = $null
  $token = $null
  $refreshToken = $null
  $securePassword = $null
}

if (-not $SkipPluginInstall) {
  $codex = Get-Command codex -ErrorAction SilentlyContinue
  if ($null -eq $codex) {
    $standaloneCodex = Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin\codex.exe"
    if (Test-Path $standaloneCodex) { $codex = $standaloneCodex }
  }
  if ($null -eq $codex) {
    Write-Warning "未找到codex命令。配置和设备凭证已经保存；请按OpenAI官方方式安装Codex CLI，再重跑本脚本并使用-SkipConnectionTest。"
  } else {
    & $codex plugin marketplace add $MarketplaceRoot
    if ($LASTEXITCODE -ne 0) { throw "添加屋范内部插件源失败。若该源已添加，可继续运行：codex plugin add $PluginName@$MarketplaceName" }
    & $codex plugin add "$PluginName@$MarketplaceName"
    if ($LASTEXITCODE -ne 0) { throw "安装极简工作站助手插件失败。" }
    Write-Host "极简工作站助手插件安装成功。请完全退出并重启Codex，然后开始一个新任务。" -ForegroundColor Green
  }
}
