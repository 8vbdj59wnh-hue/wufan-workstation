# Architecture Upgrade-003 自动 Projection Phase 7 生产验收报告

## 1. 执行结论

2026-08-21 在生产环境正式启用 V3 Sales Object 自动 Projection。当前开关为：

| 开关 | 状态 |
|---|---|
| V3 Shadow | ON |
| V3 Auto Projection | ON |
| V3 Relation Write | OFF |
| V3 Relation Read | OFF |

生产运行代码提交为 `b5c403201bfebf0401876c2033974ab3bacd792c`，提交链包含：

- `7ce12b5c09dd6854a1cfa484bc681fb93d470086`：安全启用 Projection + Shadow，分批短事务和内容哈希保护。
- `310c73e619adda38c2324ecc99f3d89fb8484325`：Bundle 权威迁移的版本保护。
- `e9e3fdfa4c87f4ddf0cf474c8182eeffc82f44cb`：缓存 Suite 结果继续提供 BOM 投影来源。
- `b5c403201bfebf0401876c2033974ab3bacd792c`：遵守 Active Component 不可变约束，内容未变时只迁移 Structure 权威语义。

## 2. 恢复点与启用前基线

生产数据库路径：

`/Users/meiyounaichatouyuna/WufanWorkstationData/production/workstation.db`

启用前备份：

`/Users/meiyounaichatouyuna/WufanWorkstationRecovery/v3-phase7-20260821/workstation-before-projection.db`

| 项目 | 启用前 |
|---|---:|
| 备份大小 | 892 MB |
| 备份 SHA256 | `db067feda0cf003720ef79b4431b87e55ae088f0650b8faeea8d58d214e266cb` |
| Sales Object | 8,099 |
| Single Sales Object | 2,722 |
| Bundle Sales Object | 5,377 |
| Active Structure | 8,099 |
| Structure Component | 14,348 |
| Link SKU Relation | 31,784 |
| Product Structure | 10,949 |
| Legacy Mapping | 43,316 |
| Daily Facts | 14,927 |
| 销售额 | 1,714,533.2059 |
| 成本 | 755,806.6715 |
| 利润 | 814,440.1357 |

启用前 `integrity_check=ok`，`foreign_key_check=0`。

## 3. 首次 Projection 结果

当前 Operating ERP Set 为 2,812；Projection 同时处理当前经营 Single 与 Bundle 销售对象。

| 指标 | 结果 |
|---|---:|
| Candidate | 6,396 |
| Confirmed | 6,342 |
| Single | 2,691 |
| Bundle | 3,651 |
| Sales Object 新增 | 19 |
| Sales Object 权威来源更新 | 5,982 |
| Structure 新增 | 19 |
| Single Structure 权威更新 | 2,672 |
| Component 新增 | 19 |
| Relation 新增 | 0 |
| Relation 待下阶段写入 | 795（最终 Shadow 口径） |
| Relation Conflict | 1 |

`HP1025-1` 与 `HP1055-1` 均已存在且被确认为 `single / wangdian_goods_api / active`。

实时旺店通复核后，341 个当前经营 Bundle 将 Structure 权威来源收口为 `wangdian_suite_api`。BOM 内容未变，因此不伪造新版本，不修改不可变 Component 行。仍有 1 个历史 Excel Bundle 属于已知 source conflict，保留诊断。

## 4. 幂等验证

权威迁移后再次由 PM2 服务重启自动触发：

| 指标 | 第二次 |
|---|---:|
| Sales Object created | 0 |
| Sales Object updated | 0 |
| Structure created | 0 |
| Structure updated | 0 |
| Structure superseded | 0 |
| Component created | 0 |
| Projection 写批次 | 0 |
| Projection 最长写事务 | 0 ms |

重复运行没有制造新对象、新结构版本或重复组件。

## 5. Shadow 结果

最终成功 Run：`v3-shadow-run-05c735b9c26e6b7f544945d4`。

| 指标 | 数量 |
|---|---:|
| evaluated | 32,177 |
| same | 30,318 |
| v3_more_complete | 795 |
| current_more_complete | 0 |
| relation_conflict | 1 |
| type_conflict | 3 |
| source_conflict | 1 |
| missing_erp_code | 89 |
| erp_not_found | 52 |
| shadow_error | 0 |

按 Phase 6B/6C 已确认的正常可解释口径：

`30,318 same + 795 V3可补齐 = 31,113 / 31,113 = 100%`。

## 6. 数据保护

| 保护资产 | 启用前 | 启用后 | 内容校验 |
|---|---:|---:|---|
| Link SKU Relation | 31,784 | 31,784 | SHA256 `8dbd362b69fe433596847b384975133527168604efae26bf7627102182bc4221` 不变 |
| Daily Facts | 14,927 | 14,927 | SHA256 `7f67fd522a8066cdba3bf7bd18f0b2f983333812fa49e965c04c315329540d76` 不变 |
| Legacy Mapping | 43,316 | 43,316 | SHA256 `08375975b715a11c3d0371eb0c72b041c625caf63c1330ccc36f1d12f16a36c3` 不变 |
| Product Structure | 10,949 | 10,949 | SHA256 `9c5d5b6fe84b8980ec18d84893bbf26a95df3793382afaff98632a51e766e3b7` 不变 |
| Manual Binding | 0 | 0 | 无新增 |
| Combo | 0 | 0 | 无新增 |
| Products | 2,958 | 2,958 | 不变 |
| Links | 10,006 | 10,006 | 不变 |
| ERP SKU | 6,906 | 6,906 | 不变 |
| 销售额 | 1,714,533.2059 | 1,714,533.2059 | 不变 |
| 成本 | 755,806.6715 | 755,806.6715 | 不变 |
| 利润 | 814,440.1357 | 814,440.1357 | 不变 |

启用后 Sales Object 为 8,118，Structure 为 8,118，Component 为 14,367。

## 7. 完整性、性能与安全

- `integrity_check=ok`。
- `foreign_key_check=0`。
- Technical Health = `ok`。
- Business Data Health = `ok`。
- 最终健康接口响应约 2.4 ms。
- 最终 Projection 重跑的写批次为 0，最长写事务为 0 ms。
- 权威迁移运行的最长批事务为 97.303 ms，未出现 `SQLITE_BUSY`。
- `npm run check` 在生产 Node 22 环境完整通过，数据库测试使用独立临时库。
- Production Recovery 路径锁定、reset 阻断和业务基线保护均通过。
- PM2 开关已 `pm2 save`，重启后仍保持 Projection/Shadow ON、Relation Write/Read OFF。

执行过程曾发现两个被安全阻断的 Schema 语义问题：Active Component 不可变和相同 Structure Hash 不可重复建版。两者均按现有约束修复，最终连续两次自动 Run 成功，无正式关系或销售事实副作用。

## 8. 必答问题

1. **生产实际新增多少 Sales Object？** 19。
2. **新增/更新多少 Structure？** 新增 19；2,672 个 Single Structure 完成权威来源更新，341 个当前经营 Bundle Structure 完成旺店通权威迁移。
3. **Projection 覆盖率是多少？** 正常可解释关系 31,113/31,113，100%。
4. **第二次运行是否完全幂等？** 是，对象、结构、组件和 Projection 写事务均为 0。
5. **正式 Relation 是否完全未变？** 是，数量和内容哈希均不变。
6. **Daily Facts 和经营金额是否完全未变？** 是。
7. **Legacy 是否保持零新增？** 是。
8. **Shadow 一致率是否保持 100%？** 正常可解释口径为 100%，Current 独有为 0。
9. **是否出现 SQLite 锁问题？** 最终成功运行无 `SQLITE_BUSY`，最终幂等跑 Projection 写事务为 0 ms。
10. **是否具备开启 Relation Write 条件？** 尚不宣布具备。技术指标已通过，但 Projection ON 后的观察期还需要覆盖一次新的完整平台货品更新和一次正常利润表导入；本次已覆盖服务重启、旺店通 Goods/Suite 实时复核与正常用户访问。

## 9. 最终结论

**继续Projection观察**

保持当前开关不变，在生产真实平台货品更新和利润表导入各覆盖一次后，再根据 Shadow 与数据保护结果决定是否开启 Relation Write。
