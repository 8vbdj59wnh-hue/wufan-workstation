# V2-DATA-018 Sales Object 正式 Schema 实现验收报告

## 1. 实施边界

本阶段新增 Sales Object 正式 Schema、历史主数据生成服务、旁路 Resolver 和隔离验证脚本。现有 `ResolveLinkSkuErpRelation`、active mapping、Link Product Structure、销售事实及业务读取均未切换或修改。

历史生成只由显式服务调用，应用启动不会读取 Excel 或自动回填生产数据。本次数据验证在生产数据库只读副本中完成。

## 2. 新增 Schema

| 表 | 职责 | 关键约束 |
|---|---|---|
| `sales_objects` | 销售对象身份 | 标准化 `objectCode` 全局唯一；类型仅 `single/bundle` |
| `sales_link_sku_sales_object_relations` | Link SKU 到 Sales Object 的时效关系 | 每个 Link SKU 最多一个 active 关系；Link SKU、Sales Object 外键 |
| `sales_object_structures` | 销售对象结构版本 | 每对象版本、结构哈希唯一；最多一个 active 版本；active 必须有审核与生效时间 |
| `sales_object_structure_components` | 结构中的 ERP SKU 组件 | ERP SKU 外键；同结构组件唯一；`quantity > 0` |

结构必须先以非 active 状态建立组件，再激活。single 结构激活时必须且只能包含一个 `ERP SKU ×1`。active 结构的组件不可直接增删改，结构变化必须创建新版本，避免历史解释被静默改写。

## 3. 历史关系生成

来源职责保持冻结：

- 平台货品表提供 Link SKU 身份与销售对象编码；
- 组合装明细提供 bundle 的 ERP 组件与 quantity；
- ERP SKU 通过精确编码匹配；
- 销售明细不定义结构，也不参与 quantity 推导。

隔离生成结果：

| 指标 | 数量 |
|---|---:|
| Sales Object | 6,365 |
| single | 2,722 |
| bundle | 3,643 |
| Link SKU active 关联 | 31,769 |
| 结构版本 | 6,365 |
| 结构组件 | 10,425 |
| 未关联 Link SKU | 1,304 |
| 去重 ERP 组件 | 2,842 |
| 已有 Product 覆盖组件 | 2,842 |

源表中另有 2,199 行不能进入生成：833 行无法精确匹配现有 Link SKU，1,366 行不是商品行或缺少必要身份。它们被明确保留为未解析，不通过名称猜测或销售证据补齐。

第二次执行结果为：对象新增 0、结构新增 0、组件新增 0、关系新增 0，历史生成满足幂等。

## 4. ResolveLinkSkuSalesObject

新增旁路能力：

- `ResolveLinkSkuSalesObject`：单 Link SKU 解析；
- `ResolveLinkSkuSalesObjects`：批量解析并避免逐行查询。

标准结果包含 Sales Object、有效关系、结构版本、最终 ERP 组件、quantity、完整性与冲突。它只读取新模型，未注册为现有业务默认 Resolver。

对 31,769 个已关联 Link SKU 的影子比较结果：

| 分类 | 数量 |
|---|---:|
| 与旧 Resolver 完全一致 | 31,765 |
| 新模型新增解释 | 4 |
| 新模型减少 | 0 |
| 冲突 | 0 |

4 个新增解释为 `HP0754-3`、`HP0754-6`、`HP0497-9`、`HP0963-1`，均来自平台货品与组合装权威主数据；本阶段只记录旁路差异，不切换读取。

## 5. 销售金额安全

销售事实仍保持 11,548 条，销售额 1,327,063.9502，利润 624,038.6962。Sales Object 组件表没有销售额、利润或金额字段，因此组件不会自动继承、复制或累计销售金额。

销售金额仍归属销售事实/销售对象层；组件仅表达组成与数量。本阶段没有写入或重算任何销售事实。

## 6. 旧资产与数据保护

隔离生成前后以下资产计数完全一致：

- `sales_link_sku_erp_mappings`
- `sales_link_sku_product_structures`
- `sales_link_sku_product_structure_components`
- `connection_sku_sales_daily_facts`
- `erp_skus`
- `products`
- `product_erp_mappings`

旧 Link Product Structure 的 22,497 条 active 组件均能在新结构中找到等量组件。旧结构没有删除、冻结或改写。

数据库检查：`integrity_check=ok`，`foreign_key_check=0`。

## 7. 回滚方案

当前业务读取未切换，回滚不需要恢复业务数据：停止调用旁路 Resolver，删除四张新增表及其索引/触发器即可。现有 mapping、旧 Product Structure 和销售事实可继续独立运行。

正式生产生成数据前仍应创建数据库备份；本提交不包含生产发布或生产数据生成。

## 8. 当前状态与结论

正式 Schema、历史生成能力和旁路 Resolver 已实现，隔离验证满足：幂等、无旧关系减少、无 Resolver 冲突、金额不进入组件、旧资产不变、数据库完整。

当前状态为 **Schema ready / shadow only**。可以进入生产迁移审批与影子运行阶段，但尚不可切换产品中心、链接中心或其他业务读取。
