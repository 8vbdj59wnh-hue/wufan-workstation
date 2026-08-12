# V2-DATA-021 Resolver 全量切换前读取入口审计报告

## 1. 审计结论

当前系统尚未达到“所有 Link SKU → ERP 组件 → Product 解释均经过 `ResolveLinkSkuRelationRead`”的状态。

严格按 Git 当前版本判断：`ResolveLinkSkuRelationRead` 与组合 SKU 只读服务仍是 V2-DATA-020 的未提交工作区文件，没有生产 API 或页面入口。已提交的正式业务服务中，关系解释主要分为三类：

1. 调用旧 `ResolveLinkSkuErpRelation(s)`；
2. 直接查询 active `sales_link_sku_erp_mappings`；
3. 治理/审批服务直接读取 Link Product Structure 与 active mapping。

前端页面通过 API 消费服务端结果，没有发现前端直接查询数据库或自行推导 ERP 组件。全量切换的主要工作在服务端。

## 2. 分类口径

- **A**：已通过 `ResolveLinkSkuRelationRead`；
- **B**：直接读取 active mapping；
- **C**：直接读取 Link Product Structure；
- **D**：其他方式，包括旧 Resolver、daily facts 直接聚合、旧 `sales_link_skus.productId` 兼容链或不涉及关系解释。

daily facts 直接聚合不等于绕过 Resolver：只要功能仅展示已经写入的销售额、利润或排行，就不需要重新解释关系。只有展示组件、Product 归属或用关系筛选对象时才必须经过关系读取门面。

## 3. 读取入口清单

### 3.1 链接中心

| 位置 | 功能 | 当前读取方式 | 分类 | 是否经过统一门面 | 目标 |
|---|---|---|---|---|---|
| `linkBusinessTableService.js` | LinkBusinessTable 销售、利润、排行字段 | 直接聚合 `connection_sku_sales_daily_facts`；不解释组件 | D | 不需要 | 保持事实直读；若以后增加 Product/组件列，再接门面 |
| `linkSalesRankingService.js` | LinkSalesRanking | 直接按 `salesLinkId` 聚合 daily facts | D | 不需要 | 保持不变 |
| `linkSalesDistributionService.js` | LinkSalesDistribution | 直接按 `salesLinkId` 聚合 daily facts | D | 不需要 | 保持不变 |
| `connectionCorePageService.js` | LinkDataTable / 链接资产列表的关系数量、产品筛选、平台筛选 | 多处直接查 active mapping，并连接 Product Mapping | B | 否 | 关系数量、产品条件和平台反查需改为 Resolver 派生索引或批量门面 |
| `connectionCorePageService.js` | 链接详情 SKU 组件与 Product | 调用旧 `resolveLinkSkuErpRelations` | D（旧 Resolver） | 否 | 第二阶段直接改用统一门面 |
| `connectionDailySalesService.js` | 链接详情销售分析中的 ERP 组成展示 | 金额读取 daily facts；组件调用旧 Resolver | D（旧 Resolver） | 否 | 组件部分改用统一门面；金额保持事实直读 |
| `connectionBusinessCockpitService.js` | 经营驾驶舱 Product 归因/产品渠道贡献 | 调用旧 Resolver，再按 quantity 比例拆分事实金额 | D（旧 Resolver，高风险） | 否 | 最后切换；先冻结金额归因规则并专项验证 bundle，避免改变金额口径 |
| `connectionCorePageService.js` | 链接详情库存关联 | `connection_sku_inventory_facts` + 旧 `sales_link_skus.productId` | D（旧字段） | 否 | 与 Resolver 切换分开处理；不可把旧 Product 快捷字段当正式关系 |
| `connectionHospitalService.js` / `connectionGrowthService.js` | 链接医院、增长分析 | 经营事实和状态数据，不读取 mapping/结构 | D | 不涉及 | 无需切换 |
| `salesObjectComboSkuReadService.js`（未提交） | 组合 SKU 管理 | `ResolveLinkSkuRelationRead`，scope=`comboSkuManagement` | A | 是 | 第一批灰度候选；先提交、加 API/权限后才构成真实业务入口 |

前端对应入口位于 `connectionCenterPage.js`，通过 `connectionCenterService.js` / `appState.js` 调用上述 API。未发现前端自行解释关系。

### 3.2 产品中心

| 位置 | 功能 | 当前读取方式 | 分类 | 是否经过统一门面 | 目标 |
|---|---|---|---|---|---|
| `productCenterV2Service.js` | SKU 列表的 linkCount、platformSkuCount、平台筛选与平台集合 | 多处直接反查 active mapping | B | 否 | 不能简单逐 SKU 调 Resolver；需建立批量反向读取 Capability 或可重建派生索引 |
| `productCenterV2Service.js` | ERP SKU详情“关联链接” | 直接查询 active mapping | B | 否 | 改用“ERP组件 → Sales Object → Link SKU”的反向 Capability |
| `productCenterV2Service.js` | 产品/SKU销售表现 | 直接按 `daily_facts.erpSkuId` 聚合 | D | 不需要 | 保持事实读取，不因 Resolver 切换重算金额 |
| `productManagementV2Service.js` | Product Workspace 产品关联链接 | 先直接用 active mapping找候选，再用旧 Resolver确认 | B + D（旧 Resolver） | 否 | 先新增批量反向 Capability，再切门面；不能只替换函数名 |
| `productDailySalesService.js` / `queryDailySales.js` | 产品销售汇总、趋势、来源 | daily facts + `product_erp_mappings` | D | 不需要 | 保持事实口径 |
| `product_erp_mappings` | ERP SKU → Product | 正式产品档案关系，不是 Link SKU关系 | D | 不适用 | 保留；Sales Object Resolver输出组件后仍由它解析 Product |

前端 `productCenterPage.js` 只消费产品 API，没有自行读取 mapping。

### 3.3 财务中心

| 位置 | 功能 | 当前读取方式 | 分类 | 是否经过统一门面 | 目标 |
|---|---|---|---|---|---|
| `financeService.js` | 财务流水、利润表 | `finance_entries` 中既有 `productId/salesLinkId`；不读取 SKU mapping | D | 不涉及 | 不纳入 Resolver 切换 |
| `queryDailySales.js` 及销售驾驶舱相关 Capability | 销售利润汇总 | daily facts | D | 不需要 | 保持唯一销售事实口径 |
| `salesDailyFactPreviewService.js` | 销售日报预览/关系准入 | 旧 `resolveLinkSkuErpRelations` | D（旧 Resolver，写入前关键链路） | 否 | 暂时不能随展示读取一起切换；需独立写入准入验收 |
| `salesFactDataSyncAdapter.js` | 旧/兼容销售事实同步关系核验 | 直接查 active mapping | B | 否 | 先确认是否仍为生产写入口；若保留，必须改为统一准入 Capability |

财务经营展示本身不存在 Link SKU关系重算；最大风险在销售事实写入前的关系准入，而非财务页面。

### 3.4 AI 分析

| 位置 | 功能 | 当前读取方式 | 分类 | 是否经过统一门面 | 目标 |
|---|---|---|---|---|---|
| `index.js::aiEvidence` | 产品证据 | 调用 `getProductBusinessAnalysis` | D（间接旧依赖） | 否 | 随 Product Workspace底层切换，不单独改AI层 |
| `index.js::aiEvidence` | 链接证据 | 调用连接增长分析，不读取组件 | D | 不涉及 | 无需切换 |
| `aiOperationAssistantService.js` | 生成解释 | 使用已提供的事实快照，不查 mapping | D | 不涉及 | 保持只解释证据 |
| 公司经营证据 | 驾驶舱数据 | 可能间接消费 `connectionBusinessCockpitService` 的产品归因 | D（间接高风险） | 否 | 等驾驶舱归因切换稳定后再更新证据版本 |

AI不应直接调用 Resolver；应消费已经统一后的业务 Capability，并在证据快照记录 Resolver版本。

### 3.5 数据质量、导入与治理

| 位置 | 功能 | 当前读取方式 | 分类 | 是否经过统一门面 | 目标 |
|---|---|---|---|---|---|
| `salesDataQualityAnomalyGovernanceService.js` | 销售异常上下文 | 同时直读 Product Structure、active mapping并调用旧 Resolver | B + C + D | 否 | 暂不能直接切换；治理页面必须同时展示旧资产与新模型差异 |
| `salesDailyFactPreviewService.js` | 日报关系状态 | 旧 Resolver | D | 否 | 独立迁移，必须保证写入候选完全一致 |
| `queryErpSkuUsageCandidates.js` | ERP用途候选的正式关系证据 | 直接按 active mapping聚合 | B | 否 | 属于治理证据，改为反向 Capability，不应逐行Resolver |
| `productStructureApplicationApprovalService.js` | 结构审批与应用 | 直接比较/写 Product Structure和mapping | B + C | 否 | 这是旧资产维护流程，不应由读取门面替换；迁移期保留只读/写入职责 |
| `salesComboReviewService.js` | 旧 Combo审核 | 直接读写 combo与mapping | B + D | 否 | 旧治理资产，不能混入普通读取切换；后续单独冻结 |
| `linkSkuErpMappingService.js` / `salesRelationCandidateService.js` | 正式关系写入/确认 | 直接读写 mapping | B（写资产） | 不适用 | 写入口继续独立，不因读取切换删除 |

## 4. active mapping 直接读取清单

### 业务展示/筛选，必须迁移

- `connectionCorePageService.js`：链接列表关系数量、关系筛选、产品筛选、详情辅助统计；
- `productCenterV2Service.js`：平台筛选、链接数、平台 SKU数、ERP SKU反向链接详情；
- `productManagementV2Service.js`：Product → ERP SKU → Link SKU候选集合。

### 治理或写入校验，不能机械替换

- `salesDataQualityAnomalyGovernanceService.js`；
- `queryErpSkuUsageCandidates.js`；
- `salesFactDataSyncAdapter.js`；
- `productStructureApplicationApprovalService.js`；
- `salesComboReviewService.js`；
- `salesRelationCandidateService.js`；
- `linkSkuErpMappingService.js`。

后组需要明确“读取运行关系”与“查看/维护旧资产”的不同目的。全量业务读取切换不代表立即禁止治理服务读取旧表。

## 5. Link Product Structure 直接依赖

- 旧 `ResolveLinkSkuErpRelation`：验证 active mapping 与 Product Structure组件集合一致；
- `salesDataQualityAnomalyGovernanceService.js`：展示缺结构、缺组件、结构状态；
- `productStructureApplicationApprovalService.js`：审批、应用、审计和回滚旧结构。

这些依赖均未经过统一门面。旧 Resolver切换后，前两类需要分别处理：普通业务读取不再直接依赖；治理/迁移页面仍可在冻结期只读展示旧资产。审批写服务在旧结构停止写入前不能删除。

## 6. Product Relation 依赖

`product_erp_mappings` 是 ERP组件到 Product 的正式关系，应继续保留。需要退出的是以下旧或旁路解释：

- `sales_link_skus.productId`：链接库存/图片等兼容读取；
- active mapping的直接反向查询：产品中心链接数、平台筛选、关联链接；
- `connectionBusinessCockpitService` 按 mapping quantity 分摊金额的产品归因。

Sales Object切换不能改变 Product身份，也不能把 Sales Object当作Product。

## 7. 切换风险分级

### 可以直接切换

- 新组合 SKU 管理，只读、默认 Flag关闭；
- 链接详情中的 ERP组件展示；
- 链接详情中的 Product集合展示。

条件：统一门面保持旧输出契约，冲突回退旧结果，新增差异记录日志。

### 需要先改造

- LinkDataTable的关系数量和Product筛选；
- 产品中心平台筛选、链接数量、关联链接；
- Product Workspace反向链接查询。

原因：这些是 ERP SKU → Link SKU 的反向批量查询。当前门面只解决 Link SKU →组件，逐产品调用会产生N+1。必须先增加批量反向 Capability或Sales Object派生索引。

### 暂时不能切换

- `connectionBusinessCockpitService` 产品渠道金额归因；
- 销售日报预览和事实写入准入；
- 数据质量/关系治理；
- Product Structure审批和旧 Combo审核。

原因分别是金额分摊、事实写入可信度和旧资产维护职责。必须专项验证，不能作为普通展示读取一起替换。

### 无需切换

- LinkBusinessTable的销售金额/利润字段；
- LinkSalesRanking；
- LinkSalesDistribution；
- 产品销售趋势和汇总；
- 财务流水；
- 链接医院中不涉及商品组成的状态分析。

这些功能读取正式事实，不应为了Resolver统一而重新计算事实。

## 8. 推荐全量切换顺序

1. **提交并发布默认关闭门面**：完成 V2-DATA-020 独立提交、API权限和结构化日志落点；生产仍使用旧路径。
2. **正向详情读取**：链接详情组件、产品集合、组合 SKU 管理；按scope灰度。
3. **建立反向批量Capability**：支持 ERP SKU/Product → Sales Object → Link SKU，替换产品中心和LinkDataTable直查mapping，避免N+1。
4. **产品中心读取切换**：平台筛选、链接计数、产品关联链接；销售指标继续读取daily facts。
5. **经营归因专项切换**：冻结Sales Object销售额归属规则，验证bundle金额不复制后再切驾驶舱产品渠道贡献。
6. **销售写入准入专项切换**：重新跑完整预览、幂等、金额守恒和事务回滚；这一步独立于页面切换。
7. **治理与旧资产冻结**：业务读取全部稳定后，治理页面改为Sales Object主模型；旧Product Structure和mapping进入只读兼容，最后才讨论退出。

每阶段均应保持独立scope、默认关闭、双读日志和即时回滚。

## 9. 验收保护建议

全量切换必须分别验证：

- 销售额、利润直接来自daily facts，切换前后完全一致；
- LinkBusinessTable、LinkSalesRanking、LinkSalesDistribution结果不因组件解析改变；
- 链接详情组件与Product集合无减少、无冲突；
- Product Workspace产品覆盖不下降，反向链接结果可解释；
- bundle金额只归Sales Object一次，组件仅携带quantity；
- 组合 SKU管理继续使用批量Resolver，无N+1；
- 销售预览/写入候选必须另行验证，不继承页面灰度结论。

## 10. 最终判断

当前属于：**统一门面已在工作区实现，但生产业务读取尚未迁移；核心详情仍用旧Resolver，列表和产品反向关系仍大量直读active mapping。**

因此不能直接执行Resolver全量切换。最小下一步是先提交默认关闭的V2-DATA-020门面，然后只迁移链接详情正向读取；与此同时设计反向批量Capability。排行、分布和纯事实查询无需修改。
