# Architecture Upgrade-003 V3 Shadow生产观察报告

## 1. 发布结论

最终结论：**继续Shadow观察**。

V3 Shadow代码已部署，正式关系写入与读取切换保持关闭。首轮有效生产比较完成且未改变任何受保护业务资产，但当前生产平台货品基线仍是2026-08-05，尚未覆盖任务要求的一次最新完整平台货品导入、利润表导入、Goods同步和Suite同步，因此不具备开启自动Projection的条件。

## 2. 发布版本与提交边界

| 项目 | 结果 |
|---|---|
| Production Recovery保护基线 | `b6f1dcfb91ce869955878b134ebced2838146ee3` |
| V3 Phase 1–5及Shadow候选 | `7f4ef245fc25903dbff8d746010fb088bfa0972a` |
| Shadow批次选择热修复 | `2cfa3dc2fd33ad6d670176ca7708eec9a968a8d7` |
| 最终生产HEAD | `2cfa3dc2fd33ad6d670176ca7708eec9a968a8d7` |
| 生产分支 | `production/v3-shadow-phase6` |
| 工作区 | 干净 |
| 排除项 | `docs/release/production-recovery-002-report.md`未纳入提交；未混入其他业务任务 |

提交按Operating ERP Set、身份契约、BOM权威化、Sales Object投影、主链/Flag、Shadow观察和生产发现热修复分界整理，未使用`git add -A`。

## 3. 发布前验证

- `npm run check`：通过（独立临时数据库）。
- Phase 1专项测试：10/10通过。
- Phase 2专项测试：11/11通过。
- Phase 3专项测试：14/14通过。
- Phase 4专项测试：19/19通过。
- Phase 5专项测试：热修复后37/37通过。
- Phase 6 Shadow专项测试：3/3通过。
- `git diff --check`：通过。
- `integrity_check`：`ok`。
- `foreign_key_check`：无异常行。
- Production Recovery保护：生产绝对路径锁、reset阻断、业务基线断崖保护、双层Health均保留并通过。

## 4. Release A：全部Flag关闭

Release A先部署代码，状态如下：

| Flag | 状态 |
|---|---|
| `V3_AUTO_PROJECTION` | `off` |
| `V3_AUTO_RELATION_WRITE` | `off` |
| `V3_RELATION_READ` | `off` |

验证结果：服务在线，Technical Health与Business Data Health均为`ok`；Shadow运行数为0；正式数量及经营金额与发布前一致。生产数据库继续使用仓库外固定路径：

`/Users/meiyounaichatouyuna/WufanWorkstationData/production/workstation.db`

发布前备份：

`/Users/meiyounaichatouyuna/WufanWorkstationReleases/release-20260821-035042-v3-shadow-a/database/workstation-before-b6f1dcfb-20260821-035045.db`

备份完整性为`ok`，大小888,524,800字节，SHA256为`04ccb201fd5db9963fae509122ebf52705da892792f6d18050d983f826b48015`。

## 5. Release B：仅开启Shadow

最终生产状态：

| Flag | 状态 | 说明 |
|---|---|---|
| `V3_AUTO_PROJECTION` | `shadow` | 只计算与保存诊断摘要/差异 |
| `V3_AUTO_RELATION_WRITE` | `off` | 不写正式Link SKU关系 |
| `V3_RELATION_READ` | `off` | 正式读取链不切换 |

Shadow摘要和差异仅管理员可读；运行摘要保留90天，已解决差异保留180天；相同差异使用唯一键累计出现次数，不重复无限生成明细。

## 6. 生产发现与热修复

首次重启Shadow技术完成但`evaluated=0`。根因是生产恢复库存在一个日期更晚的历史`partial`平台货品批次，该批次有导入行，却没有把任何`Link SKU.lastSeenBatchId`物化为自己的批次号。V3按时间选中了不可比较批次。

热修复后，批次选择同时要求批次已经形成Link SKU批次覆盖；空的完整批次仍可合法表示零资产。修复仅涉及：

- `server/v3PlatformBatchService.js`
- `tests/v3RelationMainChainService.test.js`

热修复提交为`2cfa3dc2fd33ad6d670176ca7708eec9a968a8d7`，部署时先关闭Shadow，验收代码健康后再单独开启Shadow。

## 7. 首轮有效Shadow结果

有效观察时间：2026-08-21 04:11:31–04:27:00（Asia/Shanghai）。触发场景：服务重启。

| 指标 | 数量/结果 |
|---|---:|
| evaluated | 33,005 |
| same | 31,756 |
| 一致率 | 96.2157% |
| v3_more_complete | 18 |
| current_more_complete | 0 |
| relation_conflict | 0 |
| type_conflict（Link SKU影响数） | 3 |
| 类型冲突对象 | 1 |
| source_conflict（Link SKU影响数） | 1 |
| 来源冲突对象 | 1 |
| missing_erp_code（真实经营缺口） | 87 |
| erp_not_found | 51 |
| shadow_error | 0 |
| unresolved | 1,227 |
| 运行耗时 | 929,576.55ms（约15分30秒） |

`unresolved`中1,076条编码为空，其中989条系统货品类型为“无”，不属于商品关系治理；86条Single与1条Bundle构成87条真实缺ERP编码。另有151条带平台式编码的历史关系仍需在最新完整平台批次中重新确认。

本轮Operating ERP Set为10,600，而隔离验证为2,844。差异原因是生产恢复库当前最新可用、已物化的完整平台货品基线仍是2026-08-05；2026-08-19真实平台货品表尚未成为生产完整批次。

## 8. 已覆盖与未覆盖场景

| 场景 | 状态 | 说明 |
|---|---|---|
| 服务重启 | 已覆盖 | 有效比较完成 |
| 正常用户访问/登录页 | 部分覆盖 | 登录页可打开，健康接口正常；当前验收浏览器无生产登录会话 |
| 平台货品完整导入 | 未覆盖 | 必须等待下一次真实完整导入 |
| 平台货品重复导入 | 未覆盖 | 待真实场景 |
| 新Link / 新Link SKU | 未覆盖 | 待真实导入产生 |
| ERP编码变化 | 未覆盖 | 待真实导入产生 |
| 旺店通Goods更新 | 未覆盖 | 待下一次真实同步 |
| 旺店通Suite/BOM更新 | 未覆盖 | 待下一次真实同步 |
| 利润表导入 | 未覆盖 | 待下一次真实导入 |

由于关键真实数据流场景尚未覆盖，观察周期不能仅按已运行时长判定完成。

## 9. 性能与锁观察

- 首轮有效Shadow需实时复核394个未确认编码；每个编码同时查询Goods与Suite，受全局55次/分钟限速约束，运行约15分30秒。
- 运行中服务CPU约0.2%–0.9%，内存约145–179MB，采样峰值约209MB。
- Shadow完成后Health连续5次约1.15–1.75ms，服务持续在线。
- 04:20:27出现一次瞬时SQLite锁；随后带5秒等待的只读查询和Health立即恢复，生产错误日志没有新增`SQLITE_BUSY`。该事件尚未证明用户侧故障，但在开启自动Projection前必须通过后续导入场景确认或消除。
- 当前未确认编码会在后续Shadow中再次触发旺店通查询，建议在观察期内增加失败/不存在对象的刷新间隔，并将Shadow与正式同步共享调度的等待时间纳入监控。

## 10. 业务数据与Legacy保护

| 正式资产 | Shadow前 | Shadow后 | 变化 |
|---|---:|---:|---:|
| ERP SKU | 6,906 | 6,906 | 0 |
| Sales Object | 8,099 | 8,099 | 0 |
| Sales Object Structure | 8,099 | 8,099 | 0 |
| Structure Components | 14,348 | 14,348 | 0 |
| 正式Relation | 31,784 | 31,784 | 0 |
| Products | 2,958 | 2,958 | 0 |
| Links | 9,293 | 9,293 | 0 |
| Daily Facts | 11,548 | 11,548 | 0 |
| 销售额 | 1,327,063.9502 | 1,327,063.9502 | 0 |
| 成本 | 574,096.4340 | 574,096.4340 | 0 |
| 利润 | 624,038.6962 | 624,038.6962 | 0 |

| Legacy资产 | Shadow前 | Shadow后 | 新增 |
|---|---:|---:|---:|
| Legacy Mapping | 43,316 | 43,316 | 0 |
| Product Structure | 10,949 | 10,949 | 0 |
| Manual Binding | 0 | 0 | 0 |
| Combo Group | 0 | 0 | 0 |

数据库最终`integrity_check=ok`，`foreign_key_check`无异常行。

## 11. 下一步观察条件

1. 导入一次最新完整平台货品表，使生产Operating ERP Set从历史8月5日基线收敛到当前经营范围。
2. 覆盖一次重复平台货品导入，确认幂等且不会重复产生差异明细。
3. 覆盖一次真实利润表导入，确认Daily Facts和金额只由正式链写入。
4. 覆盖一次Goods同步与一次Suite/BOM同步。
5. 核对18条`v3_more_complete`、1个类型冲突、1个来源冲突和87条真实缺编码。
6. 验证真实导入期间无持续SQLite锁、无用户页面性能下降。
7. 为稳定`erp_not_found`/未确认对象增加合理刷新间隔，避免每次事件重复消耗约788个旺店通请求。
8. 观察期间继续保持Legacy新增为0，且销售额、成本、利润完全不变。

在以上条件完成前：不得开启`V3_AUTO_PROJECTION=on`，不得开启`V3_AUTO_RELATION_WRITE`，不得切换`V3_RELATION_READ`。
