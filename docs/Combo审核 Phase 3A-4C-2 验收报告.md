# 《Combo审核 Phase 3A-4C-2 验收报告》

## 一、结论

Combo Group 整组人工确认已完成开发并通过隔离数据库验证。系统只允许确认 `pending` Group；重复请求已确认且映射完全一致的 Group 时返回幂等结果。确认过程使用单一 SQLite 事务，任何组件、候选或状态写入失败都会整体回滚。

## 二、确认前校验

- 当前用户必须具备现有 `links.manage` 权限，服务端接口强制校验；
- Group 必须存在且为 `pending`；
- 至少两个组件处于 `included`；
- included ERP SKU 必须有效；
- 所有 included 组件必须为人工确认的正数 quantity，且 `quantitySource=manual_confirmation`；
- 来源候选必须仍为 `pending combo`；
- 平台 SKU 不得存在 active single mapping；
- 平台 SKU 不得存在其他 active combo mapping 或其他 approved Combo Group；
- 不静默覆盖或恢复相同组件的历史 mapping。

## 三、事务写入

一次确认事务内完成：

1. 为每个 included 组件写入 active V2 combo mapping；
2. included 来源候选更新为 `approved` 并关联对应 mapping；
3. excluded 来源候选更新为 `rejected`；
4. Group 更新为 `approved`，记录审核人、审核时间、批准时间和审核备注；
5. 原销售日报预览标记 `relationRecalculationRequired=true`。

正式 mapping 字段符合要求：

- `mappingType=combo`
- `quantity=component.quantity`
- `comboGroupId=group.id`
- `sourceType=sales_relation_confirmation`
- `currentState=active`
- `sourceBatchId` 保留来源批次

## 四、隔离验证

| 场景 | 结果 |
| --- | --- |
| 正常整组确认 | 通过，3个 included 组件生成3条 mapping |
| 排除组件候选治理 | 通过，1条 excluded 候选更新为 rejected |
| 重复确认 | 通过，返回 idempotent，未重复写入 |
| quantity 未人工确认 | 阻断 |
| active single 冲突 | 阻断 |
| 已有 active combo 冲突 | 阻断 |
| 事务中途强制失败 | 全部回滚，Group和候选保持 pending |
| 审计字段 | 审核人、审核时间、批准时间、备注、mappingId完整 |
| 预览重算标记 | 已写入原批次摘要 |

## 五、数据保护

- `connection_sku_sales_daily_facts`：仍为 0；
- `connection_sku_sales_facts`：仍为 505；
- ERP仓库库存事实和库存日报汇总哈希不变；
- `sales_link_skus.erpSkuId/productId` 哈希不变；
- 未修改产品、链接、平台SKU或库存；
- 未自动推导任何 quantity。

## 六、完整性与工程检查

- SQLite `integrity_check=ok`；
- SQLite `foreign_key_check` 0 条异常；
- `npm run check`：通过；
- `git diff --check`：通过。

## 七、主要修改文件

- `server/salesComboReviewService.js`
- `server/index.js`
- `src/appState.js`
- `src/services/connectionCenterService.js`
- `src/connectionCenterPage.js`
- `scripts/verify-combo-group-confirmation.js`

## 八、范围确认

本阶段只创建经人工确认的正式 V2 combo mapping，并标记预览需要重算；没有执行预览重算，没有写入日报事实，没有修改库存或旧兼容关系字段。
