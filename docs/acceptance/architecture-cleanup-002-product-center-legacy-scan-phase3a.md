# Architecture Cleanup-002 产品中心旧逻辑扫描 Phase 3A报告

审计日期：2026-08-20
审计范围：产品中心页面、前端数据调用、产品相关API、Service及SQL读取链
执行边界：只读扫描；未修改业务代码、数据库或功能

## 一、结论

产品中心目前不是单一经营读取链，而是“新主链已建立、旧链仍可调用”的过渡状态。

- 新的产品经营看板、SKU列表、销售日报、库存详情、关联链接和只读健康分析，已经建立在 `connection_sku_sales_daily_facts + Sales Object + erp_sku_inventory_daily_summaries` 上，可以作为迁移目标。
- 旧产品详情经营分析、旧产品概览、手工“生成经营体检”和AI产品证据仍读取 `erp_fact_snapshots / product_daily_snapshots / product_erp_daily_snapshots`。
- 当前三张旧经营快照表均为0行，因此旧链不是可继续维护的正式经营来源；恢复或补造旧快照也不应成为迁移方案。
- 旧“生成经营体检”会基于旧分析结果写入 `product_health_records / product_issues`。这是当前最高优先级风险：它不仅可能显示空数据，还可能把空口径或旧口径固化成经营结论。
- 经营数据中心的产品趋势、滞销和资金占用业务语义可以保留，但应作为产品中心新读模型的派生视图，不应搬运旧快照实现。

建议进入后续实施，但顺序必须是：先统一产品详情和健康分析读取，再迁移趋势/滞销/资金占用，最后退役旧入口和兼容API。

## 二、当前数据基线

| 数据资产 | 当前状态 | 正式定位 |
|---|---:|---|
| `products` | 2,958 | 产品档案 |
| `connection_sku_sales_daily_facts` | 11,548行 | 正式销售事实 |
| 销售日期 | 2026-07-09至2026-08-09 | 32个自然日期范围 |
| 销售额 / 利润 | ¥1,327,063.9502 / ¥624,038.6962 | 产品销售经营口径 |
| 有销售的ERP SKU | 909 | daily facts实际覆盖 |
| `sales_objects` | 6,365 | 正式销售对象关系 |
| `erp_sku_inventory_daily_summaries` | 10,063行 | 当前库存事实汇总 |
| 库存日期 | 2026-08-05至2026-08-14，共10个业务日期 | 暂不足30/60日连续判断 |
| 有库存汇总的ERP SKU | 6,157 | 当前库存覆盖 |
| `erp_fact_snapshots` | 0 | 旧快照，无可用数据 |
| `product_daily_snapshots` | 0 | 旧产品经营快照，无可用数据 |
| `product_erp_daily_snapshots` | 0 | 旧产品ERP快照，无可用数据 |
| `product_health_records` | 0 | 当前无历史经营体检记录 |
| `product_issues` | 0 | 当前无历史问题记录 |

## 三、产品中心正式调用链扫描

### 3.1 已使用新架构的读取

| 能力 | 前端/API | Service | 真实来源 | 分类 |
|---|---|---|---|---|
| 产品经营分析看板 | `/api/product-management/business-dashboard` | `ProductBusinessReadModel` | daily facts、Sales Object、当前库存汇总 | A 保留 |
| SKU列表与分页 | `/api/product-center-v2/skus` | `productCenterV2Service` | daily facts、当前库存、Sales Object关系 | A 保留 |
| SKU详情 | `/api/product-center-v2/skus/:id` | `getProductCenterV2SkuDetail` | daily facts、库存日汇总、Sales Object链接关系 | A 保留 |
| 产品销售日报 | 产品销售表现接口 | `productDailySalesService` | daily facts | A 保留 |
| 产品只读健康分析 | `/api/product-management/products/:id/health-analysis` | `getProductHealthAnalysis` | ProductBusinessReadModel | A 保留 |
| 产品经营诊断 | `/api/product-management/products/:id/business-diagnosis` | `productBusinessDiagnosisService` | ProductBusinessReadModel | A 保留 |
| 产品库存 | 产品库存查询 | `inventorySupplyQueryService` | `erp_sku_inventory_daily_summaries` | A 保留 |
| 产品关联链接 | 产品关系查询 | Sales Object Resolver读取门面 | Sales Object结构与Link SKU关系 | A 保留 |
| 生命周期/改善记录 | 产品Workspace | 生命周期与改善Service | 产品事件、改善行动 | A 保留 |

这些能力已经形成可复用的新链，后续迁移不需要新建第二套经营表或第二套关系模型。

### 3.2 仍依赖旧逻辑的正式可调用点

| 位置 | 当前调用 | 旧依赖 | 影响 | 分类 |
|---|---|---|---|---|
| 产品详情 | `GET /api/product-management/products/:id` | `getProductV2Detail → getProductBusinessAnalysis → latestProductSnapshots` | 详情销售、库存和周转可能为空或与看板口径不同 | B 重构迁移 |
| 产品经营概览API | `GET /api/product-management/overview` | 旧快照；无快照时回退 `latestStateJson` | 与daily facts不一致；前端主流程疑似已不调用 | C 删除候选，先核实调用归零 |
| 手工经营体检 | `POST /api/product-management/products/:id/evaluate` | 旧 `getProductBusinessAnalysis` | 会持久化旧/空指标结论 | B 优先迁移 |
| AI产品证据 | `aiEvidence(type=product)` | 旧 `getProductBusinessAnalysis` | AI证据可能为空或引用旧口径 | B 重构迁移 |
| 产品详情前端 | `refreshProductManagementDetail`、`renderProductBusinessTab` | 旧详情API返回的 `detail.analysis` | 与新健康分析Tab并存，形成双口径 | B 重构迁移 |
| 旧分析跳转 | `open-product-analysis → #dataCenter` | 旧经营数据中心页面 | 将用户带回待退役模块 | C 删除候选 |
| 历史快照按钮 | `generateErpSyncSnapshot` | ERP旧快照生成接口 | 容易重新激活旧经营链 | C 删除候选，待其他消费者迁完 |

### 3.3 旧概览前端的真实状态

`renderProductManagementOverview` 和 `refreshProductManagementOverview` 仍保留在 `productCenterPage.js`，但扫描没有发现实际调用点；`productManagementState.overview` 仍被少量辅助展示逻辑引用。

判断：这是高可信度死代码候选，但删除前仍需通过浏览器路由、权限角色和事件动作做一次运行覆盖验证，不能仅凭文本扫描直接删除。

## 四、旧快照与旧证据链

### 4.1 旧产品分析核心

`productManagementV2Service` 中的旧链为：

```text
erp_fact_snapshots
  → product_daily_snapshots
  → product_erp_daily_snapshots
  → getProductBusinessAnalysis
  → 产品详情 / 经营体检 / AI产品证据
```

主要问题：

1. 当前三张快照表均无数据。
2. 旧 `sales30d` 来自ERP同步/快照语义，不等于daily facts的正式销售事实。
3. 旧详情中的 `finance_entries` 净利润，与daily facts的销售利润不是同一指标，迁移时不得互相覆盖。
4. 产品链接关系虽已部分改用Sales Object，但销售和库存仍来自旧快照，属于“关系新、经营事实旧”的混合实现。

### 4.2 旧经营体检写入风险

`evaluateProductHealth` 读取旧 `getProductBusinessAnalysis` 后写入 `product_health_records` 和 `product_issues`。应迁移为：

```text
ProductBusinessReadModel
  → getProductHealthAnalysis
  → 明确规则版本、证据日期和事实来源
  → product_health_records / product_issues
```

历史字段和历史记录可以继续只读，但新记录不得再引用旧快照ID或旧 `sales30d` 口径。

`createProductHealthAction` 与上述旧体检不同：它接收新健康分析并形成改善证据，仍有业务价值，应保留，不应随旧 `evaluateProductHealth` 一并删除。

### 4.3 产品中心之外的间接依赖

以下服务仍直接读取或声明旧快照：

- `operationManagementService`：经营驾驶舱产品销量、库存、排名和趋势。
- `supplyChainService`：供应链库存与风险概览。
- `aiOperationAssistantService`：产品证据来源标签仍写为旧快照表。
- `dataAssetMapService`：部分库存真相源元数据仍包含旧快照描述。
- 若干Sales Object迁移验证脚本仍调用旧产品分析函数，用于兼容比较。

因此，本阶段只能把旧核心标为退役候选，不能物理删除旧快照Schema或旧Service。

## 五、四项经营能力迁移目标

| 旧能力 | 新实现目标 | 新数据链 | 重要边界 |
|---|---|---|---|
| 产品趋势 | 产品经营看板的趋势筛选 + 产品详情销售趋势 | daily facts → ERP SKU → Product | 区间不足时显示数据不足；不读取ERP `sales30d` |
| 长期滞销 | 产品库存经营/健康分析中的无动销、积压、待观察 | daily facts + 库存日汇总 | 当前库存历史仅10日，不能直接生成30/60日结论 |
| 资金占用 | 产品经营看板、SKU排序和库存详情中的库存金额 | 最新库存日汇总 → ERP SKU → Product | 单位成本和金额必须受 `finance.view` 保护 |
| 产品分析详情 | 产品Workspace统一承接销售、库存、链接、健康、生命周期 | ProductBusinessReadModel + daily facts + Sales Object + 库存 | 不再维护第二套详情弹窗 |

统一的新关系链：

```text
销售：connection_sku_sales_daily_facts
  → erpSkuId
  → product_erp_mappings
  → Product

链接关系：Link SKU
  → Sales Object Relation
  → Sales Object Structure Components
  → ERP SKU
  → Product

库存：erp_sku_inventory_daily_summaries
  → ERP SKU
  → Product
```

Sales Object只负责销售对象与ERP组件关系解释，不承载销售金额。组合装金额不能复制到组件后再次累计。

## 六、旧逻辑分类

### A 保留

- `ProductBusinessReadModel`及其经营看板。
- `productCenterV2Service`的SKU分页列表与详情。
- daily facts产品销售查询。
- Sales Object Resolver产品关联链。
- 当前库存汇总读取。
- 新只读健康分析和经营诊断。
- 生命周期、改善记录与基于新证据的健康行动。

### B 重构迁移

- `getProductV2Detail`：详情经营数据改由新读模型组合，生命周期/问题/改善数据继续保留。
- `evaluateProductHealth`：改为基于新健康分析，并保存规则版本、事实日期和新证据来源。
- AI产品证据：切换到新读模型，更新来源标签。
- 产品趋势、滞销、资金占用：作为新读模型派生视图迁入产品中心。
- 经营驾驶舱和供应链中的旧产品快照读取：后续独立迁移，避免阻碍Schema退役。
- 数据资产地图中的真相源说明：改为daily facts与库存日汇总。

### C 删除候选

删除必须在调用归零和兼容观察后执行：

- 无实际调用的旧概览渲染/刷新函数。
- `getProductV2Overview`及旧概览API。
- 旧 `latestProductSnapshots` 和旧 `getProductBusinessAnalysis`。
- 旧 `evaluateProductHealth`实现。
- `open-product-analysis → #dataCenter`动作。
- 产品中心内“生成历史快照”操作和重试入口。
- 经营数据中心的产品趋势、滞销、资金占用、产品详情页面与四个API。
- 仅验证旧mapping/旧快照的正式回归fixture；必要部分转为归档兼容测试。

当前不属于删除候选：旧快照Schema本身。仍有经营驾驶舱、供应链和兼容脚本依赖，必须等消费者迁移完成后另行评估。

## 七、实施计划

### Phase 3B：冻结新经营读取契约

1. 以 `ProductBusinessReadModel` 定义产品经营摘要、趋势、库存、关系、健康的统一返回契约。
2. 明确销售额、销售利润、财务净利润、库存金额的字段名称与权限，禁止同名替换。
3. 增加契约测试：正式产品API不得查询旧快照；无数据与真实0严格区分。
4. 增加组合装金额守恒测试：Sales Object组件不得复制销售额和利润。

验收：新契约能覆盖产品详情所需字段，且不引入旧快照读取。

### Phase 3C：产品详情与经营体检迁移

1. `getProductV2Detail`改为组合新读模型、生命周期、历史问题和改善记录。
2. 前端经营Tab改读新详情字段；健康分析Tab继续使用新健康接口。
3. `evaluateProductHealth`改用新健康分析，并保存规则版本与证据日期。
4. AI产品证据切换到同一新读模型。
5. 保留历史健康记录查询，不改历史数据。

验收：列表、详情、健康分析和AI证据对同一产品给出一致的销售、库存和关系结果。

### Phase 3D：趋势、滞销、资金占用迁移

1. 趋势使用daily facts的明确比较周期，并展示覆盖日期。
2. 滞销使用销售与库存双条件；库存历史不足30/60日时只输出“数据不足”。
3. 资金占用读取最新库存汇总，按产品聚合，并执行财务权限裁剪。
4. 优先复用现有产品经营看板筛选和SKU列表排序，不新增业务表。

验收：四项旧业务语义在产品中心可用，且旧数据中心不再提供独占能力。

### Phase 3E：入口与API兼容退役

1. 移除产品中心跳往 `#dataCenter` 的旧动作。
2. 旧产品分析URL先返回迁移提示或兼容跳转。
3. 前端调用归零后，将旧四个产品分析API标为Legacy只读，再安排删除。
4. 确认无运行调用后删除旧概览死代码。

验收：正式导航和产品页面不再请求旧产品分析API。

### Phase 3F：间接消费者迁移与Schema退役前置

1. 迁移经营驾驶舱、供应链和AI来源标签。
2. 调整数据资产地图的真相源说明。
3. 将旧验证脚本分类为正式测试、兼容测试或归档脚本。
4. 正式代码旧快照SELECT归零后，再单独开展Schema退役评估。

## 八、实施风险与保护条件

1. **销售口径风险**：旧ERP `sales30d`与daily facts销售事实不可直接做等价迁移。
2. **利润口径风险**：销售利润与财务净利润必须分开显示和授权。
3. **滞销误判风险**：10日库存历史不足以支持30/60日连续结论。
4. **权限泄露风险**：成本和库存金额仍需 `finance.view`。
5. **金额重复风险**：Sales Object组件只提供组成数量，不继承销售金额。
6. **历史审计风险**：旧健康记录和旧快照在迁移观察期内只读保留。
7. **隐藏调用风险**：旧概览虽无文本调用，删除前仍需浏览器角色/路由覆盖验证。

## 九、最终判断

产品中心的新数据链已经足以承接产品趋势、当前滞销风险、资金占用和产品详情；模型层面不存在阻断项。

当前阻断不是数据表缺失，而是正式调用尚未完全收口。最小安全实施顺序为：

1. 统一产品详情和经营体检；
2. 统一AI产品证据；
3. 在产品中心实现趋势、滞销和资金占用派生视图；
4. 迁移经营驾驶舱、供应链等间接消费者；
5. 最后退役旧入口、旧API及旧快照生成操作。

禁止通过恢复旧快照来维持旧功能，也不应在消费者归零前删除旧快照Schema。
