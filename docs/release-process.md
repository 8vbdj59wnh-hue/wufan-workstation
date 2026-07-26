# 极简工作站发布前准备

当前只启用了发布前检查、SQLite 在线备份和发布记录准备。真正的生产部署仍被
GitHub Actions 中的 `release backup workflow not ready` 保护门阻止。

## 基本原则

- Dev-01、GitHub 和 Server-01 均以 `main` 为正式分支。
- 正式发布必须显式指定远程 `main` 当前的40位完整 commit SHA。
- 发布前必须完成 dry-run。
- 发布前数据库备份必须使用 SQLite `.backup`，禁止直接复制正在运行的数据库。
- 禁止直接运行旧 `deploy.sh` 或 `deploy-to-company.sh`。
- 禁止使用 `npm install`、`pm2 restart all`、force、reset 或 rebase 发布。
- 本阶段不会更新生产源码、安装依赖、重启服务、执行标签或自动恢复数据库。

## Dry-run

在 Server-01 项目目录执行：

```bash
scripts/release-prepare.sh \
  --commit <40位完整SHA> \
  --change-type <frontend|backend|deps|schema|uploads|runtime> \
  --dry-run
```

Dry-run 会读取 Git、数据库、端口、PM2、健康接口和磁盘状态，可以 fetch
`origin/main` 用于判断，但不会修改工作区、创建正式 release 目录、生成数据库
备份、安装依赖或重启服务。临时 dry-run 目录会在退出时清理。

## 正式发布准备

在备份机制验收后，可运行不带 `--dry-run` 的准备命令。它只准备发布证据和数据库
备份，仍不会部署：

```bash
scripts/release-prepare.sh \
  --commit <40位完整SHA> \
  --change-type <frontend|backend|deps|schema|runtime>
```

`uploads` 类型会明确停止，等待专项 uploads 备份方案，不会自动创建大型全量压缩包。

## Release目录

正式记录写入仓库之外：

```text
/Users/meiyounaichatouyuna/WufanWorkstationReleases/
  release-YYYYMMDD-HHMMSS-<目标commit前8位>/
    release-manifest.json
    database/
    git/
    pm2/
    config/
    checks/
    logs/
```

目录不覆盖已有发布记录，不写入项目、data 或 uploads。

## SQLite在线备份

`release-backup.sh` 使用 `sqlite3 .backup` 生成事务一致备份，并验证：

- 文件存在且非空
- `PRAGMA integrity_check = ok`
- 文件大小
- SHA-256
- 数据表数量

manifest 不包含密码、Token、SSH密钥、完整环境变量或数据库业务内容。

## 尚未启用

以下能力尚未启用：

- 更新 Server-01 源码
- 生产依赖安装
- 数据库迁移预演与执行
- PM2 定向重启
- 发布后业务健康验收
- Git生产标签
- 自动或人工数据库回滚

在上述能力完成前，不得移除 Production Deploy workflow 的保护门。
