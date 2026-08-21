# Architecture Upgrade-003 Product销售贡献口径 Phase 8验收报告

## 1. 结论

Phase 8已在隔离的完整生产数据副本上建立统一 `QueryProductContribution` 读模型，并将产品中心、产品详情、产品健康、AI产品证据、经营驾驶舱、销售驾驶舱产品排行及通用Product销售查询迁移到新口径。

正式口径：

- `Direct Sales Quantity` = Single Sales Object的Daily Fact数量。
- `Bundle Contribution Quantity` = Bundle Daily Fact数量 × 按销售日期选择的BOM组件数量。
- `Total Physical Contribution` = Direct + Bundle Contribution。
- Product销售额、成本、利润 = 仅Single直接事实。
- Bundle销售额、成本、利润始终留在原始Bundle Daily Fact，不分摊给Component Product。

本阶段未修改数据库Schema或任何正式事实，也未改变Phase 7B Feature Flag。最终启用复核确认：2,943条历史Bundle事实虽然没有旺店通当日`exact`有效期，但Component、Quantity和Product Mapping均明确，且不存在导致贡献数量不确定的结构冲突；正式指标持续保留`inferred`证据等级，不冒充`exact`。

> **可以正式启用Product新销量口径**

## 2. 现有口径审计与差异

| 位置 | 修改前的“销量/贡献” | 问题 | Phase 8正式口径 | 处理 |
|---|---|---|---|---|
| `productBusinessReadModel.salesMetrics` | Daily Fact `erpSkuId → Product` | Bundle父事实会被当成某一Component Product的销量和金额 | Contribution Read Model | 仅留在`item.sales.legacy`兼容区 |
| 产品中心列表 | 单一“销量/销售额” | 无法分辨直接销售与Bundle实际消耗 | 直接销量、组合贡献、实际出货、直接销售额 | 已迁移 |
| 产品详情/销售日报 | 依赖Product维度的`fact.erpSkuId` | Bundle金额可能进入Product | 直接数量/金额 + Bundle物理贡献 + BOM证据 | 已迁移 |
| 产品健康/滞销/生命周期 | 含混合口径的销量 | Bundle参与Product可被误判无动销 | `Total Physical Contribution` | 已迁移趋势、分类和健康证据；金额仍仅直接事实 |
| AI产品证据 | 沿用产品经营模型 | AI无法区分数量类型 | 四个显式字段 + Bundle参与与BOM证据 | 已迁移 |
| 经营驾驶舱 | 原Daily Fact数量按日直接汇总 | Bundle套数不等于Product实际出货 | Product实际出货贡献趋势 | 已迁移 |
| 销售驾驶舱产品排行 | Product维度Daily Fact直接汇总 | Bundle经济事实误归Product | Single直接销售额/利润排行 | 已迁移 |
| 链接驾驶舱Product Channel | 按Component Quantity比例分摊Bundle销售额/利润 | 没有经业务确认的Allocation Rule | 仅Single直接经济事实 | 已停止正式分摊 |
| `QueryDailySales(product)` | `fact.erpSkuId → Product` | 通用查询继续泄露旧口径 | contract v2.0 + Product Contribution | 摘要、趋势、排行、对比均已迁移 |
| 链接/SKU经营页 | 原始Link/Link SKU Daily Fact | 这是正确的销售对象口径 | 保持原始事实 | 未改变 |

`scripts/compare-connection-cockpit-product-attribution.js` 仍保留历史数量分摊公式，但它只是历史差异诊断脚本，不在正式服务请求路径。

## 3. 统一Read Model

`QueryProductContribution` 返回：

| 字段 | 语义 |
|---|---|
| `productId` | Product身份 |
| `directSalesQuantity` | Single直接销售数量 |
| `bundleContributionQuantity` | Bundle销售套数 × BOM组件数量 |
| `totalPhysicalContribution` | Direct + Bundle Contribution |
| `directSalesAmount/directCost/directProfit` | 仅Single经济事实 |
| `bundleParticipationCount` | Product参与的Bundle销售事实次数 |
| `contributingBundleCount` | 参与Bundle去重数 |
| `bomEvidenceLevel` | `exact / legacy_evidence / inferred / unknown` |
| `unallocatedContribution` | 结构可展开但Product Mapping缺失/冲突的物理贡献 |

数据链仅使用：

`connection_sku_sales_daily_facts`
→ `sales_link_sku_sales_object_relations`
→ `sales_objects`
→ `sales_object_structures / components / effective_periods`
→ `product_erp_mappings`
→ `products`

新口径不读Legacy Mapping或Legacy Product Structure。如果有日期有效期证据，按销售日期选版；否则`combo_master_excel`来源标记`legacy_evidence`，当前旺店通BOM用于历史日期时严格标记`inferred`，不冒充`exact`。

## 4. 真实数据影子计算

隔离数据库：`/private/tmp/architecture-upgrade-003-phase8-source.db`，源副本SHA256：`db067feda0cf003720ef79b4431b87e55ae088f0650b8faeea8d58d214e266cb`。销售周期：2026-07-09至2026-08-17。

| 指标 | 结果 |
|---|---:|
| 有Direct Sales的Product | 926 |
| 有Bundle Contribution的Product | 373 |
| 同时有两类销量的Product | 341 |
| 只有Bundle Contribution的Product | 32 |
| Direct Sales Quantity | 21,338 |
| Bundle Contribution Quantity | 28,472 |
| Total Physical Contribution | 49,810 |
| 无法分配Product的组件贡献 | 0 |
| 涉及Bundle销售事实 | 3,288 |
| BOM可解释Bundle事实 | 3,288 / 3,288 = 100% |
| 涉及销售的不同Bundle | 500 |

过去只看直接销量会低估 **373个Product**：其中341个少计Bundle贡献，32个会被完全误判为无销量。

### BOM证据

| 证据 | Bundle销售事实 | Product组件贡献记录 |
|---|---:|---:|
| exact | 0 | 0 |
| legacy_evidence | 345 | 659 |
| inferred | 2,943 | 5,721 |
| unknown | 0 | 0 |

所有Bundle事实都能展开，但没有历史有效期记录可以将历史销售标成`exact`。这不影响当前物理贡献计算，但是正式全量切换前应继续影子观察的主要证据风险。

## 5. 经济事实保护

| 指标 | 计算前 | Read Model | 计算后 | 结果 |
|---|---:|---:|---:|---|
| Daily Facts | 14,927 | 14,927 | 14,927 | 一致 |
| 公司销售额 | 1,714,533.2059 | 1,714,533.2059 | 1,714,533.2059 | 一致 |
| 公司成本 | 755,806.6715 | 755,806.6715 | 755,806.6715 | 一致 |
| 公司利润 | 814,440.1357 | 814,440.1357 | 814,440.1357 | 一致 |

其中Single经济事实：11,639条，销售额1,458,028.9397，成本634,750.9517，利润695,472.6580。Bundle经济事实：3,288条，销售额256,504.2662，成本121,055.7198，利润118,967.4777，全部保留在Bundle事实，没有进入Component Product。

## 6. 样本核对

程序按`Daily Fact → Sales Object → BOM → ERP SKU → Product → Contribution`逐层核对了20个Single、20个Single×N Bundle、20个多组件Bundle参与Product及10个Direct+Bundle Product。

### Single样本（20）

| Sales Object | Product | Fact Qty | Component Qty | Contribution |
|---|---|---:|---:|---:|
| HP0601-5 | 美式复古冰裂青花瓷 | 1 | 1 | 1 |
| HP0909-2 | 绿意盎然碎花瓶 | 1 | 1 | 1 |
| HP0121-5 | 透明玻璃花瓶 | 2 | 1 | 2 |
| HP0963-1 | 烟紫织云瓶 | 1 | 1 | 1 |
| HP0218-11 | 黑白色中古花瓶 | 5 | 1 | 5 |
| HP0393-4 | 简约复古花瓶 | 1 | 1 | 1 |
| HP0783-2 | 有钱花瓶 | 1 | 1 | 1 |
| HP0214-7 | 原色玻璃花瓶 | 1 | 1 | 1 |
| HP0977-1 | 红胭脂瓶 | 1 | 1 | 1 |
| HP0926-1 | 琥珀双影瓶 | 1 | 1 | 1 |
| HP0121-4 | 透明玻璃花瓶 | 1 | 1 | 1 |
| HP0589-8 | 亚克力直筒 | 2 | 1 | 2 |
| HP0647-4 | 田园风陶艺花瓶 | 1 | 1 | 1 |
| HP0782-2 | 轻粉流云瓶 | 1 | 1 | 1 |
| HP0217-5 | 竹节直筒款花瓶 | 2 | 1 | 2 |
| HP0589-8 | 亚克力直筒 | 1 | 1 | 1 |
| HP0269-5 | 情之泪叉楞 | 1 | 1 | 1 |
| HP0697-2 | 中式粗陶白罐 | 2 | 1 | 2 |
| HP0601-4 | 美式复古冰裂青花瓷 | 1 | 1 | 1 |
| HP0667-1 | 荷叶边琉璃蓝 | 2 | 1 | 2 |

### Single Component × N Bundle样本（20）

| Bundle | Product | Bundle Qty | BOM Qty | Contribution |
|---|---|---:|---:|---:|
| FZH0140-4 | 仿真蒴槿干花壳 | 5 | 5 | 25 |
| FZH0161-22 | 重瓣小百合 | 5 | 5 | 25 |
| FZH0177-12 | 3叉玲珑桔梗花 | 5 | 5 | 25 |
| FZH0183-3 | 仿真花苹果枝 | 3 | 3 | 9 |
| FZH0164-7 | 欧式三头牡丹A级 | 9 | 3 | 27 |
| FZH0174-7 | 2叉大叶水仙花 | 10 | 5 | 50 |
| FZH0177-8 | 3叉玲珑桔梗花 | 5 | 5 | 25 |
| FZH0177-14 | 3叉玲珑桔梗花 | 5 | 5 | 25 |
| FZH0161-13 | 重瓣小百合 | 8 | 4 | 32 |
| FZH0177-6 | 3叉玲珑桔梗花 | 5 | 5 | 25 |
| FZH0177-13 | 3叉玲珑桔梗花 | 7 | 7 | 49 |
| FZH0129-14 | 雪柳 | 5 | 5 | 25 |
| FZH0201-2 | 仿真梨花 | 2 | 2 | 4 |
| FZH0140-3 | 仿真蒴槿干花壳 | 3 | 3 | 9 |
| FZH0129-19 | 雪柳 | 7 | 7 | 49 |
| FZH0140-3 | 仿真蒴槿干花壳 | 6 | 3 | 18 |
| FZH0129-4 | 雪柳 | 3 | 3 | 9 |
| FZH0140-3 | 仿真蒴槿干花壳 | 3 | 3 | 9 |
| FZH0187-2 | 仿真米兰果 | 5 | 5 | 25 |
| FZH0140-3 | 仿真蒴槿干花壳 | 3 | 3 | 9 |

### 多组件Bundle样本（20条Product贡献）

| Bundle | Product | Bundle Qty | BOM Qty | Contribution |
|---|---|---:|---:|---:|
| HP0978-3 | 春涧青樱 | 3 | 1 | 3 |
| HP0978-3 | 春涧星空 | 3 | 1 | 3 |
| HP0497-11 | 陶瓷石榴花瓶（组件1） | 1 | 1 | 1 |
| HP0497-11 | 陶瓷石榴花瓶（组件2） | 1 | 1 | 1 |
| HP0662-7 | 仿真蒴槿干花壳 | 3 | 3 | 9 |
| HP0662-7 | 白霜陶罐 | 3 | 1 | 3 |
| HP0601-7 | 美式复古冰裂青花瓷 | 3 | 1 | 3 |
| HP0601-7 | 仿真马桑果 | 3 | 3 | 9 |
| HP0473-7 | 新中式斑驳陶罐（组件1） | 2 | 1 | 2 |
| HP0473-7 | 新中式斑驳陶罐（组件2） | 2 | 1 | 2 |
| HP0473-7 | 新中式斑驳陶罐（组件3） | 2 | 1 | 2 |
| HP0647-12 | 田园风陶艺花瓶（组件1） | 1 | 1 | 1 |
| HP0647-12 | 田园风陶艺花瓶（组件2） | 1 | 1 | 1 |
| HP0316-7 | 波浪流川花瓶（组件1） | 2 | 1 | 2 |
| HP0316-7 | 波浪流川花瓶（组件2） | 2 | 1 | 2 |
| HP0473-13 | 仿真蒴槿干花壳 | 3 | 3 | 9 |
| HP0473-13 | 新中式斑驳陶罐 | 3 | 1 | 3 |
| ZH0161-12 | chic fun创意异形花瓶 | 1 | 1 | 1 |
| ZH0161-12 | 仿真吊钟 | 1 | 1 | 1 |
| HP0473-7 | 新中式斑驳陶罐 | 2 | 1 | 2 |

### Direct + Bundle Product样本（10）

| Product ID后缀 | Direct | Bundle | Total | Bundle数 | 证据 |
|---|---:|---:|---:|---:|---|
| 1001 | 2 | 144 | 146 | 1 | inferred |
| 1004 | 1 | 108 | 109 | 2 | inferred |
| 1007 | 1 | 3 | 4 | 1 | inferred |
| 1015 | 4 | 28 | 32 | 2 | inferred |
| 1016 | 6 | 60 | 66 | 4 | inferred |
| 1017 | 1 | 1 | 2 | 1 | inferred |
| 1023 | 90 | 36 | 126 | 3 | legacy_evidence |
| 1024 | 41 | 10 | 51 | 1 | legacy_evidence |
| 1025 | 78 | 18 | 96 | 2 | legacy_evidence |
| 1026 | 178 | 37 | 215 | 4 | inferred |

## 7. 页面、AI与兼容

- 产品中心列表：拆分直接销量、组合贡献和实际出货；金额标成直接销售额/直接毛利润。
- 产品详情：增加参与的Bundle、销售套数、贡献数量和BOM证据。
- 产品健康、滞销、生命周期：数量层使用Total Physical Contribution；盈利层仅使用Single直接事实。
- AI产品证据：可见Direct、Bundle、Total、直接金额及BOM证据，并显式声明`bundleAllocation = none`。
- 经营驾驶舱：产品趋势和排行使用实际出货；公司销售额/利润仍为原始Daily Facts。
- 销售驾驶舱：产品排行仅Single直接金额/利润。
- 兼容：`ProductBusinessReadModel.item.sales.amount/quantity`和`summary.salesAmount/salesQuantity`保留原语义，新调用方使用`direct* / bundle* / totalPhysicalContribution`。`QueryDailySales(product)`以contract v2.0明确切换，其他维度不变。

## 8. 性能与幂等

| 场景 | 完整生产副本实测 |
|---|---:|
| 全历史14,927事实Contribution聚合 | 最新验证104ms；多轮观察约92–324ms |
| 相同全量重复计算 | 约92–123ms |
| 单Product详情（6条相关事实） | 约45–64ms |

读模型不新建事实表，支持按Product缩小事实范围。相同输入连续运行返回完全相同结果，Daily Facts数量和金额不变。

## 9. 测试与数据保护

| 验证 | 结果 |
|---|---|
| Phase 8单元/迁移测试 | 20/20通过 |
| `npm run test:product-business` | 28/28通过 |
| `npm run check:product-business` | 通过 |
| `npm run check` | 完整通过（临时本地服务需在正常进程环境运行；沙箱内会提前回收子进程） |
| `git diff --check` | 通过 |
| 隔离库`integrity_check` | ok |
| 隔离库`foreign_key_check` | 0条 |
| Legacy正式读写门禁 | riskCount = 0 |
| Daily Facts/销售额/成本/利润 | 修改前后完全一致 |
| Phase 7B Feature Flag | 本次代码未修改；Shadow ON / Projection ON / Relation Write OFF / Relation Read OFF保持 |

## 10. 十二个验收回答

1. **当前混淆**：原Product查询将`fact.erpSkuId`直接映射Product，会混合Single销量、Bundle套数、Bundle组件实际消耗和Bundle经济事实。
2. **Direct Sales Quantity**：准确；926个Product，合计21,338。
3. **Bundle Contribution Quantity**：准确；支持Single×N、多组件及多ERP SKU合并到同一Product，合计28,472。
4. **Total Physical Contribution**：准确；21,338 + 28,472 = 49,810。
5. **被低估Product**：373个，其中32个仅Bundle贡献。
6. **Bundle贡献可解释性**：3,288 / 3,288 = 100%；证据严格区分legacy/inferred，不冒充exact。
7. **Product Mapping缺失**：当前实数为0；读模型已支持`product_mapping_missing / conflict → unallocatedContribution`。
8. **旧金额分摊**：链接驾驶舱存在按Component Quantity比例拆分销售额/利润；另有Product维度`fact.erpSkuId`直归造成的隐性错配。
9. **未确认金额分摊**：已退出正式Product口径；仅历史对比脚本保留诊断公式。
10. **公司金额保护**：销售额1,714,533.2059、成本755,806.6715、利润814,440.1357，修改前后完全一致。
11. **产品中心/驾驶舱/AI**：已统一使用Product Contribution；公司和Link仍保持原始销售事实。
12. **是否可正式切换**：可以。功能、准确性、性能和事实保护均已通过；历史Bundle中2,943条保留`inferred`证据等级，不以缺少当日`exact`证据否定可确定的物理贡献数量。

## 11. 正式启用边界

- 对`inferred`和`legacy_evidence`历史BOM持续保留证据标识，不因追求精确率伪造有效期。
- Product金额、成本和利润仅来自Single直接事实；Bundle经济事实不得拆分给Component Product。
- 正式启用仅切换Product读取与展示口径，不修改Daily Facts、Relation、BOM历史或任何Feature Flag。
