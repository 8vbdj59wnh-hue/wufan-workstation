# Architecture Cleanup-001 Legacy归档恢复演练 Phase 5G验收报告

## 1. 验收结论

隔离归档、物理删除模拟和完整恢复演练全部通过。

- 正式业务已能够在四张 Legacy 表完全不存在时启动和运行。
- Sales Object Resolver、产品经营读取、产品关联、关系审批和 Daily Facts 销售分析均未依赖 Legacy 表。
- 四张表可从归档恢复，记录数、逐表内容SHA-256、Schema、索引和Trigger与归档前一致。
- 生产/当前业务数据库全程只读，未删除或修改任何正式 Legacy 数据。

技术上已证明关系类 Legacy 表具备“归档后退役”条件；旧周期销售事实仍建议长期归档保留，不建议立即按普通关系资产处置。

## 2. 归档包

- 目录：`backups/architecture-cleanup-001-phase5g-20260819/`
- 压缩包：`backups/architecture-cleanup-001-phase5g-20260819.tar.gz`
- 压缩包大小：16,070,416 字节
- 压缩包 SHA-256：`4e368f73204a341cf1421279e661c846e88c881d8286eacb0757572f323d68f6`
- 解压目录大小：约79MB

归档内容：

- 可恢复的完整数据SQL；
- 四张表按主键排序的CSV；
- 完整Schema定义；
- 显式索引和Trigger恢复脚本；
- 归档清单与恢复顺序；
- `SHA256SUMS` 文件。

## 3. 归档资产数据

| Legacy资产 | 行数 | CSV大小 | CSV SHA-256 |
|---|---:|---:|---|
| `sales_link_sku_erp_mappings` | 43,320 | 12,083,144字节 | `7e2c31b73fe30d1818ebb892ebb8a7f8efeab525715f67dac50ff50d9e52cdc5` |
| `sales_link_sku_product_structures` | 10,949 | 5,749,002字节 | `e4a2ff3f2c9a592f7a969d5c1ffda3a0f436406254cb486dc543164f5e10edd9` |
| `sales_link_sku_product_structure_components` | 22,503 | 5,311,077字节 | `93988b28a59bebe7fd0adb07d814df4878ba370383989b66ffc554515bdb6f03` |
| `connection_sku_sales_facts` | 12,422 | 15,026,103字节 | `86aa78d9a7d5bc0c8bd32e5bcad7703742621763f817f9f2c85b8797294ec611` |

附加校验：

- 完整数据SQL：44,343,073字节，SHA-256 `38318507107a5ac96e985b4989bde9d3b39b783d846468f2785c2e222f2619a4`
- Schema/索引/Trigger快照：6,115字节，SHA-256 `6caaca61bd12c4b215dc89a0b6957095d0d391eccad723a080d66d402bcc1ddc`
- 显式索引/Trigger：16项；恢复后的总索引21个、Trigger 2个。

## 4. 隔离物理删除模拟

### 4.1 执行方式

1. 复制当前业务数据库到 `/tmp`。
2. 在副本中先执行 Phase 5F 审批审计解耦迁移。
3. 关闭副本外键写保护，按依赖顺序删除四张 Legacy 表。
4. 重新执行正常数据库初始化，确认初始化不会反向创建旧表。
5. 直接使用该副本进行业务验证。

### 4.2 删除后结果

| 检查 | 结果 |
|---|---|
| 四张Legacy表 | 全部不存在，初始化后未重建 |
| 系统初始化 | 正常 |
| Sales Object Resolver | `active_complete`，来源 `sales_object` |
| 关系审批 | 正常，结果 `idempotent` |
| 新审批 `productStructureId` | `null` |
| 新审批 `salesObjectStructureId` | 正确记录 |
| 新审批 `structureVersion` | 正确记录为1 |
| 产品销售汇总 | 正常，返回909个产品汇总 |
| 产品经营列表 | 正常 |
| Daily Facts | 11,548条 |
| 销售额 | 1,327,063.9502 |
| 利润 | 624,038.6962 |
| `integrity_check` | `ok` |
| `foreign_key_check` | 0 |

隔离数据库执行 `VACUUM` 后从 743,604,224 字节降至 635,203,584 字节，减少108,400,640字节，约14.58%。该结果仅表示当前副本的物理空间变化，不作为生产删除的唯一理由。

## 5. 恢复演练

恢复在另一份隔离数据库中进行：

1. 删除四张Legacy表；
2. 执行 `legacy-assets.sql` 恢复表及数据；
3. 执行 `indexes-triggers.sql` 恢复显式索引和Trigger；
4. 重新导出四张表和完整Schema；
5. 与归档前SHA-256逐项比较。

### 5.1 恢复校验

| 资产 | 恢复行数 | 内容SHA | 结果 |
|---|---:|---|---|
| Legacy Mapping | 43,320 | 与源一致 | 通过 |
| Legacy Structure | 10,949 | 与源一致 | 通过 |
| Legacy Components | 22,503 | 与源一致 | 通过 |
| Legacy Period Facts | 12,422 | 与源一致 | 通过 |
| Schema/索引/Trigger | 完整 | 与源一致 | 通过 |

- 恢复索引：21个；
- 恢复Trigger：2个；
- `integrity_check=ok`；
- `foreign_key_check=0`。

SQLite数据库文件因页布局、空闲页和执行顺序不同，不要求文件级SHA相同；本次采用“逐表有序CSV SHA + Schema SHA + 数量 + 外键”的内容级一致性标准，全部通过。

## 6. 退役分类建议

| 资产 | 分类 | 判断 |
|---|---|---|
| `sales_link_sku_erp_mappings` | **B 归档后退役** | 正式业务已不依赖；仍有历史关系来源和Shadow诊断价值，归档并异地保存后可从运行库退出。 |
| `sales_link_sku_product_structures` | **B 归档后退役** | 审批审计已迁移到Sales Object Structure；历史审批证据需随归档保留。 |
| `sales_link_sku_product_structure_components` | **B 归档后退役** | 必须与旧结构主表成组归档和退役，不允许单独删除。 |
| `connection_sku_sales_facts` | **C 长期保留** | 已退出正式读取，但属于历史销售与利润审计证据；建议迁出运行库形成长期只读财务归档，暂不按普通关系表立即删除。 |

没有资产建议归入“A 可立即退役”：即使运行时已脱离，生产操作仍必须先完成异地归档、恢复抽验、Phase 5F代码发布和单独删除审批。

## 7. 自动验证

| 检查 | 结果 |
|---|---|
| 归档 `SHA256SUMS` | 全部通过 |
| `npm run test:v2-cleanup` | 5/5通过 |
| `npm run test:product-business` | 4/4通过 |
| `npm run check` | 通过 |
| `git diff --check` | 通过 |
| 生产库只读 `integrity_check` | `ok` |
| 生产库只读 `foreign_key_check` | 0 |

## 8. 生产保护与下一步

- 未修改业务代码；本阶段新增内容仅为归档包和本验收报告。
- 未修改、删除或覆盖生产/当前业务数据库。
- 未提交、未发布。

建议下一步：

1. 将压缩归档包复制到独立存储，并再次核对 `4e368f...68f6`。
2. 先发布并验证 Phase 5F 的 Schema 解耦版本。
3. 单独审批关系类三张表的生产退役迁移。
4. 为旧周期销售事实确定财务保留年限和只读查询方式，再决定是否迁出生产运行库。

最终结论：**关系类Legacy资产已具备归档后退役的技术条件；旧周期销售事实具备恢复能力，但应长期归档保留。**
