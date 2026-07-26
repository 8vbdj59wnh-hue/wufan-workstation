# 极简工作站标准发布流程

## 基线与职责

- Dev-01 是唯一开发环境，只在 `main` 上形成候选发布提交。
- push 和 pull request 只执行 CI，不部署 Server-01。
- GitHub `Production Deploy` 只能通过 `workflow_dispatch` 人工触发。
- Server-01 不直接开发，不提交生产工作区修改。
- 正式目标必须是远程 `main` 当前的40位完整 commit SHA。
- GitHub `production` Environment 应配置 Required reviewers；未配置审批前不应触发正式部署。

生产健康检查需要在 `production` Environment 中配置：

- `WUFAN_HEALTH_USERNAME`
- `WUFAN_HEALTH_PASSWORD`

不得把管理员密码写入 workflow、脚本或 release manifest。

## 标准顺序

1. Dev-01 开发并通过本地检查。
2. push main，等待 CI 成功。
3. 执行发布 dry-run。
4. 创建 release 目录和SQLite在线备份。
5. 生成 Git、PM2、配置和 manifest 证据。
6. schema或迁移代码变化时，在数据库备份副本上运行 migration preview。
7. 执行发布前健康检查。
8. 通过 `git merge --ff-only` 更新生产源码。
9. 仅在依赖变化时用 Node 22 执行 `npm ci`。
10. 运行 `npm run check`。
11. 仅重启受影响的 `wufan-client`、`wufan-server`。
12. 执行发布后健康检查和数据库完整性检查。
13. 健康通过后执行 `pm2 save`，manifest标记为deployed。
14. 创建并推送 annotated production 标签。

## Dry-run

```bash
scripts/release.sh \
  --commit <40位完整SHA> \
  --change-type <frontend|backend|deps|schema|uploads|runtime> \
  --dry-run
```

没有 `--confirm DEPLOY` 时，统一入口自动退化为 dry-run。Dry-run可以fetch远程引用，
但不会merge、npm ci、重启服务、修改manifest正式状态或创建标签。

当目标等于当前Server HEAD时，dry-run会识别为no-op；只有真实发布目标才强制等于
远程main HEAD。

## Prepare与release目录

```bash
scripts/release.sh \
  --commit <SHA> \
  --change-type <类型> \
  --confirm DEPLOY \
  --prepare-only
```

正式记录写入：

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

SQLite备份只使用 `.backup`。禁止直接复制正在运行的 `workstation.db`。

## Migration preview

schema或迁移代码发生变化时，`release-migration-preview.sh`：

- 从release数据库备份再创建隔离预演副本；
- 从目标commit解压对应源码；
- 通过显式 `WUFAN_DB_PATH` 打开预演数据库；
- 使用Node 22执行初始化两次；
- 验证迁移前后完整性、表数量、schema差异、基础读取和幂等性；
- 永远不打开或覆盖正式数据库。

## Execute与健康检查

`release-execute.sh`只接受状态为prepared且数据库备份完整的release目录。迁移预演
需要但未通过时，执行会被阻止。

健康检查包括：

- PM2服务、工作目录、PID与端口；
- `/api/health`；
- 首页与核心前端资源，并与当前工作区SHA对照；
- 管理员登录和只读 `/api/data`；
- SQLite完整性和实际路径；
- 最近PM2错误日志。

健康检查不新增、修改或删除业务记录。

重启由实际变更文件决定：

- 纯前端：只重启client；
- 纯后端：只重启server；
- package或lockfile：Node 22执行npm ci，重启两个服务；
- schema：必须预演，只重启server；同时有前端文件时再重启client；
- ops/docs/Actions：不重启业务服务；
- uploads：统一流程直接停止，必须专项处理。

严禁 `pm2 restart all` 和 `npm install`。

## 标签

发布健康通过且manifest为deployed后，`release-tag.sh`创建：

```text
production-YYYY-MM-DD-HHMM
```

标签是annotated tag，包含目标commit、releaseId、变更类型、数据库备份SHA、迁移预演
和健康检查结果。禁止覆盖标签或force push。

## 失败与回滚计划

执行失败后立即停止并将manifest标记为failed。系统不会自动：

- `git reset`
- 恢复数据库
- 删除release目录
- 删除数据库备份

`release-rollback-plan.sh`只生成 `rollback-plan.json` 和 `rollback-plan.md`。
数据库迁移后或员工可能已经写入数据时，禁止直接覆盖旧数据库，应优先使用前向修复
提交和经过预演的前向迁移。

## 明确禁止

- push main自动部署
- Server-01直接开发
- uploads普通发布
- `git reset`、rebase、force
- `npm install`
- `pm2 restart all`
- 直接复制运行中的SQLite数据库
- 自动数据库回滚
- 跳过backup、manifest、health check或必要的migration preview

旧 `deploy.sh` 和 `deploy-to-company.sh` 已弃用，不得作为正式发布入口。
