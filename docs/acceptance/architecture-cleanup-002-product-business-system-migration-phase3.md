# Architecture Cleanup-002 产品经营体系迁移与旧逻辑退役 Phase 3 验收报告

## 一、结论

本阶段迁移已完成并通过隔离数据、自动测试和浏览器回归验证。

产品经营正式读取链已统一为：

```text
销售：connection_sku_sales_daily_facts
关系：Sales Object / Sales Object Structure
库存：erp_sku_inventory_daily_summaries
```

产品中心不再依赖 `erp_fact_snapshots`、`product_daily_snapshots` 或 `product_erp_daily_snapshots` 生成产品详情、经营体检、趋势、生命周期/滞销判断和资金占用。旧 Schema 与历史读取能力仍保留，本阶段未删除数据库资产。

## 二、完成范围

### 1. 产品详情与产品经营体检

- `productManagementV2Service` 的产品详情、经营分析、健康评价和旧概览兼容返回统一适配 `ProductBusinessReadModel`。
- 产品经营健康状态由销售、库存、利润、链接覆盖和生命周期维度实时派生。
- 健康评价写入只保存评价记录，不生成旧经营快照。
- 产品经营分类逻辑拆为独立纯函数，避免读取层和管理层循环依赖。

### 2. AI 产品证据

- AI 产品分析证据改为销售日报、Sales Object 与库存事实。
- 利润口径明确为销售日报毛利润；无财务净利润事实时不再以旧快照值代替。
- 产品可见范围和财务成本权限继续保持。

### 3. 趋势、生命周期/滞销与资金占用

- 产品趋势由销售日报按产品聚合。
- 滞销观察由销售日期覆盖、最近销售日期和当前库存事实计算；数据覆盖不足时明确标记为观察口径，不伪造长期历史。
- 资金占用来自每个 ERP SKU 最新库存事实中的库存成本金额；缺失成本不估算。
- 生命周期仍为人工主数据；系统分析只生成经营判断，不静默改写生命周期。

### 4. 经营数据中心旧入口与 API 收口

- `#dataCenter/trends`、滞销、资金占用和产品详情旧入口保留 URL 兼容，但只展示迁移说明并引导至产品中心。
- `#dataCenter/sync` 管理员同步能力继续保留。
- 原数据中心产品 API 保留兼容响应，内部改读新经营链，并返回迁移目标。
- 旧 ERP 经营快照生成 API 返回 `410 legacy_snapshot_retired`，不再生成旧快照。
- ERP 同步完成后停止自动触发旧快照生成。

### 5. 驾驶舱兼容

- 经营驾驶舱产品指标、产品排行与趋势改读新经营链。
- 修复销售经营驾驶舱对已退役 `erpUsagePending` 字段的旧依赖，改为展示当前 `identityErrors`、`relationPending` 和 `conflicts`。
- 驾驶舱文案不再把产品经营数据描述为正式快照。

## 三、主要修改文件

- `server/productBusinessClassification.js`
- `server/productBusinessReadModel.js`
- `server/productManagementV2Service.js`
- `server/dataCenterService.js`
- `server/operationManagementService.js`
- `server/aiOperationAssistantService.js`
- `server/productV2Import.js`
- `server/index.js`
- `src/productCenterPage.js`
- `src/dataCenterPage.js`
- `src/operationDashboardPage.js`
- `src/uiModules/salesBusinessDashboard.js`
- `src/appState.js`
- `src/services/productCenterService.js`
- `tests/productBusinessMigration.test.js`

工作区同时包含此前 Architecture Cleanup 阶段的未提交修改；本阶段没有提交，也没有整理或覆盖其他任务变更。

## 四、隔离数据验证

使用生产数据副本 `/tmp/architecture-cleanup-002-phase3.db` 执行只读经营查询及健康评价写入演练。

| 项目 | 结果 |
|---|---:|
| 产品经营列表 | 2,958 个产品 |
| 趋势分析 | 2,958 个产品可查询 |
| 滞销观察 | 1,841 个候选；当前库存事实覆盖 10 天，明确为观察口径 |
| 资金占用 | 2,958 个产品；已映射库存金额 ¥1,903,862.8281 |
| 销售日报事实变化 | 0 |
| 旧经营快照变化 | 0 |
| 健康评价演练 | 仅隔离库新增 1 条，事务和来源标识正常 |

开发数据库基线复核：

| 数据 | 结果 |
|---|---:|
| 日报事实 | 11,548 |
| 销售额 | ¥1,327,063.9502 |
| 利润 | ¥624,038.6962 |
| Sales Object | 6,365 |
| 三类旧经营快照合计 | 0 |

## 五、浏览器回归

- 产品中心：正常打开，显示 2,958 个产品；销售周期、销售额、销量、库存、毛利润、健康状态均可读取。
- 链接中心：正常打开，链接经营驾驶舱和产品贡献正常。
- 驾驶舱：正常打开；销售趋势、产品排行、链接排行和数据质量正常，未再出现旧字段报错。
- 旧经营数据中心入口：正常显示迁移说明，可进入产品中心或管理员数据中心。
- AI 产品证据：服务级验证通过，数据源标识为销售日报、Sales Object 和库存事实。

## 六、自动验证

- `npm run check`：通过。
- `npm run test:product-business`：6/6 通过。
- `npm run test:v2-cleanup`：6/6 通过。
- `git diff --check`：通过。
- `PRAGMA integrity_check`：`ok`。
- `PRAGMA foreign_key_check`：无异常。

## 七、数据保护

- 未修改销售日报事实。
- 未修改 Sales Object 关系。
- 未修改库存事实。
- 未删除数据库 Schema。
- 未恢复或新建旧经营快照。
- 未提交、未发布。

## 八、保留兼容项与后续建议

1. 旧经营快照表、历史归档读取和 ERP 同步历史详情仍保留，便于历史追溯；它们不再参与产品经营正式读取。
2. 供应链模块仍有独立的旧库存快照语义，属于后续供应链收口范围，不影响本阶段产品中心单轨结果。
3. 建议下一阶段在确认观察窗口稳定后，再评估旧经营快照 API 和历史表的归档/退役，不应在本阶段直接删除。

## 九、验收判断

**通过。** 产品经营体系已完成向产品中心迁移，正式读取统一到 daily facts + Sales Object + 库存事实；产品中心、链接中心、驾驶舱、AI证据和旧入口兼容均满足本阶段要求。
