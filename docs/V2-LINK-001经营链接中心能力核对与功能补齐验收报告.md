# V2-LINK-001 经营链接中心能力核对与功能补齐验收报告

## 结论

本次以当前源码、SQLite schema、后端路由和页面调用为准完成核对。未新增业务数据表，未修改负责人、销售、提成、诊断、分级或导入规则。唯一补齐的是 `LinkSalesRanking`：直接聚合 `connection_sku_sales_facts`，通过 `connection_profiles.ownerId` 实现 `mine/company` 范围，并注册标准 UI 模块 `link_sales_ranking`。

状态定义：A 已完整存在；B 已存在但不完整；C 数据/能力已有、只缺 UI 模块；D 完全缺失；E 与现有业务规则冲突或缺少唯一口径，需先确认。

## 能力矩阵

| 功能 | Data | Capability | Module / 页面 | 原状态 | 本次处理 | 后续 UI |
|---|---|---|---|---|---|---|
| 我的负责链接数 | `connection_profiles.ownerId` | `getMyConnectionWorkbench` | 我的链接 | A | 保持 | 可随最终设计调整 |
| 昨日销售总额 | `connection_sku_sales_facts` | 可按日查询，但原页面仅显示最新周期 | 我的链接 | B | 由统一排行选择自定义昨日读取；不伪装无数据为 0 | 需要最终概览设计 |
| 昨日提成金额 | 未发现提成规则/提成事实 | 无唯一 Capability | 无 | E | 不自行创建第二套提成口径 | 先确认提成数据源与规则 |
| 链接状态分布 | `connection_profiles.status`、经营健康分析 | `getMyConnectionWorkbench` | 我的链接摘要 | A | 保持 | 否 |
| 待处理问题数 | 诊断、改善、健康记录 | `getConnectionHospital` | 链接医院/我的链接 | A | 保持 | 否 |
| 我的链接列表 | 链接档案、负责人、销售事实 | `getMyConnectionWorkbench` | 我的链接 | A | 保持 | 否 |
| 链接销售额排行 | 销售事实、链接、负责人 | 原有排行只基于平台经营周期，缺少 7/30/自定义及统一 Scope | 无标准模块 | B | 新增 `LinkSalesRanking` Capability/API/Module | 基本 UI 已可用，后续可视觉优化 |
| 全部链接 | 链接资产及经营事实 | `listConnectionCoreProfiles` 等 | 链接资产 | A | 排行模块接入；公司范围仅管理员 | 可调整名称为“全部链接” |
| 展现/点击/转化/客单价 | `connection_period_snapshots` | 成长分析、V3 metrics | 详情/医院 | A | 保持 | 否 |
| 问题识别/诊断 | 健康记录、诊断条目 | 健康评分、加入诊断 | 链接医院 | A | 保持规则 | 否 |
| 优化记录、任务/行动关联 | `connection_improvements`、流程与任务 | 改善行动/状态流转 | 链接医院 | A | 保持 | 否 |
| 链接分级 | `connection_profiles.level` | 档案更新支持人工等级 | 详情未形成独立分级页 | B | 仅审计，不重定义 | 规则确认后设计 |
| 经营健康状态 | 平台快照、财务事实 | `connectionGrowthService` | 多页面 | A | 保持 | 否 |
| 数据更新 | 导入批次、同步批次、异常、模板 | 多套已发布导入/同步 Capability | 数据导入/数据中心 | A | 保持 | 普通运营状态可再简化 |

## 当前真实规则

### 我的链接与权限

- 负责人唯一关系为 `connection_profiles.ownerId -> persons.id`。
- 普通用户只读取 `ownerId` 等于当前人员的链接；管理员可读取全部。
- `links.view`（兼容 `products.view`）保护读取，管理和导入使用已有权限，不新增权限。
- 新排行的 `mine` 沿用负责人关系；`company` 只允许管理员，避免扩大普通运营的数据范围。

### 销售与提成

- 真实销售来自 `connection_sku_sales_facts`，身份为 `salesLinkId + salesLinkSkuId + erpSkuId + period`。
- 新排行只聚合所选日期范围内已有销售事实，不创建、复制或换算销售数据。
- 代码和 schema 中没有链接提成规则、提成比例或提成事实。`finance_rules` 是财务收支分类规则，不是运营提成规则。因此“昨日提成”当前为 E，必须业务确认后另立任务。

### 链接医院

- 展现、访客、购物车、买家、转化率、支付额等来自 `connection_period_snapshots`。
- 销售与利润来自 V2 销售事实；成长分析复用现有两期比较。
- 当前健康评分：销售增长 40、访客增长 30、转化变化 30；80/60/40 分界对应 growing/stable/attention/risk。
- 医院流程由 `connection_diagnosis_entries`、`connection_health_records`、`connection_improvements`、流程实例和任务组成，是真实 Capability，不只是页面。
- 诊断阈值属于既有业务规则，本次未修改。

### 链接分级冲突

系统当前并非一套“爆款/热销/动销/滞销”链接分级：

1. `connection_profiles.level`：`new/growing/mature/priority`，是可人工更新的档案等级，没有发现自动计算周期。
2. 成长健康状态：`growing/stable/attention/risk`，由最近两个平台经营周期自动计算。
3. 产品中心“爆款区/动销区”等是 ERP SKU/产品经营分区，不是链接分级。

三者语义不同但页面文字容易混淆。当前无法把“爆款/热销/动销/滞销”直接定为链接等级；需先确认唯一业务定义、周期和切换机制，本次不强行统一。

### 数据更新

- 平台链接数据、平台货品关系、销售利润、负责人匹配均有预览—确认—异常隔离流程。
- API 同步与 Excel 导入的批次、日志、异常保留在数据中心。
- 普通运营页面已经有业务导入口，但“最近更新时间/当前数据日期/最近导入结果”尚未形成一个统一摘要 Capability，状态为 B；可以后续只读聚合现有批次，不重写导入体系。

## 本次新增

- Data：无。
- Capability：`LinkSalesRanking` / `getLinkSalesRanking`。
- API：`GET /api/link-sales-ranking?scope=mine|company&preset=7d|30d|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`。
- Module：`link_sales_ranking`（Module Registry，domain=`business_links`）。
- 页面：基本可用模块接入“我的链接”和“链接资产”；按需进入栏目后请求，不增加经营中心首屏请求。

## 验证

- 隔离 SQLite：两名负责人、两条链接、两条销售事实。
- `mine`：只返回当前负责人链接，合计 200。
- `company`：管理员返回两条，按 500/200 排序，合计 700。
- 普通用户请求 `company`：403。
- `integrity_check=ok`，`foreign_key_check=0`。
- 未写入生产数据库；未新增迁移。
- 业务规则变更：无。

## 后续优先级

1. 先确认提成唯一规则和来源，再实现昨日提成。
2. 冻结链接分级的业务定义；不要把产品分区、健康状态和人工等级直接合并。
3. 为数据更新增加只读摘要 Capability（最近更新时间、数据日期、成功状态），再做最终 UI。
4. 最后进行经营链接中心整体视觉设计。
