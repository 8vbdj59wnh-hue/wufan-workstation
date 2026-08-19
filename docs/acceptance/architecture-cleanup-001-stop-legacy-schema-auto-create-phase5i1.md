# Architecture Cleanup-001 停止Legacy Schema自动创建 Phase 5I-1验收报告

## 1. 验收结论

本阶段通过。

新环境初始化不再自动创建以下Legacy关系运行表：

- `sales_link_sku_erp_mappings`
- `sales_link_sku_product_structures`
- `sales_link_sku_product_structure_components`
- `sales_link_sku_combo_groups`
- `sales_link_sku_combo_group_components`
- `platform_sku_manual_bindings`

现有数据库启动不会删除、清空或修改这些表的历史数据。本阶段没有执行任何 `DROP TABLE`，生产/当前业务数据库只执行了只读检查。

## 2. 修改范围

| 文件 | 修改 |
|---|---|
| `server/schema.sql` | 移除Combo Group、Combo组件、相关索引/Trigger及Manual Binding的默认建表定义；此前已移除Mapping与Legacy Product Structure默认建表 |
| `server/db.js` | 停止启动链自动调用 `migrateSalesLinkSkuComboGroupsV1()`；显式历史迁移函数继续保留 |
| `scripts/check-link-center-v2-cleanup.js` | 增加Legacy Schema Guard，扫描主Schema和启动迁移调用 |
| `tests/linkCenterV2Cleanup.test.js` | 增加静态Guard与空数据库六表不存在验证；修正Manual Binding测试口径 |
| `tests/resolveLinkSkuRelationRead.test.js` | 将Combo fixture口径从“空表”调整为“表不存在” |

未修改：

- Sales Object Schema和Resolver规则；
- 关系审批业务逻辑；
- Daily Facts和销售计算；
- 任何生产Legacy表或历史记录。

## 3. 新初始化结果

空数据库初始化后：

| Legacy表 | 是否存在 |
|---|---|
| `sales_link_sku_erp_mappings` | 否 |
| `sales_link_sku_product_structures` | 否 |
| `sales_link_sku_product_structure_components` | 否 |
| `sales_link_sku_combo_groups` | 否 |
| `sales_link_sku_combo_group_components` | 否 |
| `platform_sku_manual_bindings` | 否 |

空库同时满足：

- Sales Object正式表正常创建；
- 新关系审批可生成Sales Object关系与结构；
- Resolver返回 `sales_object / active_complete`；
- `integrity_check=ok`；
- `foreign_key_check=0`。

## 4. 现有数据库启动保护

在当前业务数据库的隔离副本中执行正常启动初始化，结果如下：

| 保护项 | 启动后数量 |
|---|---:|
| Legacy Mapping | 43,320 |
| Legacy Product Structure | 10,949 |
| Legacy Structure Component | 22,503 |
| Combo Group | 0 |
| Combo组件 | 0 |
| Manual Binding | 0 |
| Daily Facts | 11,548 |
| Daily Facts销售额 | 1,327,063.9502 |
| Daily Facts利润 | 624,038.6962 |

- 所有Legacy历史数量保持不变；
- 启动没有删除、清空或覆盖旧表；
- `integrity_check=ok`；
- `foreign_key_check=0`。

## 5. 归档与恢复能力

停止自动创建不等于删除历史恢复能力：

1. `migrateSalesLinkSkuComboGroupsV1()` 仍作为显式历史迁移函数保留，不再由启动链自动调用；
2. 隔离验证中显式调用该迁移后，Combo Group和组件Schema能够正常重建；
3. Legacy Product Structure历史迁移实现继续保留为离线兼容资产；
4. Phase 5G归档包的SQL、CSV、Schema、索引、Trigger和Manifest SHA-256再次全部校验通过；
5. 恢复流程执行归档包内的显式Schema与数据SQL，不依赖应用初始化自动建表。

因此，新系统运行与历史恢复已经分离：运行时不建Legacy，专项恢复时才显式创建Legacy。

## 6. Legacy Schema Guard

Guard覆盖两个入口：

### 主Schema检查

禁止 `server/schema.sql` 重新出现六张Legacy关系表的 `CREATE TABLE IF NOT EXISTS`。

### 启动迁移检查

禁止 `runLightweightMigrations()` 重新调用：

- `migrateSalesLinkSkuComboGroupsV1()`；
- `migrateSalesLinkSkuProductStructuresV1()`。

历史迁移函数定义本身允许保留；Guard只阻止它们重新进入生产启动路径。

当前Guard结果：`riskCount=0`。

## 7. 回归验证

| 检查 | 结果 |
|---|---|
| 空数据库初始化 | 通过，六张Legacy表均不存在 |
| 现有数据库隔离启动 | 通过，历史数据不变 |
| Legacy不存在时关系审批 | 通过 |
| Legacy不存在时Resolver | 通过 |
| 历史Combo显式迁移 | 通过 |
| Phase 5G归档SHA校验 | 全部通过 |
| `npm run test:v2-cleanup` | 6/6通过 |
| `npm run test:product-business` | 4/4通过 |
| `npm run check` | 通过 |
| `git diff --check` | 通过 |
| 当前业务库只读 `integrity_check` | `ok` |
| 当前业务库只读 `foreign_key_check` | 0 |

## 8. 观察期建议

建议本版本发布后设置48小时观察期；最低不得少于24小时，若期间没有完整覆盖销售导入和关系审批，则延长到72小时。

观察期必须覆盖：

1. 至少一次应用冷启动和服务重启；
2. 至少一次销售日报预览及幂等导入；
3. 至少一次Sales Object关系审批或幂等审批；
4. 产品中心、链接中心、组合装管理和产品关联查询；
5. Resolver日志中不得出现Legacy正式读取；
6. 六张Legacy表数量不得增长；
7. 启动后不得重新创建已不存在的Legacy表；
8. Daily Facts行数、销售额和利润不得因本版本变化。

观察期No-Go条件：

- 任一Legacy表被重新创建；
- Combo或Manual Binding出现新增记录；
- 正式业务出现 `no such table`；
- Resolver、审批、产品或链接查询结果下降；
- `integrity_check` 或 `foreign_key_check`失败。

观察期通过后，方可按Phase 5H计划申请物理退役窗口。本阶段只停止自动创建，不授权删除生产表。
