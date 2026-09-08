#!/bin/sh
set -eu

base_url=${WUFAN_WORKSTATION_BASE_URL:-http://100.123.85.59:3001}
username=wufan-assistant
device_name=$(hostname 2>/dev/null || printf '%s' 'Codex device')
skip_install=0
skip_test=0
for argument in "$@"; do
  case "$argument" in
    --base-url=*) base_url=${argument#--base-url=} ;;
    --username=*) username=${argument#--username=} ;;
    --device-name=*) device_name=${argument#--device-name=} ;;
    --skip-plugin-install) skip_install=1 ;;
    --skip-connection-test) skip_test=1 ;;
    *) printf '%s\n' "未知参数：$argument" >&2; exit 64 ;;
  esac
done

case "$base_url" in
  http://*|https://*) ;;
  *) printf '%s\n' '工作站地址必须使用HTTP或HTTPS。' >&2; exit 64 ;;
esac
case "$base_url" in
  *\?*|*\#*|*@*) printf '%s\n' '工作站地址不能包含凭据、查询参数或片段。' >&2; exit 64 ;;
esac
base_url=${base_url%/}

plugin_name=wufan-workstation-readonly
marketplace_name=wufan-internal
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
marketplace_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
config_dir=${WUFAN_WORKSTATION_CONFIG_DIR:-"${HOME}/.codex/wufan-workstation"}
chmod +x "$script_dir/../scripts/launch_wufan_workstation_mcp"

printf '%s' "请输入${username}的登录密码（仅用于首次设备授权）：" >&2
stty -echo
trap 'stty echo' EXIT HUP INT TERM
IFS= read -r password
stty echo
trap - EXIT HUP INT TERM
printf '\n' >&2
[ -n "$password" ] || { printf '%s\n' '密码不能为空。' >&2; exit 64; }

umask 077
mkdir -p "$config_dir"
printf '{"baseUrl":"%s","tokenFile":"token.jwt","refreshTokenFile":"refresh.token","timeoutMs":30000,"maxResponseBytes":8388608}\n' "$base_url" > "$config_dir/config.json"
printf '%s\n' "$password" | "$script_dir/../scripts/launch_wufan_workstation_mcp" "$script_dir/login-device.mjs" "$base_url" "$config_dir" "$username" "$device_name"
password=
chmod 600 "$config_dir/token.jwt" "$config_dir/refresh.token" "$config_dir/config.json"

if [ "$skip_test" -eq 0 ]; then
  if command -v curl >/dev/null 2>&1; then
    token=$(cat "$config_dir/token.jwt")
    curl -fsS "$base_url/api/health" >/dev/null
    curl -fsS -H "Authorization: Bearer $token" "$base_url/api/notifications/summary?limit=1" >/dev/null
    printf '%s\n' '工作站网络、只读访问和自动续期凭证验证成功。'
  else
    printf '%s\n' '未找到curl，已跳过连接验证。' >&2
  fi
fi
token=

if [ "$skip_install" -eq 0 ]; then
  codex_command=
  if command -v codex >/dev/null 2>&1; then codex_command=$(command -v codex)
  elif [ -x "${HOME}/.local/bin/codex" ]; then codex_command="${HOME}/.local/bin/codex"
  fi
  if [ -n "$codex_command" ]; then
    "$codex_command" plugin marketplace add "$marketplace_root"
    "$codex_command" plugin add "$plugin_name@$marketplace_name"
    printf '%s\n' '极简工作站只读插件安装成功。请完全退出并重启Codex，然后开始一个新任务。'
  else
    printf '%s\n' '未找到codex命令。配置和设备凭证已经保存；请按OpenAI官方方式安装Codex CLI后重新运行本脚本。' >&2
  fi
fi
