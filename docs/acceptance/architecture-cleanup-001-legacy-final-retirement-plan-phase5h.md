# Architecture Cleanup-001 Legacy最终退役执行方案 Phase 5H报告

## 1. 方案结论

本方案将 Legacy 物理退役拆分为“代码冻结发布”和“数据库退役执行”两个独立窗口，不允许在同一操作中一边解除依赖、一边删除表。

根据 Phase 5F、5G 的结果：

- Sales Object 已是运行时唯一关系来源；
- Daily Facts 已是正式销售事实来源；
- 审批项目和审计已迁移到 `salesObjectStructureId + structureVersion`；
- 隔离删除后，系统启动、Resolver、关系审批、产品经营和销售分析均正常；
- Legacy 归档已完成恢复演练，逐表内容和 Schema SHA-256 一致。

因此，Combo、Manual Binding 可在停止自动建表后直接退役；Legacy Mapping 和 Legacy Product Structure 可在归档固化后成组退役；`connection_sku_sales_facts` 长期只读保留，本次不进入删除脚本。

## 2. 最终退役清单

### 2.1 A类：可直接退役

| 资产 | 当前数量 | 处理 | 前置条件 |
|---|---:|---|---|
| `sales_link_sku_combo_group_components` | 0 | 删除表、索引、Trigger | 停止Schema创建；确认仍为0；Legacy Mapping先退出或解除`comboGroupId`外键 |
| `sales_link_sku_combo_groups` | 0 | 删除表、索引、Trigger | 组件表先删除；停止Schema创建 |
| `platform_sku_manual_bindings` | 0 | 删除表 | 停止Schema创建；确认无正式读写 |

“可直接退役”表示不需要迁移业务数据，不表示可以绕过备份、Schema清单、外键检查和发布审批。

保留以下历史字段，不在本次删除：

- `sales_link_sku_daily_snapshots.manualBindingId`：历史快照文本，不是运行关系；
- 审批、快照或历史审计中的旧ID字段：继续承担不可变追溯语义。

### 2.2 B类：归档后退役

| 资产 | Phase 5G基线 | 处理 |
|---|---:|---|
| `sales_link_sku_erp_mappings` | 43,320 | 归档固化后从运行库删除 |
| `sales_link_sku_product_structures` | 10,949 | 与组件表成组归档、成组删除 |
| `sales_link_sku_product_structure_components` | 22,503 | 与主结构表成组归档、成组删除 |

退役后仍保留：

- `product_structure_application_items.productStructureId`；
- `product_structure_application_audits.productStructureId`；
- 已迁移的 `salesObjectStructureId` 和 `structureVersion`。

旧 `productStructureId` 删除父表后作为历史归档键存在，不再承担运行时外键语义。需要查看历史组件时，通过归档包恢复到隔离库查询。

### 2.3 C类：长期保留

| 资产 | Phase 5G基线 | 保留方式 |
|---|---:|---|
| `connection_sku_sales_facts` | 12,422 | 生产只读冻结 + 专项长期归档；禁止新增、更新、删除 |

保留原因：该表虽已退出正式经营读取，但仍保存历史周期销售、成本和利润证据。未确定财务与审计保留年限前，不进入物理删除迁移。

## 3. 归档方案

### 3.1 归档层级

生产执行前必须同时具备：

1. **完整数据库备份**：退役前一致性SQLite备份，作为整库回滚来源；
2. **Legacy专项归档**：B类三张关系表的完整SQL、数据和结构；
3. **开放格式审计文件**：每表按主键排序的UTF-8 CSV；
4. **A类Schema归档**：即使表为空，也保存Combo、Manual Binding的表、索引、Trigger定义；
5. **C类长期归档**：旧周期销售事实独立保存，但生产表本次保留。

禁止在服务持续写入且未执行SQLite一致性备份机制时直接复制数据库主文件。应使用SQLite Backup API，或在停写、完成WAL checkpoint并关闭数据库连接后复制。

### 3.2 每个归档包必须包含

- 全部数据；
- `CREATE TABLE` Schema；
- 显式索引及唯一约束；
- Trigger定义；
- 外键定义；
- 行数、最小/最大业务时间和最后更新时间；
- Daily Facts及旧周期事实的金额、成本、利润摘要；
- Git commit、数据库版本、导出时间和执行人；
- 恢复顺序及恢复限制；
- 文件级和内容级SHA-256。

### 3.3 校验标准

归档不是以“文件存在”为通过条件，必须同时满足：

1. 压缩包SHA-256一致；
2. 每表行数一致；
3. 每表按主键有序导出的CSV SHA-256一致；
4. Schema、索引、Trigger文本SHA-256一致；
5. 隔离恢复后 `integrity_check=ok`；
6. 隔离恢复后 `foreign_key_check=0`；
7. 恢复后的历史金额、利润、日期范围与归档清单一致。

Phase 5G 已生成并验证的演练包：

- 文件：`backups/architecture-cleanup-001-phase5g-20260819.tar.gz`
- SHA-256：`4e368f73204a341cf1421279e661c846e88c881d8286eacb0757572f323d68f6`

该包证明恢复方法可行；正式退役窗口仍必须基于窗口开始时的最新生产数据库重新生成归档，不能直接把Phase 5G演练包当作最终生产归档。

## 4. 实施阶段

### Phase H0：冻结基线，不做删除

1. 确定生产发布commit和数据库路径；
2. 记录六张拟退役/保留表的行数；
3. 记录 Sales Object、active关系、active结构、Daily Facts基线；
4. 记录销售额、成本、利润及日期范围；
5. 扫描正式代码、API、测试和脚本引用；
6. 确认所有新关系写入只产生Sales Object资产；
7. 确认 Combo、Manual Binding仍为0。

任意数量或依赖与本方案不一致时停止执行，重新审计。

### Phase H1：先发布Schema冻结版本

该版本只停止创建和迁移待退役资产，不执行 `DROP TABLE`：

- 从 `schema.sql` 移除Combo两表、Manual Binding表的默认创建；
- 停止 `db.js` 中 `migrateSalesLinkSkuComboGroupsV1()` 的启动调用；
- 确认 Legacy Mapping、Legacy Product Structure已按Phase 5F不再默认创建；
- 保留历史迁移脚本为离线恢复工具，不允许在生产启动链调用；
- `connection_sku_sales_facts` 继续保留只读Schema。

发布后观察24–72小时，至少覆盖一次销售导入、关系审批、产品中心和链接中心日常使用。观察期内不得执行物理删除。

### Phase H2：正式归档固化

1. 进入维护状态，停止数据库写入；
2. 创建完整生产数据库一致性备份；
3. 记录备份文件大小与SHA-256；
4. 重新生成最新Legacy专项归档；
5. 保存到本机只读目录和独立存储至少各一份；
6. 在隔离库恢复并完成内容级校验；
7. 归档检查全部通过后，才签发数据库退役执行许可。

### Phase H3：物理退役迁移

建议生成一个独立、一次性、版本化迁移，例如：

`retire_legacy_link_relation_assets_v1`

迁移必须先做前置断言，再在单个 `BEGIN IMMEDIATE` 事务中执行。伪代码如下，仅用于方案说明，本阶段不得执行：

```sql
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

-- 前置断言由迁移程序完成：A类数量必须为0，B类数量必须等于归档清单。

-- 先移除同时引用Combo与Product Structure的Legacy Mapping。
DROP TABLE sales_link_sku_erp_mappings;

-- 再移除空Combo子表与父表。
DROP TABLE sales_link_sku_combo_group_components;
DROP TABLE sales_link_sku_combo_groups;

-- Legacy Product Structure必须子表先于父表。
DROP TABLE sales_link_sku_product_structure_components;
DROP TABLE sales_link_sku_product_structures;

-- Manual Binding无入站外键，最后独立移除。
DROP TABLE platform_sku_manual_bindings;

COMMIT;
```

`connection_sku_sales_facts` 不得出现在该脚本中。

SQLite会随表删除其所属索引和Trigger，但迁移仍应在删除前记录对象清单，删除后断言相关表、索引和Trigger均为0。

### Phase H4：删除后验证

数据库层：

- 六个退役表均不存在；
- `connection_sku_sales_facts` 仍存在且数量不变；
- `integrity_check=ok`；
- `foreign_key_check=0`；
- 应用重启后不得重建退役表。

关系层：

- Sales Object数量不变；
- active Link SKU关系数量不变；
- active Sales Object Structure数量不变；
- 随机验证single、single × N、bundle均为 `active_complete`；
- Shadow诊断缺少旧表时只返回 `legacy_unavailable`，不得影响正式结果。

业务层：

- 产品中心、链接中心、组合装管理正常；
- 产品关联与链接详情正常；
- 新关系审批可生成Sales Object结构并立即被Resolver读取；
- Daily Facts行数、日期范围、销售额、成本和利润与删除前一致；
- 重复销售导入继续幂等；
- Combo Review和旧解绑接口保持删除或HTTP 410兼容语义。

工程层：

- `npm run check`；
- `npm run test:v2-cleanup`；
- `npm run test:product-business`；
- `git diff --check`；
- 启动无Legacy表环境测试。

### Phase H5：延迟空间回收

首个退役窗口只执行事务性删除，不执行 `VACUUM`。原因：

- `DROP TABLE` 可通过整库备份快速回滚；
- `VACUUM` 会重写整个数据库文件，延长维护时间并提高磁盘空间和中断风险；
- Phase 5G 已证明空间收益约108,400,640字节，但空间回收不是业务正确性的前置条件。

建议在退役稳定运行至少7天后，另开维护窗口执行SQLite安全重建或 `VACUUM`，并再次完成整库备份。

## 5. 风险评估

| 风险领域 | 风险 | 等级 | 控制措施 |
|---|---|---|---|
| 外键 | Mapping同时引用Combo Group和Legacy Structure；错误顺序会阻断删除 | 高 | Mapping先删，组件先于父表；执行前查询全部入站外键 |
| Schema初始化 | 当前Combo迁移调用和Manual Binding Schema仍可能重建空表 | 高 | Phase H1先发布停止建表版本，并观察24–72小时 |
| API | 历史接口或脚本可能直查已删除表 | 中 | 正式API扫描为0；旧接口保持410；历史脚本移出生产执行路径 |
| 代码 | Shadow Compare可能期望Legacy表存在 | 低 | 无表时明确返回 `legacy_unavailable`，正式Resolver始终返回Sales Object结果 |
| 测试 | Legacy fixture掩盖新环境无旧表问题 | 中 | 生产门禁使用Sales Object fixture，并保留真正的无Legacy启动测试 |
| 历史追溯 | 删除父表后 `productStructureId` 不能在线展开组件 | 高 | 保留旧ID字段；使用专项归档在隔离库恢复查询 |
| 财务审计 | 旧周期事实被误纳入关系资产删除 | 高 | C类表从迁移脚本硬排除，并增加静态检查 |
| 并发写入 | 归档与删除期间数据变化导致数量/SHA不一致 | 高 | 维护状态、停止写入、`BEGIN IMMEDIATE`、归档后再次断言数量 |
| 磁盘 | 备份和VACUUM需要额外空间 | 中 | 提前检查至少2倍数据库可用空间；VACUUM另开窗口 |
| 回滚版本 | 恢复旧表但新旧代码版本不匹配 | 高 | 备份必须绑定Git commit和Schema版本；整库与代码成对回退 |

## 6. 回滚方案

### 6.1 提交事务前失败

- 立即 `ROLLBACK`；
- 保持当前代码和数据库不变；
- 保存错误日志、前置断言和归档清单；
- 不允许跳过失败资产继续删除其他表。

### 6.2 提交后、服务开放前失败

首选整库回滚：

1. 停止应用服务；
2. 保留失败数据库副本；
3. 校验退役前完整备份SHA-256；
4. 将备份恢复为新的数据库文件；
5. 恢复与备份绑定的代码commit；
6. 执行完整性、外键和业务基线检查；
7. 通过原子文件切换恢复服务。

不得在服务运行时用归档SQL覆盖当前数据库。

### 6.3 上线后发现历史查询需求

若正式业务指标正确，仅需历史审计：

- 不回滚生产；
- 将Legacy专项归档恢复到隔离只读数据库；
- 通过历史ID查询，不把Legacy资产重新接回正式Resolver。

若正式业务发生数据缺失或Resolver错误：

- 进入维护状态；
- 按6.2执行整库与代码成对回滚；
- 恢复后核对Sales Object、Daily Facts和全部Legacy表数量。

### 6.4 专项表恢复顺序

仅在隔离环境或已批准的专项恢复中使用：

1. Legacy Product Structure主表；
2. Legacy Product Structure组件；
3. Combo Group；
4. Combo组件；
5. Legacy Mapping；
6. Manual Binding；
7. 重建索引与Trigger；
8. 执行内容SHA、完整性和外键校验。

C类旧周期销售事实从未删除，无需参与正常退役回滚。

## 7. Go / No-Go门禁

只有全部满足才允许执行H3：

- [ ] Phase 5F及H1代码已发布并稳定运行24–72小时；
- [ ] Combo Group、Combo组件、Manual Binding数量仍为0；
- [ ] B类最新归档和完整数据库备份均有两份，SHA-256通过；
- [ ] 最新归档已完成隔离恢复；
- [ ] 所有入站外键均已解除或位于同一删除事务；
- [ ] 正式API、服务、前端不存在Legacy表读取；
- [ ] 新审批100%具备Sales Object Structure语义；
- [ ] `connection_sku_sales_facts`明确不在删除脚本；
- [ ] 无Legacy启动、Resolver、产品、链接和审批测试通过；
- [ ] 回滚数据库、回滚commit和执行人员均已就位；
- [ ] 可用磁盘空间满足备份要求；
- [ ] 业务负责人、数据负责人和发布负责人共同批准。

任一项不满足即为No-Go。

## 8. 发布窗口建议

建议安排两个正式窗口和一个可选空间回收窗口：

### 窗口1：代码冻结发布

- 时长：30–45分钟；
- 内容：发布停止Legacy自动建表/迁移的版本；
- 数据库操作：只执行兼容Schema迁移，不删除表；
- 后续：观察24–72小时。

### 窗口2：归档与物理退役

- 时长：预留60–90分钟；
- 时段：低流量、无人执行导入和关系审批的时间；
- 内容：停写、完整备份、专项归档复核、事务删除、重启和回归；
- 回滚观察：服务开放前至少保留15分钟验证时间；
- 失败原则：任何核心指标不一致立即整库回滚。

### 窗口3：可选空间回收

- 时间：退役稳定运行至少7天后；
- 时长：单独评估；
- 内容：完整备份后执行 `VACUUM` 或SQLite安全重建；
- 不与首次物理退役合并。

## 9. 最终建议

1. **本次物理退役只删除A类与B类关系资产。**
2. **`connection_sku_sales_facts`长期只读保留，不执行DROP。**
3. **先发布停止自动建表版本，再执行数据库删除。**
4. **Legacy Mapping先删，所有组件表先于其父表。**
5. **生产回滚以整库备份 + 对应代码commit为主，归档SQL主要用于隔离历史查询。**
6. **首次删除窗口不执行VACUUM。**

本阶段仅完成方案设计，没有修改生产数据库，没有执行任何 `DROP TABLE`。
