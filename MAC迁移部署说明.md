# 屋范工作站 Mac 迁移部署说明

本文用于把当前项目迁移到一台新的 Mac，并让新 Mac 作为公司局域网服务器运行。

## 1. 迁移包包含什么

迁移包 `wufan-workstation-migration.zip` 包含：

- `package.json`
- `pnpm-lock.yaml`、`pnpm-workspace.yaml`，如果存在
- `index.html`
- `src/`
- `server/`
- `scripts/`
- `data/workstation.db`
- `data/workstation.backup-before-mac-migration.db`
- `uploads/`
- `MAC迁移部署说明.md`

迁移包不包含：

- `node_modules/`
- `.git/`
- `dist/`
- `build/`
- `.DS_Store`
- 临时日志和缓存文件

## 2. 新 Mac 解压位置

建议在新 Mac 上创建目录：

```bash
mkdir -p ~/wufan
```

把 `wufan-workstation-migration.zip` 放到 `~/wufan`，然后解压：

```bash
cd ~/wufan
unzip wufan-workstation-migration.zip
cd goal-execution-system
```

## 3. 安装 Node.js

新 Mac 需要安装 Node.js，建议使用 Node.js 20 LTS 或更新的 LTS 版本。

检查是否已安装：

```bash
node -v
npm -v
```

如果没有安装，可以从 Node.js 官网下载安装包，或使用 Homebrew：

```bash
brew install node
```

## 4. 安装依赖

进入项目目录后运行：

```bash
npm install
```

如果依赖安装失败，优先检查网络、Node.js 版本，以及是否在正确目录中。

## 5. 启动后端

后端负责 SQLite 数据库、上传文件和 API。

打开一个终端窗口：

```bash
cd ~/wufan/goal-execution-system
npm run dev:server
```

后端默认地址：

```text
http://127.0.0.1:3001
```

健康检查：

```bash
curl http://127.0.0.1:3001/api/health
```

如果返回 `ok: true`，说明后端已启动并连接数据库。

## 6. 启动前端

再打开一个新的终端窗口：

```bash
cd ~/wufan/goal-execution-system
npm run dev:client
```

前端默认地址：

```text
http://127.0.0.1:5173
```

本机浏览器打开：

```text
http://127.0.0.1:5173/
```

## 7. 检查数据库是否存在

在项目根目录执行：

```bash
ls -lh data/workstation.db
```

应能看到数据库文件。不要删除、覆盖或重置该文件。

数据库迁移前备份文件：

```bash
ls -lh data/workstation.backup-before-mac-migration.db
```

## 8. 检查 uploads 是否存在

在项目根目录执行：

```bash
ls -la uploads
ls -la uploads/images
ls -la uploads/files
```

`uploads/` 保存本地上传图片和文件。备份时必须和数据库一起备份。

## 9. 检查本机访问

本机访问前端：

```text
http://127.0.0.1:5173/
```

本机检查后端：

```text
http://127.0.0.1:3001/api/health
```

如果前端能打开，并且没有提示使用模拟数据，说明基本运行正常。

## 10. 查看新 Mac 的局域网 IP

在新 Mac 终端执行：

```bash
ifconfig | grep "inet "
```

找到类似 `192.168.x.x` 的地址。也可以在系统设置中查看 Wi-Fi 详情。

假设新 Mac 局域网 IP 是：

```text
192.168.31.35
```

则公司同事访问地址为：

```text
http://192.168.31.35:5173/
```

后端 API 地址为：

```text
http://192.168.31.35:3001/api/health
```

## 11. 公司同事访问方式

确保所有设备连接同一个公司局域网或同一个 Wi-Fi。

同事在浏览器访问：

```text
http://新Mac局域网IP:5173/
```

例如：

```text
http://192.168.31.35:5173/
```

如果打不开，请检查：

- 新 Mac 是否开机
- 后端是否已启动
- 前端是否已启动
- 访问设备是否和新 Mac 在同一网络
- macOS 防火墙是否阻止了 Node 或 Python

## 12. 设置 Mac 不休眠

新 Mac 作为局域网服务器时，建议关闭自动睡眠。

系统设置：

1. 打开“系统设置”
2. 进入“锁定屏幕”或“电池 / 节能”
3. 设置接通电源时不自动睡眠
4. 勾选“接入电源时防止自动睡眠”，如果系统有该选项

也可以临时使用命令保持唤醒：

```bash
caffeinate
```

保持终端窗口打开即可。

## 13. 固定局域网 IP

建议在路由器后台给新 Mac 绑定固定 IP。

常见做法：

1. 登录公司路由器后台
2. 找到 DHCP / 地址保留 / 静态租约
3. 找到新 Mac 的设备名称或 MAC 地址
4. 绑定一个固定地址，例如 `192.168.31.35`
5. 保存并重启网络连接

这样同事访问地址不会频繁变化。

## 14. 备份到群晖 NAS

每次备份至少包含：

- `data/workstation.db`
- `uploads/`

建议备份到群晖 NAS 的一个固定目录，例如：

```text
//NAS/backup/wufan-workstation/
```

可以手动复制：

```bash
cp data/workstation.db /Volumes/backup/wufan-workstation/workstation-$(date +%Y%m%d-%H%M%S).db
cp -R uploads /Volumes/backup/wufan-workstation/uploads-$(date +%Y%m%d-%H%M%S)
```

如果未来做自动备份，请优先备份数据库和上传目录，不要只备份代码。

## 15. 常见问题排查

### 页面打不开

检查前端是否启动：

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

如果没有监听，重新运行：

```bash
npm run dev:client
```

### 页面提示使用模拟数据

说明后端未启动或 API 访问失败。

检查后端：

```bash
curl http://127.0.0.1:3001/api/health
```

如果失败，重新运行：

```bash
npm run dev:server
```

### 刷新后数据丢失

优先检查后端是否启动，以及 `data/workstation.db` 是否存在。

```bash
ls -lh data/workstation.db
curl http://127.0.0.1:3001/api/data
```

### 图片不显示

检查上传目录是否存在：

```bash
ls -la uploads/images
```

检查后端是否能访问上传文件。

### 局域网其他电脑打不开

检查：

- 前端是否监听 `0.0.0.0`
- 后端是否监听 `0.0.0.0`
- 新 Mac 和访问设备是否在同一网络
- 防火墙是否阻止端口 `5173` 和 `3001`
- 新 Mac 的 IP 是否变化

### 端口被占用

查看占用进程：

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

确认无误后再停止旧进程。

