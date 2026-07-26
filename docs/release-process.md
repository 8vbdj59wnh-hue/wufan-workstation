# 极简工作站本地发布流程

## 正式架构

- Dev-01 是唯一开发环境，使用本地 Git `main` 管理开发历史。
- Server-01 是唯一生产环境，不直接开发，不访问任何 Git remote。
- GitHub 不属于开发检查、发布或生产工作流。
- Dev-01 生成离线发布包，校验后传输到 Server-01。
- Server-01 从发布包执行备份、迁移预演、健康检查和纯快进更新。
- 发布完成后必须由维护者在浏览器中手动登录并验收业务页面。

保留Git remote配置不影响本流程；正式脚本不会读取或使用remote。

## Dev-01发布前基线

发布前必须满足：

- 当前分支为 `main`；
- 工作区、暂存区和未跟踪文件均干净；
- 所有开发修改已经形成本地Git commit；
- 目标40位commit存在于Dev-01本地仓库；
- `uploads`变更不使用普通发布流程。

生成发布包：

```bash
scripts/release-package.sh \
  --commit <40位SHA> \
  --change-type <frontend|backend|deps|schema|runtime> \
  --output-dir <绝对路径>
```

## 发布包

目录名称：

```text
wufan-release-YYYYMMDD-HHMMSS-<shortsha>/
```

内容至少包括：

```text
source.tar.gz
source.bundle
release-metadata.json
SHA256SUMS
scripts/
```

- `source.tar.gz`直接由目标Git commit生成，不含 `.git`、`node_modules`、`data`、
  `uploads`、日志、缓存或临时文件。
- `source.bundle`提供目标commit及其完整本地Git历史，用于Server-01验证commit和
  执行纯fast-forward。
- `SHA256SUMS`覆盖包内所有文件，可独立使用 `shasum -a 256 -c` 验证。
- metadata和发布包不得包含密码、Token或环境变量。

## Server-01发布

先执行dry-run：

```bash
scripts/release-from-package.sh \
  --package-dir <发布包绝对路径> \
  --dry-run
```

dry-run不会创建正式数据库备份、更新源码、安装依赖、重启服务或创建标签。

正式执行：

```bash
scripts/release-from-package.sh \
  --package-dir <发布包绝对路径> \
  --confirm DEPLOY
```

标准顺序：

1. 校验发布包结构、SHA256SUMS、metadata、源码归档和Git bundle。
2. 确认Server-01路径、main、干净工作区、数据库、PM2、端口和磁盘。
3. 确认目标commit是当前生产commit的后代或相同。
4. 创建release目录和SQLite在线备份。
5. 保存Git、PM2、配置及发布包证据。
6. 必要时只在数据库备份副本上执行迁移预演和幂等检查。
7. 执行发布前基础健康检查。
8. 解压并校验源码归档。
9. 使用 `git merge --ff-only`更新到明确目标commit。
10. 仅在依赖变化时使用Node 22执行 `npm ci`。
11. 执行 `npm run check`并定向重启受影响服务。
12. 执行发布后健康检查和SQLite完整性检查。
13. manifest标记为deployed，执行 `pm2 save`。
14. Server-01创建本地annotated production标签。
15. 维护者执行浏览器人工验收。

## 生产标签

标签名称：

```text
production-YYYY-MM-DD-HHMM
```

标签只保存在Server-01和Dev-01本地Git仓库，不要求推送到任何网络平台。Server发布
成功后，Dev-01根据release记录中的标签名称和说明，在同一commit创建同名annotated
tag。

## Backup-01

由于不存在网络源码副本，必须定期备份：

- Dev-01完整项目Git仓库，包括 `.git`、所有本地分支和标签；
- Server-01完整生产Git仓库，包括 `.git`和production标签；
- Server-01生产SQLite在线备份；
- Server-01生产uploads备份；
- 必要的release记录和manifest。

不得把正在写入的SQLite数据库直接复制；必须使用SQLite在线备份。不得把真实开发或
生产数据库外发到非Backup-01位置。

## 禁止事项

- Server-01直接开发；
- Server-01访问Git remote；
- `git pull`、fetch、reset、rebase或force；
- `npm install`；
- `pm2 restart all`；
- 自动恢复数据库；
- 普通发布流程修改uploads；
- 自动登录业务系统或写入业务测试数据；
- 直接复制正在运行的SQLite数据库。

旧发布脚本仅保留历史参考，默认退出。正式入口只有：

- Dev-01：`scripts/release-package.sh`
- Server-01：`scripts/release-from-package.sh`
