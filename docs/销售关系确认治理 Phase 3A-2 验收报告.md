# 销售关系确认治理 Phase 3A-2 验收报告

## 1. 验收结论

Phase 3A-2 已在隔离数据库完成开发与验证。系统只允许人工确认 `candidateType=single` 且仍为 `pending` 的候选；确认后仅新增 `sales_link_sku_erp_mappings` 正式关系、更新候选审核状态，并为来源销售日报预览写入“需要重新计算”标记。

本阶段未确认组合候选，未写入销售日报事实，未修改 `sales_link_skus.erpSkuId`、`sales_link_skus.productId` 或其他业务数据，未发布生产。

## 2. 实现范围

- 单条 single 候选确认。
- 最多 500 条 single 候选批量确认。
- 候选证据查看及人工二次确认交互。
- 服务端权限校验：`links.manage` 或 `products.edit`。
- 服务端事务内重新校验候选状态、平台 SKU、ERP SKU 与 active 映射。
- 正式关系写入：
  - `mappingType=single`
  - `quantity=1`
  - `sourceType=sales_relation_confirmation`
  - `currentState=active`
- 候选审核审计：`reviewedBy`、`reviewedAt`、`decisionNote`、`mappingId`；候选原记录继续保存 `sourceBatchId`、`sourceFileHash`、来源行号与证据。
- 来源预览标记：`relationRecalculationRequired=true`，并记录最近确认时间与确认操作次数。

## 3. 确认与冲突规则

1. 组合候选无确认按钮，接口也拒绝 combo。
2. 候选不存在或不是 pending 时拒绝处理。
3. 平台 SKU 或 ERP SKU不存在时，候选转为 `conflict`，不创建映射。
4. exact active 关系已存在时，候选转为 `conflict` 并记录已有 mappingId。
5. 平台 SKU 已有其他 active 关系时，不擅自改变为 single，候选转为 `conflict`。
6. exact inactive 历史关系存在时，不自动恢复、不覆盖，候选转为 `conflict`。
7. 已成功确认的候选再次提交时返回幂等结果，不重复写入。
8. 批量操作在单一数据库事务中完成；单行冲突不产生正式关系。

## 4. API与页面

- `POST /api/connection-data-foundation/sales-relation-candidates/:id/confirm`
- `POST /api/connection-data-foundation/sales-relation-candidates/confirm-batch`

页面在“链接经营中心 → 数据导入/销售日报 → 待确认销售关系”提供：

- single pending 候选勾选；
- 单条确认；
- 批量确认；
- 证据明细；
- combo 只读提示；
- 关系确认后的预览重算标记提示。

## 5. 隔离验证环境

- 代码基线：`cfb2393ad0538dea099837fde441f80245641066`
- 生产在线备份副本：`/private/tmp/wufan-sales-daily-preview-source.db`
- 备份大小：383,500,288 bytes
- 备份 SHA-256：`f62eb61fd188152c3ae9431ee748870caaf9116f6c35875a26853396f7b6f57c`
- 真实文件：`7.9-8.9链接利润报表（SKU明细）.xlsx`
- 文件 SHA-256：`7abd4a0967b13e9299fd8605688c4d197ae3ecb15ca8e292ef67d27b7c92c281`
- 实际写入验证数据库：系统临时目录中的独立副本；生产数据库未连接、未修改。

## 6. 验证结果

| 场景 | 结果 |
|---|---|
| 单条确认 | 新建 1 条 single active 映射，候选转 approved |
| 批量确认 | 一次事务新建 2 条映射，0 冲突 |
| 重复点击 | 1 次幂等返回，映射数量不增加 |
| 已存在关系冲突 | 1 条候选转 conflict，未重复创建映射 |
| combo确认 | 服务端拒绝，未创建映射 |
| 无权限用户 | 权限计算为 false；两个写接口均绑定 `requireLinkManage`，返回 403 边界保持一致 |
| 审计 | reviewer、reviewedAt、candidateId、mappingId、sourceBatchId、sourceFileHash均可追溯 |
| 预览重算 | `relationRecalculationRequired=true`，单条与批量各记录一次确认操作 |
| 旧字段 | 所有测试候选对应的 `sales_link_skus.erpSkuId/productId` 逐行一致 |
| 日报事实 | 0 → 0 |
| 旧周期销售事实 | 505 → 505 |
| 链接 | 9051 → 9051 |
| 平台 SKU | 33073 → 33073 |
| ERP SKU | 6902 → 6902 |
| products | 1663 → 1663 |

验证中的映射数量由 20819 增至 20823，其中 3 条为人工确认结果，1 条为隔离环境中主动构造的并发冲突夹具；该夹具仅用于证明已有 active 关系不会被重复创建。

## 7. 完整性与工程检查

- `npm run check`：通过。
- `git diff --check`：通过。
- SQLite `integrity_check`：`ok`。
- SQLite `foreign_key_check`：0 条异常。

## 8. 数据保护与边界

- 未写入 `connection_sku_sales_daily_facts`。
- 未修改 `connection_sku_sales_facts`。
- 未修改链接、平台 SKU、ERP SKU、products。
- 未修改旧关系字段。
- 未自动创建关系；只有带权限用户明确点击确认后才写正式关系。
- 未提供 combo 确认能力。
- 本阶段只标记日报预览需要重新计算，不执行自动重算或日报提交。
- 未提交 Git，未发布生产。
