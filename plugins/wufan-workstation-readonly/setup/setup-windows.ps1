param(
  [string]$BaseUrl = "http://100.123.85.59:3001",
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

$parsedUrl = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$parsedUrl) -or
    $parsedUrl.Scheme -notin @("http", "https") -or
    $parsedUrl.UserInfo -or $parsedUrl.Query -or $parsedUrl.Fragment) {
  throw "工作站地址必须是无账号、无查询参数的HTTP或HTTPS地址。"
}
$BaseUrl = $BaseUrl.TrimEnd("/")

$secureToken = Read-Host "请输入本机专用的wufan-assistant短期JWT" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$token = ""
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer).Trim()
  if ([string]::IsNullOrWhiteSpace($token)) { throw "JWT不能为空。" }

  New-Item -ItemType Directory -Force -Path $ConfigDirectory | Out-Null
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $config = @{ baseUrl = $BaseUrl; tokenFile = "token.jwt"; timeoutMs = 30000; maxResponseBytes = 8388608 } | ConvertTo-Json
  [System.IO.File]::WriteAllText($ConfigPath, $config + [Environment]::NewLine, $utf8NoBom)
  [System.IO.File]::WriteAllText($TokenPath, $token, $utf8NoBom)

  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $TokenPath
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($accessRule in @($acl.Access)) {
    [void]$acl.RemoveAccessRuleAll($accessRule)
  }
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, "Read,Write", "Allow")
  [void]$acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $TokenPath -AclObject $acl

  if (-not $SkipConnectionTest) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" | Out-Null
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/notifications/summary?limit=1" -Headers @{ Authorization = "Bearer $token" } | Out-Null
    Write-Host "工作站网络和只读JWT验证成功。" -ForegroundColor Green
  }
} finally {
  if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
  $token = $null
  $secureToken = $null
}

if (-not $SkipPluginInstall) {
  $codex = Get-Command codex -ErrorAction SilentlyContinue
  if ($null -eq $codex) {
    $standaloneCodex = Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin\codex.exe"
    if (Test-Path $standaloneCodex) { $codex = $standaloneCodex }
  }
  if ($null -eq $codex) {
    Write-Warning "未找到codex命令。配置和JWT已经保存；请按OpenAI官方方式安装Codex CLI，再重跑本脚本并使用-SkipConnectionTest。"
  } else {
    & $codex plugin marketplace add $MarketplaceRoot
    if ($LASTEXITCODE -ne 0) { throw "添加屋范内部插件源失败。若该源已添加，可继续运行：codex plugin add $PluginName@$MarketplaceName" }
    & $codex plugin add "$PluginName@$MarketplaceName"
    if ($LASTEXITCODE -ne 0) { throw "安装极简工作站只读插件失败。" }
    Write-Host "极简工作站只读插件安装成功。请完全退出并重启Codex，然后开始一个新任务。" -ForegroundColor Green
  }
}
