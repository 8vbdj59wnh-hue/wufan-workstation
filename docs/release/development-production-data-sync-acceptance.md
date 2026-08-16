# 《开发环境生产数据同步验收报告》

## 1. 执行结论

- 执行日期：2026-08-15（Asia/Shanghai）
- 执行范围：生产数据库只读快照同步至开发数据库
- 执行结果：通过
- 生产原数据库：未修改
- 开发服务：恢复后运行正常

## 2. 开发数据库保护备份

| 项目 | 结果 |
|---|---|
| 原开发数据库 | `/tmp/v2-development-workstation.db` |
| 备份文件 | `/Users/mac/Documents/极简工作站开发/v2-release-001-integration/backups/dev-data-sync-20260815/development-before-sync.db` |
| 文件大小 | 2,183,168 bytes |
| SHA256 | `e167cefb1eb4ed405683a19d78a011e6e336bf03556f075d234fc5ed7fbd2173` |

## 3. 生产数据库快照

| 项目 | 结果 |
|---|---|
| 生产原数据库 | `/Users/meiyounaichatouyuna/Projects/goal-execution-system/data/workstation.db` |
| 生产侧在线快照 | `/Users/meiyounaichatouyuna/Projects/goal-execution-system/backups/dev-data-sync-20260815-production.db` |
| 开发机接收文件 | `/Users/mac/Documents/极简工作站开发/v2-release-001-integration/backups/dev-data-sync-20260815/production-source.retry.db` |
| 文件大小 | 594,087,936 bytes |
| SHA256 | `79c3a8486c2ce455367a64921c6a674a4c4a633742bbd4c51aa3d55963243aae` |
| 传输校验 | 生产侧与开发侧 SHA256 完全一致 |

生产快照使用 SQLite 在线备份生成，未对生产业务数据执行新增、更新或删除。首次网络传输未完成，校验不一致，因此未用于恢复；重新完整传输并通过 SHA256 校验后才执行恢复。

## 4. 恢复结果

| 项目 | 结果 |
|---|---|
| 开发数据库目标 | `/tmp/v2-development-workstation.db` |
| 恢复后大小 | 594,087,936 bytes |
| 恢复后 SHA256 | `79c3a8486c2ce455367a64921c6a674a4c4a633742bbd4c51aa3d55963243aae` |
| 一致性 | 与生产快照完全一致 |

恢复前已停止开发 API 与前端服务，并移走可能存在的 SQLite WAL/SHM 旁文件；数据库替换完成后再重新启动服务，避免活动连接或旧 WAL 污染恢复结果。

## 5. 数据库与业务数据验证

### 数据库检查

| 检查项 | 结果 |
|---|---|
| `PRAGMA integrity_check` | `ok` |
| `PRAGMA foreign_key_check` | 0 条异常 |

### Business-001 基线

| 数据资产 | 数量/金额 |
|---|---:|
| 销售日报事实 `connection_sku_sales_daily_facts` | 11,548 |
| Product Structure（全部） | 10,949 |
| Product Structure（active） | 10,946 |
| Link SKU → ERP SKU mapping（全部） | 43,316 |
| active mapping | 43,316 |
| 产品 `products` | 2,958 |
| 链接 `sales_links` | 9,162 |
| 链接 SKU `sales_link_skus` | 33,073 |
| 日报销售额 | 1,327,063.9502 |
| 日报利润 | 624,038.6962 |

日报事实、Product Structure、mapping、产品和链接数据均已确认存在。

## 6. 开发服务验证

| 服务 | 地址 | 结果 |
|---|---|---|
| 前端 | `http://127.0.0.1:5174/` | HTTP 200 |
| API | `http://127.0.0.1:3001/api/health` | HTTP 200，`status=ok`，`database=ok` |

开发环境当前可用于真实数据开发和测试。

## 7. 回滚方案

如需恢复同步前的开发状态：

1. 停止开发前端与 API 服务；
2. 将当前开发数据库移出运行路径留档；
3. 使用 `development-before-sync.db` 恢复 `/tmp/v2-development-workstation.db`；
4. 清理或移走恢复前遗留的 WAL/SHM 旁文件；
5. 重新执行 `integrity_check` 和 `foreign_key_check`；
6. 重启开发服务并检查前端与 API 健康状态。

回滚基准文件及 SHA256 已记录，可验证恢复文件未被改变。
