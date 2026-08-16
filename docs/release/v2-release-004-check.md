# V2-RELEASE-004 Sales Object完整发布整合检查

## 1. 结论

V2-RELEASE-004 发布候选检查通过，可进入正式发布流程。

本次只完成版本、数据、迁移幂等、Resolver、页面服务和性能的隔离验证，未发布生产，未修改生产数据。

## 2. 整合版本

| 项目 | 结果 |
|---|---|
| 当前生产commit | `d1e1700feec74aca5f4a9ade101c0a0ae4eb4363` |
| 目标commit | `bcf0b2055df364e6f8df77e871f31374be9853d9` |
| 提交链 | 同一直线后继链 |
| 生产兼容整合 | 不需要额外merge/cherry-pick |
| reset/强制覆盖 | 不需要，严禁使用 |

生产 `d1e1700` 已包含 Sales Object、Resolver切换、历史数据、组合装管理、卡片视图与名称调整。目标commit在此基础上增加产品中心查询优化。

## 3. 功能完整性

### 3.1 数据层

目标版本包含并可读取：

- `sales_objects`；
- `sales_link_sku_sales_object_relations`；
- `sales_object_structures`；
- `sales_object_structure_components`。

生产一致快照中的实际数据：

| 数据项 | 数量 | 期望 | 结果 |
|---|---:|---:|---|
| Sales Object | 6,365 | 6,365 | 通过 |
| bundle | 3,643 | 3,643 | 通过 |
| active Link SKU关联 | 31,769 | 31,769 | 通过 |
| active组件 | 10,425 | 10,425 | 通过 |
| 组件ERP SKU | 2,842 | 2,842 | 通过 |
| 有Product映射组件ERP SKU | 2,842 | 2,842 | 100% |

### 3.2 Resolver

- `ResolveLinkSkuRelationRead` 存在；
- 链接详情、产品关联、SKU管理、组合装管理的相关读取能力已可返回 Sales Object 结果；
- Legacy active mapping 与 Link Product Structure 继续保留，未删除；
- 产品SKU列表主链仅读 Sales Object Resolver，Legacy/shadow compare 保留为通用诊断能力，不再阻塞列表。

### 3.3 产品中心

已确认包含：

- SKU管理；
- Product Workspace；
- 组合装管理列表和详情；
- 组合装卡片视图；
- 组合装显示文案；
- Sales Object自身销售额去重口径。

组合装专项样本验证：

- 1组件：单图；
- 4组件：4宫格；
- 15组件：只显示前9张；
- 图片来自组件Product；
- 服务不读取Legacy Product Structure；
- Sales Object样本销售额去重校验通过。

## 4. 迁移与历史数据预演

使用Node 22 + SQLite在线备份API生成生产一致快照，快照SHA-256：

`b26f735d79471100a0709149949d0e0cd844a4e39f96d2097c29a66e45d28b9a`

迁移Runner在同一隔离副本连续执行两次，均成功。

历史Sales Object生成连续执行两次，结果均为：

- objectsCreated = 0；
- structuresCreated = 0；
- componentsCreated = 0；
- relationsCreated = 0；
- objectsExisting = 6,365；
- structuresExisting = 6,365；
- relationsExisting = 31,769。

因此，当前生产数据基线下迁移可重复执行，历史数据生成幂等。

## 5. 性能结果

目标查询链已生效：

`筛选/排序 -> 数据库分页 -> 当前页Sales Object Resolver -> 指标水合 -> 返回`

不再在SKU列表中对全部6,902个ERP SKU执行Resolver。隔离生产快照上7次连续读取：

| 场景 | P50 | P95 |
|---|---:|---:|
| 默认50行 | 79.9ms | 83.9ms |
| 搜索 | 33.8ms | 34.1ms |
| 平台筛选 | 152.1ms | 157.3ms |
| 销售排序 | 142.0ms | 143.8ms |
| 库存排序 | 87.7ms | 99.5ms |
| 第2页 | 72.4ms | 73.8ms |
| Metadata冷读 | 188.6ms | <1s |

列表验证中Legacy Resolver查询数为0，达到P50 <500ms、P95 <1s目标。

## 6. 业务回归

| 能力 | 结果 |
|---|---|
| 链接详情 | 通过，样本包含2个SKU销售行和9个产品归属 |
| 产品关联 | 通过，样本ERP SKU反查7个链接关系，均来自Sales Object Resolver |
| Product Workspace | 通过，产品经营分析可读取 |
| SKU管理 | 通过，列表返回50行，默认已建档总数2,956 |
| 组合装管理 | 通过，总数3,643，详情组件和关联链接正常 |
| 组合装卡片 | 通过，单图/4宫格/9宫格和销售去重正常 |

销售事实保持：

- facts = 11,548；
- salesAmount = 1,327,063.9502；
- profitAmount = 624,038.6962。

迁移和历史生成前后上述数值完全一致。

## 7. 数据库保护

- `integrity_check`: `ok`；
- `foreign_key_check`: 0项；
- daily facts未修改；
- Legacy mapping未删除或修改；
- Legacy Product Structure未删除或修改；
- Product、ERP SKU、库存与利润口径未修改。

## 8. 发布风险

1. 生产数据库为运行中SQLite。不能通过文件直接拷贝制作发布备份；本次已确认直接拷贝可产生不一致文件。正式发布必须使用SQLite在线备份API，并立即执行完整性检查。
2. 生产默认Node已升级为25，但`better-sqlite3`二进制与Node 22 ABI匹配。PM2生产服务当前正常，但发布脚本和备份步骤必须显式使用`/opt/homebrew/opt/node@22/bin/node`，避免误用Node 25。
3. 旧的部分验证脚本以SQLite数据库文件字节SHA作为只读保护，这不适合会执行初始化的隔离副本；发布门禁应以受保护表计数/金额快照、`integrity_check`和`foreign_key_check`为准。

这些风险不阻断发布，但必须纳入正式发布操作清单。

## 9. 发布建议

可正式发布`bcf0b2055df364e6f8df77e871f31374be9853d9`。

发布时建议：

1. 确认生产HEAD仍为`d1e1700`且工作区干净；
2. 使用Node 22 + SQLite在线备份API创建备份，记录SHA-256；
3. 用现有发布脚本的fast-forward/后继commit保护发布；
4. 运行迁移，历史Sales Object生成应全部幂等跳过；
5. 发布后验证数量、销售/利润、组合装页面与SKU列表性能；
6. 如果发布期间产生新业务写入，优先前向修复，不得盲目恢复旧库覆盖新数据。
