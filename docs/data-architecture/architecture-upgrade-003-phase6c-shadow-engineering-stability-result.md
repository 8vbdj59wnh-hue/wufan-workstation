# Architecture Upgrade-003 Phase 6C Shadow工程稳定性收口验收报告

## 1. 最终结论

Phase 6C仅处理了两个工程阻断，没有修改V3商品关系规则。

- `npm run check`已完整通过；
- Phase 1–6专项测试全部通过；
- 生产同规模Shadow由70.3秒降至19.3秒；
- 生产Shadow最长写事务由约13秒级阻塞收敛至1.389毫秒；
- 正常可解释关系仍为31,113条，V3覆盖100%；
- `current_more_complete = 0`；
- `shadow_error = 0`；
- 正式业务数据及金额无变化；
- Legacy新增为0；
- Production Recovery数据库保护继续有效。

最终结论：

> **可以开启自动Projection**

本阶段没有实际开启自动Projection、Relation Write或Relation Read。

## 2. 版本与提交边界

| 项目 | 结果 |
|---|---|
| Phase 6C代码提交 | `11b755ebbd1c4c22d9b03e1e6962750b7e903c8f` |
| 提交说明 | `fix: stabilize v3 shadow engineering` |
| 父提交 | `9431ac1423f128b30866aeae17d34aa32fd40182` |
| 生产代码版本 | `11b755ebbd1c4c22d9b03e1e6962750b7e903c8f` |
| V3 Auto Projection | `shadow` |
| V3 Auto Relation Write | `off` |
| V3 Relation Read | `off` |

提交只包含：

- Operating ERP Set短事务物化；
- ERP身份Shadow短事务物化；
- Shadow差异去重与短事务写入；
- 目标中心隔离测试启动顺序修复；
- 对应专项测试。

未提交、未混入其他工作区报告和业务任务。

## 3. 13秒SQLite锁根因

### 3.1 原执行链

`服务重启/数据变化触发Shadow`

→ 读取正式资产保护快照

→ 计算最新Operating ERP Set

→ 开启一个`IMMEDIATE`大事务

→ 将全部active证据先统一更新为inactive

→ 逐条upsert全部Operating成员

→ 逐条upsert全部来源证据

→ 对全部成员执行相关子查询更新sourceCount

→ 提交事务

→ 旺店通Goods/Suite查询

→ 计算身份结果

→ 再开启一个`IMMEDIATE`大事务

→ 删除全部身份观察和比较记录

→ 重建全部身份观察和比较记录

→ 提交事务

→ 计算Current/V3差异

→ 在一个事务内upsert全部差异、更新run摘要和清理历史记录

### 3.2 持锁资产与规模

主要持锁表：

- `operating_erp_set_members`
- `operating_erp_set_evidence`
- `operating_erp_identity_observations`
- `operating_erp_identity_shadow_comparisons`
- `v3_relation_shadow_differences`
- `v3_relation_shadow_runs`

生产规模快照的完整首次物化包含：

| 诊断资产 | 记录数 |
|---|---:|
| Operating成员 | 10,401 |
| Operating来源证据 | 39,997 |
| 身份观察 | 6,307 |
| 身份比较 | 6,307 |
| 当前稳定差异 | 1,913 |

根因不是旺店通API持有事务。API请求发生在Operating Set物化完成之后，未位于数据库事务中。

根因是：诊断物化把全量失活、全量upsert、全量重建和差异写入分别放进长时间`IMMEDIATE`事务，并且稳定无变化记录也被重复UPDATE。任务波次等正式写任务与Shadow并发时因此收到`SQLITE_BUSY`。

## 4. 事务与写入优化

优化后的链路：

`读取正式数据`

→ 在内存计算Operating Set

→ 读取现有诊断投影并比较

→ 只形成新增、变化和失活集合

→ 每250条以内用短事务写入

→ 事务外执行旺店通查询

→ 在内存计算身份和Shadow比较

→ 仅对身份变化、新差异、状态变化进行短事务写入

→ 稳定same与稳定异常只进入run摘要，不重复写明细

具体调整：

1. 删除“全部证据先inactive再全部active”的写法，只失活本轮确实消失的证据；
2. Operating成员和证据先内存比较，无变化不进入写事务；
3. 身份Shadow不再整表DELETE后重建，改为差异upsert与过期行删除；
4. Shadow差异不再每轮刷新全部稳定记录；
5. 1,913条稳定差异本轮全部跳过写入，仅由run摘要计数；
6. 写入采用最多250条的小批次事务；
7. 每个阶段记录`batchCount`、`longestTransactionMs`和实际变化数量；
8. Flag关闭后不再接收新Shadow任务；已经开始的小批次完成后退出，不留下长事务。

## 5. 锁等待与性能验收

### 5.1 隔离库最坏情况

使用生产只读快照生成的独立数据库，清空全部V3诊断投影后执行完整首次物化，并用独立写线程每5毫秒竞争一次写锁。

| 指标 | 结果 |
|---|---:|
| 完整首次物化总耗时 | 2,829.0 ms |
| 稳定重复物化耗时 | 453.0 ms |
| 首次最长单个写事务 | 75.079 ms |
| 稳定重复写事务数 | 0 |
| 稳定重复最长写事务 | 0 ms |
| 人工高频竞争写探针最长等待 | 150.380 ms |
| 13秒级阻塞 | 0 |

### 5.2 生产Shadow复核

生产Run：`v3-shadow-run-db5147e2ca00e6f3dfb27b93`

| 指标 | Phase 6B | Phase 6C | 变化 |
|---|---:|---:|---:|
| Shadow总耗时 | 70,295 ms | 19,333 ms | 减少50,962 ms，下降72.50% |
| Operating写批次 | 未记录 | 0 | 稳定数据零写入 |
| Operating最长写事务 | 约13秒级阻断链 | 0 ms | 消除 |
| 身份写批次 | 全量重建 | 1 | 仅1条变化 |
| 身份最长写事务 | 长事务 | 1.389 ms | 收敛 |
| 差异写批次 | 全量刷新 | 0 | 1,913条稳定差异跳过 |
| 新增`SQLITE_BUSY`日志 | 有 | 0 | 通过 |
| `/api/health`响应 | — | 2.442 ms | 正常 |

生产错误日志最后更新时间仍为2026-08-21 01:41:21，早于本次05:38 Shadow；因此本轮没有新增SQLite锁错误。

## 6. `npm run check`失败根因与修复

### 6.1 根因分类

根因属于B与C的组合，不是V3业务回归：

1. 目标中心隔离脚本使用ESM静态import，间接加载数据库模块后才设置`WUFAN_ENV`和`WUFAN_DB_PATH`，不符合Production Recovery“环境必须在模块导入前确定”的规则；
2. Codex受限沙箱禁止测试子服务绑定本机随机端口，表现为服务打印启动信息后提前退出；
3. 生产主机交互Shell默认Node 25，而当前`better-sqlite3`按生产Node 22编译，使用错误Node版本会产生ABI不匹配。生产服务本身始终运行Node 22，不受影响。

### 6.2 最小修复

- 在任何应用模块加载前设置：
  - `WUFAN_ENV=test`
  - 独立临时`WUFAN_DB_PATH`
  - `WUFAN_TEST_DATABASE_ROOT`
  - `WUFAN_ALLOW_DB_RESET=1`
- 将可能间接加载数据库的静态import改为环境设置后的动态import；
- 不修改目标中心业务逻辑、fixture语义或断言；
- 完整检查使用与生产一致的Node 22执行；
- 保留`production_database_reset_blocked`和外置生产路径强制保护。

## 7. 自动检查结果

| 检查 | 结果 |
|---|---|
| `npm run check`（本地干净提交） | 完整通过 |
| `npm run check`（生产主机Node 22） | 完整通过 |
| Operating ERP Set | 10/10通过 |
| ERP身份契约 | 11/11通过 |
| BOM版本权威 | 14/14通过 |
| Sales Object自动投影 | 19/19通过 |
| V3关系主链与Feature Flag | 37/37通过 |
| Shadow观察 | 3/3通过 |
| 旺店通身份缓存 | 3/3通过 |
| Legacy关系门禁 | 通过，风险0 |
| `git diff --check` | 通过 |

没有skip、删除测试、注释测试或降低断言。

## 8. V3业务结果稳定性

| 指标 | Phase 6B | Phase 6C | 结果 |
|---|---:|---:|---|
| evaluated | 32,177 | 32,177 | 一致 |
| same | 30,318 | 30,318 | 一致 |
| v3_more_complete | 795 | 795 | 一致 |
| 正常可解释关系 | 31,113 | 31,113 | 一致 |
| V3正常关系覆盖率 | 100% | 100% | 一致 |
| current_more_complete | 0 | 0 | 一致 |
| relation_conflict | 1 | 1 | 一致 |
| type_conflict | 3 | 3 | 一致 |
| source_conflict | 1 | 1 | 一致 |
| missing_erp_code | 89 | 89 | 一致 |
| erp_not_found | 52 | 52 | 一致 |
| shadow_error | 0 | 0 | 一致 |

未为提高覆盖率改变关系规则或猜测关系。

## 9. 正式资产保护

最新生产Shadow的`protectedBeforeJson = protectedAfterJson`。

| 正式资产 | Shadow后数量 |
|---|---:|
| ERP SKU | 6,906 |
| Sales Object | 8,099 |
| Sales Object Relation | 31,784 |
| Product | 2,958 |
| Link | 10,006 |
| Daily Facts | 14,927 |
| Legacy Mapping | 43,316 |
| Legacy Product Structure | 10,949 |
| Manual Binding | 0 |
| Combo运行表 | 0 |

| 经营指标 | Shadow前后值 |
|---|---:|
| Daily Facts | 14,927 |
| 销售额 | 1,714,533.2059 |
| 成本 | 755,806.6715 |
| 利润 | 814,440.1357 |

Shadow没有修改Daily Facts、销售额、成本或利润，Legacy新增为0。

## 10. Production Recovery保护复核

| 保护项 | 结果 |
|---|---|
| 生产环境 | `WUFAN_ENV=production` |
| 生产数据库路径 | 仓库外固定绝对路径 |
| Technical Health | OK |
| Business Data Health | OK |
| `integrity_check` | `ok` |
| `foreign_key_check` | 0条 |
| 生产缺DB路径拒绝启动测试 | 通过 |
| 生产reset阻断测试 | 通过 |
| 测试临时库reset测试 | 通过 |
| 业务数据断崖下降保护测试 | 通过 |

发布前备份：

`/Users/meiyounaichatouyuna/WufanWorkstationRecovery/v3-phase6c-20260821/workstation-before-11b755eb.db`

SHA256：

`e60544003ab3327afebf27eef996cc186ce40eb4139f1ffaa766d1419af37c4f`

## 11. 九个核心问题回答

1. 13秒SQLite锁根因：Operating Set全量失活/重写、身份Shadow整表删除重建、差异全量刷新分别位于长`IMMEDIATE`事务；API不在事务内。
2. 优化后最长锁等待：生产最长Shadow写事务1.389毫秒且无`SQLITE_BUSY`；隔离高频竞争最坏等待150.380毫秒。
3. Shadow总耗时：70.3秒降至19.3秒，减少50.96秒，下降72.50%。
4. `npm run check`失败根因：测试环境设置晚于模块导入，加上受限沙箱禁止本机端口；不是V3业务回归。生产Shell首次复核还发现Node 25与Node 22原生模块ABI不匹配，已改用生产一致的Node 22。
5. 是否完成最小修复：是，只调整诊断事务、无变化写入和测试隔离启动顺序。
6. `npm run check`是否完整通过：是，本地和生产主机Node 22均完整通过。
7. V3业务结果是否保持不变：是，31,113/31,113，覆盖率100%，Current独有0。
8. Production Recovery保护是否仍有效：是，全部安全测试和双层Health通过。
9. 是否具备开启自动Projection条件：是。

最终结论：**可以开启自动Projection**。
