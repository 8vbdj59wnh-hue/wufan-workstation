# Architecture Cleanup-001 Legacy Schema解耦与审计迁移 Phase 5F验收报告

## 1. 结论

本阶段通过，可以进入后续 Legacy 归档与物理退役准备，但本次没有删除任何 Legacy 表、字段或历史数据，也没有修改生产数据库。

- 新环境初始化不再创建四张 Legacy 运行表。
- 新审批及执行审计以 `salesObjectStructureId + structureVersion` 为正式结构语义。
- `productStructureId` 作为历史追溯字段保留，但已解除到 Legacy Product Structure 的外键依赖。
- 现有数据库可在隔离副本中无损迁移：审批项目 10,957 条、审计 10,948 条均补齐 Sales Object Structure 追溯信息。
- Sales Object Resolver 在无 Legacy 表的新数据库中可独立运行；Shadow Compare 会明确返回 `legacy_unavailable`，且不影响正式结果。

## 2. 修改范围

### 2.1 审批审计迁移

`product_structure_application_items` 与 `product_structure_application_audits` 新增：

- `salesObjectStructureId`
- `structureVersion`

同时保留：

- `productStructureId`：仅承担历史记录和兼容查询，不再作为新流程的运行依赖。

结构约束调整：

- 移除审批项目、审计记录到 `sales_link_sku_product_structures` 的硬外键。
- 新增到 `sales_object_structures(id)` 的外键。
- `sales_relation_candidates.mappingId` 保留历史值，但移除到 Legacy Mapping 的硬外键。

新审批执行、幂等执行和回滚审计均记录 Sales Object Structure ID 与版本；新审批不要求 Legacy Product Structure 存在。

### 2.2 历史审计迁移

现有数据库升级时按以下正式关系回填：

`salesLinkSkuId → active sales_link_sku_sales_object_relations → active sales_object_structures`

回填结果（隔离生产副本）：

| 对象 | 总数 | 已补齐 Sales Object Structure | 覆盖率 |
|---|---:|---:|---:|
| 审批项目 | 10,957 | 10,957 | 100% |
| 审计记录 | 10,948 | 10,948 | 100% |

历史 `productStructureId` 原值全部保留。

### 2.3 Schema 初始化解耦

新数据库默认不再创建：

- `sales_link_sku_erp_mappings`
- `sales_link_sku_product_structures`
- `sales_link_sku_product_structure_components`
- `connection_sku_sales_facts`

同步取消这些表对应的默认索引、触发器和运行时建表调用。历史迁移函数与历史 Schema 实现仍保留为显式兼容资产，不再由新环境初始化主动调用。

旧周期事实结构升级只会在旧表已存在时执行；不会因兼容迁移反向创建旧表。

## 3. 验证结果

### 3.1 全新数据库初始化

| 检查 | 结果 |
|---|---|
| 四张 Legacy 运行表 | 均未创建 |
| 审批项目新字段 | 存在 |
| 审计记录新字段 | 存在 |
| 到 Legacy 表的外键 | 0 |
| Sales Object Resolver 所需四张表 | 完整 |
| `integrity_check` | `ok` |
| `foreign_key_check` | 0 |

### 3.2 现有数据库隔离迁移

| 保护项 | 迁移前后结果 |
|---|---:|
| Legacy Mapping | 43,320，不变 |
| Legacy Product Structure | 10,949，不变 |
| Legacy Structure Component | 22,503，不变 |
| Legacy周期销售事实 | 12,422，不变 |
| Daily Facts | 11,548，不变 |
| Daily Facts销售额 | 1,327,063.9502，不变 |
| Daily Facts利润 | 624,038.6962，不变 |
| 审批/候选到Legacy资产的外键 | 0 |
| `integrity_check` | `ok` |
| `foreign_key_check` | 0 |

### 3.3 新审批与历史查询

- 新关系审批只生成 Sales Object、Sales Object Structure、组件和 Link SKU关系。
- 审批项目与审计记录均写入 `salesObjectStructureId`、`structureVersion`。
- 幂等执行仍生成可追溯审计，不新增 Legacy 关系。
- 回滚审计允许在目标结构尚未生成时记录失败/回滚事实，不强制伪造 Legacy Structure。
- 历史记录仍可通过保留的 `productStructureId` 查询；隔离迁移后同时可以按 Sales Object Structure 查询。

### 3.4 自动检查

| 检查 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm run test:v2-cleanup` | 5/5 通过 |
| `npm run test:product-business` | 4/4 通过 |
| `git diff --check` | 通过 |

产品经营、产品关联、库存展开和销售事实测试夹具已改为 Sales Object / Daily Facts，不再要求全新数据库存在 Legacy 表。

## 4. Legacy资产归档定义

| Legacy资产 | 保留原因 | 建议归档方式 | 允许物理删除的条件 |
|---|---|---|---|
| `sales_link_sku_erp_mappings` | 历史关系来源、审批依据、诊断对比 | 只读 SQLite 快照 + CSV明细 + Schema/索引清单 + SHA-256 | 无正式读写；Shadow Compare不再需要；候选历史字段已完成可恢复归档 |
| `sales_link_sku_product_structures` | 历史结构版本及人工审批证据 | 与组件表、审批项目、审计记录交叉导出，保留ID映射清单 | 审批审计100%迁移；历史详情可由归档恢复；法务/审计保留期满足 |
| `sales_link_sku_product_structure_components` | 历史结构组件和数量证据 | 与主结构按ID成组导出，禁止单表孤立归档 | 与主结构相同，并通过结构/组件数量和哈希校验 |
| `connection_sku_sales_facts` | 旧周期销售事实和历史导入证据 | 只读 SQLite 快照 + CSV分期导出 + 汇总校验清单 | 全部业务读写退出；历史查询有独立归档入口；金额、利润、行数校验完成 |

归档包至少包含：导出时间、源数据库SHA-256、表结构、索引、行数、时间范围、关键金额汇总、文件SHA-256和恢复说明。恢复应进入隔离数据库，不允许直接覆盖当前生产库。

## 5. 数据保护

- 生产/当前业务数据库仅以 SQLite只读模式执行基线与完整性查询。
- 所有迁移写入均在 `/tmp` 隔离副本执行。
- 未删除 Legacy 表、字段、索引或历史记录。
- 未修改 Sales Object、Daily Facts、产品、ERP SKU 的生产业务数据。

## 6. 后续建议

下一阶段建议先执行“归档包生成与恢复演练”，再决定物理删除顺序：

1. 先归档并恢复校验 Legacy Product Structure 主表与组件表。
2. 再归档 Legacy Mapping，并退出 Shadow Compare 对其的依赖。
3. 旧周期销售事实单独按财务审计要求长期保存，最后评估物理删除。
4. 物理删除必须使用独立迁移版本，并在生产备份、隔离恢复成功后另行审批。

本阶段结论：**结构解耦完成；具备归档演练条件，尚未授权或执行物理删除。**
