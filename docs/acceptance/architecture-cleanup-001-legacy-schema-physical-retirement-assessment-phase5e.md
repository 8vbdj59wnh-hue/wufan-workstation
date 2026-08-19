# Architecture Cleanup-001 Legacy Schema物理退役评估 Phase 5E报告

## 一、结论摘要

当前已经满足“正式业务运行时不依赖Legacy关系读取”的条件，但尚不满足“安全物理删除Legacy Schema”的条件。

主要阻断：

1. `product_structure_application_items` 的10,957条记录和 `product_structure_application_audits` 的10,948条记录通过外键依赖旧 Product Structure；
2. `sales_link_sku_erp_mapping_candidates` 的Schema仍保留指向Legacy mapping的外键，虽然当前表内记录为0；
3. `server/schema.sql`、`server/db.js` 和 `server/productStructureSchema.js` 仍会创建或迁移这些表；
4. 应用启动后会自动重建被删除的四张空表，说明当前代码版本尚未冻结Legacy Schema创建；
5. 旧诊断Resolver、历史验证脚本和部分Legacy测试仍依赖这些表。

因此本阶段没有A类“可立即删除”资产。旧销售事实最接近退役条件；旧Product Structure及组件因审计外键应暂时长期保留。

## 二、资产逐项评估

### 1. `sales_link_sku_erp_mappings`

| 项目 | 结果 |
|---|---|
| 数据量 | 43,320条 |
| 最后更新时间 | 2026-08-18T14:36:19.949Z |
| 外键入站依赖 | `sales_link_sku_erp_mapping_candidates.mappingId`，当前候选表0条 |
| 外键出站依赖 | Link SKU、ERP SKU、批次、Combo Group、旧Product Structure |
| 代码依赖 | 3个服务端文件：Schema/迁移、旧诊断Resolver |
| API依赖 | 正式API无直接读取；Shadow Compare经统一Resolver显式诊断调用 |
| 测试依赖 | 4个测试文件仍引用历史表 |
| 脚本依赖 | 60个历史验证、迁移或对比脚本引用 |
| 审计价值 | 高：保存历史正式关系、来源、数量、旧结构ID和批次追溯 |
| 当前分类 | **B 归档后删除，但尚未达到删除前置条件** |

需要先移除Schema创建、改造候选表外键、将诊断Resolver改为读取独立归档，并清理历史脚本的生产可执行性。

### 2. `sales_link_sku_product_structures`

| 项目 | 结果 |
|---|---|
| 数据量 | 10,949条 |
| 最后更新时间 | 2026-08-18T14:46:22.986Z |
| 外键入站依赖 | 审批项10,957条、审批审计10,948条、mapping 22,501条、组件22,503条、自引用0条 |
| 代码依赖 | 4个服务端文件：Schema/迁移、诊断Resolver、资产目录 |
| API依赖 | 正式业务API不直接读取；历史审批记录仍通过ID追溯 |
| 测试依赖 | 3个测试文件 |
| 脚本依赖 | 19个历史应用、恢复或验证脚本 |
| 审计价值 | 极高：审批来源、结构签名、状态、审核与激活时间的历史证据 |
| 当前分类 | **C 长期保留** |

只有在审批项和审批审计完成“历史ID快照化”、移除硬外键后，才可重新评估为B类。

### 3. `sales_link_sku_product_structure_components`

| 项目 | 结果 |
|---|---|
| 数据量 | 22,503条 |
| 最后更新时间 | 2026-08-11T13:09:09.089Z |
| 外键依赖 | 全量依赖旧 Product Structure；同时引用ERP SKU |
| 代码依赖 | 4个服务端文件：Schema/迁移、诊断Resolver、资产目录 |
| API依赖 | 正式业务API不直接读取 |
| 测试依赖 | 1个测试文件 |
| 脚本依赖 | 14个历史验证或应用脚本 |
| 审计价值 | 极高：解释历史审批结构的ERP组件与quantity |
| 当前分类 | **C 长期保留** |

组件必须与旧结构作为同一归档单元处理，不能单独删除。

### 4. `connection_sku_sales_facts`

| 项目 | 结果 |
|---|---|
| 数据量 | 12,422条 |
| 最后更新时间 | 2026-08-18T08:39:00.193Z |
| 外键入站依赖 | 无 |
| 代码依赖 | 2个服务端文件：Schema/迁移和资产目录；正式服务无运行时读取 |
| API依赖 | 旧重新迁移API已关闭；无正式API读取 |
| 测试依赖 | 4个测试文件包含只读保护或历史fixture |
| 脚本依赖 | 39个历史验证、对比或迁移脚本 |
| 审计价值 | 高：历史周期销售、成本和利润口径证据 |
| 当前分类 | **B 归档后删除** |

这是最接近物理退役的资产，但仍需先删除Schema自动创建和旧结构升级代码，并冻结历史脚本入口。

## 三、外键阻断详情

直接删除四张表后，隔离数据库出现21,905条外键违例：

| 依赖表 | 违例数 |
|---|---:|
| `product_structure_application_items` | 10,957 |
| `product_structure_application_audits` | 10,948 |

`sales_link_sku_erp_mapping_candidates.mappingId` 当前没有实际数据引用，但Schema外键仍存在，仍需在正式物理退役迁移中重建该表或替换历史引用语义。

## 四、归档方案

### 归档层级

建议同时生成三层归档：

1. **完整SQLite只读归档**：保留退役前完整数据库副本，作为最高恢复保障；
2. **Legacy专项SQLite归档**：保留四张Legacy表、建表SQL、索引、触发器及必要身份表快照；
3. **开放格式导出**：每表导出UTF-8 CSV或JSONL，便于人工审计和跨系统读取。

### 必须保存的内容

- 表结构、索引、触发器及外键定义；
- 四张表全部记录；
- 审批项与审批审计的关联快照；
- Link SKU、ERP SKU、批次ID等必要身份字段；
- 每张表记录数、最小/最大时间、SHA-256；
- 导出版本、Git commit、数据库版本和导出时间；
- Sales Object对应关系对照清单。

### 推荐格式

| 用途 | 格式 |
|---|---|
| 完整恢复 | SQLite数据库副本 |
| 精确Schema恢复 | SQL dump |
| 审计和长期可读 | CSV/JSONL + manifest.json |
| 完整性验证 | SHA-256清单 |

### 恢复方式

1. 校验归档SHA-256和manifest记录数；
2. 在隔离数据库执行归档Schema；
3. 按父表→子表顺序恢复旧Product Structure、组件、mapping和旧销售事实；
4. 恢复审批审计关联；
5. 执行 `integrity_check`、`foreign_key_check` 和逐表行数/摘要校验；
6. 禁止直接覆盖当前Sales Object数据，恢复仅用于历史审计或专项回溯。

建议保留期限：完整数据库备份长期保留；Legacy专项归档至少覆盖企业财务与审计要求期限，未明确期限前按长期保留处理。

## 五、隔离删除模拟

### 模拟方法

基于 `data/workstation.db` 创建临时副本，在关闭外键写入保护的隔离副本中移除四张Legacy表；原数据库全程只读且未修改。

### 结果

| 验证项 | 结果 |
|---|---|
| 四张Legacy表移除 | 成功，隔离副本剩余0张 |
| SQLite `integrity_check` | `ok` |
| SQLite `foreign_key_check` | 失败，21,905条违例 |
| Sales Object数量 | 6,365，保持 |
| active Link SKU关系 | 31,769，保持 |
| active Sales Object Structure | 6,365，保持 |
| daily facts | 11,548条，保持 |
| 全量销售额/利润 | 1,327,063.9502 / 624,038.6962，保持 |
| 30日经营查询 | 销售额1,237,427.1381，利润585,519.1009，正常 |
| 产品销售关联摘要 | 909个Product，正常 |
| Sales Object Resolver抽查 | `sales_object / active_complete`，正常 |

### 系统启动验证

应用进程能够进入监听状态，但启动初始化会自动重建四张空Legacy表。重建后：

- 四张表重新出现；
- 表内记录均为0；
- 原审批项与审计记录无法重新关联；
- `foreign_key_check` 仍有21,905条违例。

因此“服务进程能启动”不等于“Schema已可物理退役”。当前Schema初始化逻辑是明确阻断项。

### 测试体系验证

现有测试会初始化Schema并自动重建Legacy表，因此不能证明无Legacy Schema启动。当前依赖规模为：

- Legacy mapping：4个测试文件；
- 旧Product Structure：3个测试文件；
- 旧组件：1个测试文件；
- 旧销售事实：4个测试文件。

必须新增真正的“Legacy表不存在”启动与业务测试，并禁止测试初始化重新创建这些表，之后才可验收物理退役。

## 六、数据库空间影响

当前数据库文件：726,372,352字节，约692.72 MiB。

四张表及其索引按 `dbstat` 合计约69.65 MiB：

| 资产 | 表及索引约占用 |
|---|---:|
| Legacy mapping | 26.45 MiB |
| 旧Product Structure | 8.80 MiB |
| 旧组件 | 13.45 MiB |
| 旧销售事实 | 20.95 MiB |

隔离副本对照VACUUM后：

- 保留Legacy：703,717,376字节；
- 删除Legacy：634,343,424字节；
- 净减少69,373,952字节，约66.16 MiB，约占压缩后数据库9.86%。

只执行DROP不会立即缩小SQLite文件，需在维护窗口执行VACUUM或等效安全重建。VACUUM前必须有完整备份和可用磁盘空间。

查询层面，正式业务已经使用Sales Object和daily facts，预计不会因删除产生查询性能下降；删除可减少Schema、索引维护和误用风险，但不会显著提升现有主查询速度。

## 七、最终分类

| 资产 | 分类 | 当前是否可执行物理删除 |
|---|---|---|
| `sales_link_sku_erp_mappings` | B 归档后删除 | 否 |
| `sales_link_sku_product_structures` | C 长期保留 | 否 |
| `sales_link_sku_product_structure_components` | C 长期保留 | 否 |
| `connection_sku_sales_facts` | B 归档后删除 | 否，最接近条件 |

当前没有A类资产。

## 八、物理退役前置条件

1. 从 `schema.sql`、`db.js`、`productStructureSchema.js` 移除Legacy建表和迁移逻辑；
2. 将审批项、审批审计中的旧 `productStructureId` 转为不可变历史快照或独立归档ID，重建外键；
3. 处理候选表 `mappingId` 外键；
4. 将Shadow Compare改为读取离线归档，或正式停止旧Resolver诊断；
5. 清理/封存60+个历史脚本的生产执行入口；
6. 迁移仍依赖Legacy fixture的测试；
7. 建立“Legacy表不存在且不会重建”的启动、业务查询和回滚测试；
8. 完成完整备份、专项归档、SHA-256和恢复演练；
9. 再次执行隔离DROP，要求 `integrity_check=ok`、`foreign_key_check=0`、业务指标不变；
10. 最后才可设计生产物理退役迁移。

## 九、最终判断

**当前不具备Legacy Schema生产物理退役条件。**

运行时单轨化已完成，但Schema、审计外键和测试体系尚未完成解耦。建议下一阶段优先处理“审批审计历史快照化 + Schema停止重建”，然后先单独退役 `connection_sku_sales_facts`，关系类三表在审计链完成迁移后再评估。
