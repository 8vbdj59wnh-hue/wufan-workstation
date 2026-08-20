# Production Recovery-001 生产数据库保护修复与恢复准备验收报告

生成时间：2026-08-20（Asia/Shanghai）

## 结论

保护代码、异常库封存、差异分析和隔离恢复演练均已完成并通过。由于保护提交尚未部署到生产，且新的外置生产数据库文件尚未按正式恢复流程落位，**当前不可直接恢复生产数据库**。正式恢复必须先停止生产写入并部署本提交，再把经校验的完整备份恢复到锁定的外置路径。

## 1. 测试隔离与 reset 硬保护

- 所有数据库测试通过 `scripts/run-isolated-node.mjs` 在独立随机临时目录运行。
- 测试进程在导入数据库模块前设置 `WUFAN_ENV=test`、绝对临时数据库路径和 reset 授权。
- `initializeDatabase({ reset: true })` 只有在测试环境、明确授权且数据库位于允许的临时目录时才能执行。
- 生产环境、生产数据库路径、未授权测试路径均直接抛出 `production_database_reset_blocked`。

## 2. 生产数据库路径与发布检查

- 唯一生产路径：`/Users/meiyounaichatouyuna/WufanWorkstationData/production/workstation.db`。
- 生产环境必须显式提供 `WUFAN_ENV=production` 和上述绝对路径。
- 数据库缺失、路径未设置、路径不一致或位于代码仓库内时拒绝启动。
- 发布备份、发布前检查和发布后健康检查均改为使用外置生产路径。
- `npm run check` 中的数据库测试全部通过随机临时库运行，发布检查不再使用生产数据库。

## 3. 业务基线与健康检查

- 基线文件：`/Users/meiyounaichatouyuna/WufanWorkstationData/production/business-baseline.json`
- SHA256：`0be4638cf4565891866cda656aee4b4bddc080002a58e6673da3ccd1e5bd8b7e`
- 同时检查核心对象绝对最低数量和相对上一版本的最大下降比例。
- `/api/health` 区分 `technicalHealth` 与 `businessDataHealth`。
- 异常小库在隔离启动验证中返回 `database_baseline_failed` 并拒绝启动。

## 4. 当前异常小库封存

封存目录：`/Users/meiyounaichatouyuna/WufanWorkstationRecovery/incident-20260820/anomalous-20260820-232208`

| 文件 | 大小 | SHA256 |
|---|---:|---|
| `workstation-anomalous-consistent.db` | 2,187,264 bytes | `a21c191b9b8b4927d6e3be1a4174ba92a906b04efbb05d8e5bbe406a666654f1` |
| `workstation.db.raw` | 2,187,264 bytes | `f0d438a70c97a24911a6e2de377f7263376454a9e6fda9e8e9bb1fdd75b12944` |
| `diff-analysis.json` | 见封存目录 | `d1f67cb4ac97f42f1127c83a14a2ae8101eb70ba38922d0584e6068e9907b1a2` |

封存时不存在 `-wal` 和 `-shm` 文件。封存副本 `integrity_check=ok`，`foreign_key_check` 无错误。

## 5. 21:44 后差异分析

| 数据对象 | 完整备份 | 当前小库 | 新增/变化 | 判断 | 是否需要合并 |
|---|---:|---:|---|---|---|
| ERP SKU | 6,906 | 2 | `suite-erp-a/b` | 旺店通组合装测试夹具 | 否 |
| Sales Object | 8,099 | 1 | `FZH0103-11` | 旺店通组合装测试夹具 | 否 |
| Daily Facts | 11,548 | 0 | 无 | 事故后无真实销售事实 | 否 |
| Products | 2,958 | 0 | 无 | 无新增产品 | 否 |
| Links | 9,293 | 1 | `suite-link` | 测试夹具 | 否 |
| Tasks | 6,959 | 8 | `task-001` 至 `task-008` | 初始化种子 | 否 |
| Goals | 14 | 8 | 初始化目标 | 初始化种子 | 否 |
| 同步批次 | 完整历史 | 5 | 均为 `wangdian_suites`，集中在约 23:16 | 事故测试产生 | 否 |
| API 使用记录 | 旧库无该表 | 15 | 页面/健康探测记录 | 仅审计遥测，已封存 | 不合并 |

未发现 21:44 后需要合并回完整库的真实业务记录。禁止自动合并的原则保持不变。

## 6. 隔离恢复演练

恢复副本：`/private/tmp/wufan-recovery-001-2325/restored.db`

| 对象/指标 | 结果 |
|---|---:|
| ERP SKU | 6,906 |
| Sales Object | 8,099 |
| Bundle | 5,377 |
| Daily Facts | 11,548 |
| Products | 2,958 |
| Links | 9,293 |
| Active Product Mapping | 2,956 |
| Active Link SKU → Sales Object | 31,784 |
| Active Structures | 8,099 |
| Active Components | 14,348 |
| Inventory Facts | 12,305 |
| 销售额 | 1,327,063.9502 |
| 成本 | 574,096.4340 |
| 利润 | 624,038.6962 |

`integrity_check=ok`，`foreign_key_check` 无错误。恢复副本使用当前拟发布代码完成迁移预演和启动验证。

只读/API冒烟均为 HTTP 200：健康检查、认证会话、产品列表、产品详情、产品经营、组合装列表、链接列表、链接详情、管理员数据中心、Sales Object Resolver、旺店通组合装查询。

## 7. 危险场景验证

| 场景 | 预期 | 结果 |
|---|---|---|
| 生产环境 + reset | 拒绝 | 通过，`production_database_reset_blocked` |
| 生产环境缺少 DB 路径 | 拒绝启动 | 通过，`production_database_path_required` |
| 测试临时库 + reset | 允许 | 通过 |
| 测试错误指向生产库 | 拒绝 | 通过，`production_database_reset_blocked` |
| 核心数量断崖下降 | 拒绝启动/发布 | 通过，`database_baseline_failed` |

## 8. 自动验证

- `npm run check`：通过。
- `npm run test:v2-cleanup`：通过。
- `npm run test:product-business`：通过。
- `npm run test:platform-goods-assets`：通过。
- `git diff --check`：通过。

## 9. 正式恢复前置条件

1. 停止生产写入并确认没有发布/测试任务仍在运行。
2. 将本保护提交部署到生产代码，但不要先启动业务服务。
3. 确认 PM2 使用外置唯一数据库路径和生产基线文件。
4. 再次封存恢复前的当前异常库及 WAL/SHM。
5. 校验 21:44 完整备份 SHA256：`46050ed2626a00edc8b96b0630cf110b183cb18155f086885ebf12a06174ec30`。
6. 将完整备份恢复到外置生产路径，复核权限、SHA、完整性与业务基线。
7. 启动服务，要求 technical health 与 business data health 同时通过。
8. 完成页面和关键指标冒烟后才恢复正常访问。

## 10. 最终判断

保护机制已经通过代码与隔离环境验收，但尚未部署到生产，因此：

> **现在不可直接执行生产数据库正式恢复。**

下一步应进入受控恢复窗口，严格按“先停写与部署保护代码，再恢复外置数据库，最后启动验证”的顺序执行。
