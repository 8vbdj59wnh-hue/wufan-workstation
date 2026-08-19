# Architecture Cleanup-002 产品经营分析迁移与重构分析 Phase 2报告

审计日期：2026-08-20

## 一、结论

经营数据中心中的“产品趋势、长期滞销、资金占用、产品分析详情”仍有业务价值，但旧实现不应继续作为正式经营读取能力。

推荐结论：

- 保留四项能力的业务语义。
- 将产品级入口和展示全部迁入产品中心。
- 计算统一建立在销售日报事实、Sales Object关系、产品映射和当前库存事实之上。
- 不恢复、补写或继续依赖旧ERP经营快照。
- 完成消费者迁移后，旧数据中心产品页面及四个API进入兼容退役；旧快照Schema暂不在本任务删除。

当前不是简单的“入口重复”。产品中心内部也存在新旧两套经营读取：新的产品经营看板已经使用新真相源，但旧产品概览、旧产品详情经营分析、手工生成经营体检和AI产品证据仍使用旧快照。

## 二、只读数据基线

| 数据资产 | 当前数量/范围 | 判断 |
|---|---:|---|
| `connection_sku_sales_daily_facts` | 11,548行；2026-07-09至2026-08-09 | 正式销售事实 |
| 销售额/利润 | ¥1,327,063.9502 / ¥624,038.6962 | 新产品经营读取可直接使用 |
| `sales_objects` | 6,365 | 正式销售对象关系资产 |
| active Link SKU → Sales Object | 31,769 | 正式链接关系 |
| Sales Object组件 | 10,425 | 正式ERP组件关系 |
| `erp_sku_inventory_daily_summaries` | 10,063行；10个业务日期 | 当前SKU库存汇总 |
| 有最新库存的ERP SKU | 6,157 | 产品中心当前库存来源 |
| 有库存的产品 | 2,956 | 已覆盖全部active产品映射 |
| `erp_fact_snapshots` | 0 | 旧经营快照不可用 |
| `product_daily_snapshots` | 0 | 旧产品趋势/滞销无数据 |
| `product_erp_daily_snapshots` | 0 | 旧资金占用无数据 |

## 三、经营数据中心旧功能扫描

### 1. 产品趋势

当前入口：`dataCenterPage.js` 的 `trends` Tab。

当前API：`GET /api/data-center/trends`。

当前服务：`dataCenterService.getTrendProducts`。

当前算法：读取最近14个正式ERP快照中的 `product_daily_snapshots.sales30d`，最少7个有效业务日后，按首尾变化率、线性斜率和方向反复次数分类为上涨、下滑、稳定或波动。

问题：

- `sales30d`来自ERP映射的 `latestStateJson` 快照，不是正式销售日报事实。
- 当前正式快照为0，因此页面没有可用趋势。
- 产品中心已经具备按daily facts计算当前周期、上一周期和更早周期趋势的能力。

判断：业务语义保留，旧实现停止扩展，合并到产品中心经营看板和产品详情销售趋势。

### 2. 长期滞销

当前入口：`slow-moving` Tab。

当前API：`GET /api/data-center/slow-moving`。

当前服务：`dataCenterService.getSlowMovingProducts`。

当前算法：要求有库存且 `sales30d <= 5`，连续30日标记疑似滞销，连续60日标记长期滞销。

问题：

- 依赖旧产品快照，当前无数据。
- 产品中心已有库存状态、库存覆盖天数、无动销、积压风险和清仓区分类，功能高度重叠。
- 当前新库存事实只有10个业务日期，尚不足以证明连续30/60日库存状态。

判断：迁移并合并到“产品中心 → 库存经营/产品健康”。保留30/60日规则，但在新库存历史不足时只能显示“数据不足/待观察”，不得提前判定长期滞销。

### 3. 资金占用

当前入口：`capital` Tab。

当前API：`GET /api/data-center/capital-occupation`。

当前服务：`dataCenterService.getCapitalOccupationProducts`。

当前算法：旧快照中每个ERP规格的 `actualStock × unitCost` 汇总至产品，并计算排名、占比和前20集中度。

问题：

- 旧资金快照为0。
- 产品中心已经读取 `erp_sku_inventory_daily_summaries.inventoryCostAmount`，支持库存金额展示和排序。
- 最新SKU库存中6,157个SKU均有库存金额，映射覆盖2,956个产品，足以替代当前值计算。

判断：合并到产品中心经营看板和库存详情。金额字段继续受 `finance.view` 控制；只有产品查看权限时不得泄露单位成本和库存金额。

### 4. 产品分析详情

当前入口：经营数据中心列表中的“查看分析”弹窗。

当前API：`GET /api/data-center/products/:productId`。

当前内容：旧快照历史、趋势判断、库存资金历史、平台/店铺/链接数量，并提供跳转产品中心。

问题：

- 数据依赖与前三项完全相同，当前没有正式快照。
- 产品中心已有产品Workspace、销售日报、库存记录、Sales Object关联链接、健康分析和生命周期。
- 独立弹窗形成第二套产品详情。

判断：不保留独立详情。将仍有价值的趋势判断和库存金额历史合并进产品Workspace，旧弹窗在迁移完成后删除。

## 四、新数据来源能否替代旧快照

推荐正式关系：

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

库存：erp_sku_warehouse_inventory_facts
  → erp_sku_inventory_daily_summaries
  → ERP SKU
  → Product
```

替代判断：

| 能力 | 是否可替代 | 限制 |
|---|---|---|
| 当前销售、利润、销量 | 可以 | 使用daily facts，禁止使用ERP库存文件中的销量代替销售事实 |
| 7/14/30日销售趋势 | 可以 | 当前销售事实日期范围足够进行区间趋势计算 |
| 当前库存与库存金额 | 可以 | 使用每个ERP SKU最新库存汇总；成本字段受财务权限控制 |
| 链接/店铺/平台贡献 | 可以 | 使用Sales Object Resolver反查Link SKU和Link |
| 30/60日长期滞销 | 暂不能完整判定 | 新库存历史仅10日，需要继续积累；期间输出数据不足 |
| 30/60日库存金额历史 | 暂不完整 | 只能展示已有库存业务日，不得补造历史快照 |

Sales Object负责关系解释，不承担销售金额。销售额和利润继续只从daily facts聚合，避免组合组件重复累计金额。

## 五、产品中心现状与重复能力

### 已经使用新架构的能力

- “产品经营分析”看板：`ProductBusinessReadModel`。
- SKU列表：销售来自daily facts，库存来自SKU库存汇总，链接关系来自Sales Object。
- ERP SKU详情：销售记录、库存记录和关联链接均按需读取。
- 产品销售日报：使用统一daily fact查询能力。
- 只读产品健康分析、经营诊断和改善建议：基于`ProductBusinessReadModel`。
- 生命周期记录：独立产品生命周期事件，不依赖旧快照。

### 仍依赖旧快照的产品中心能力

| 读取点 | 旧依赖 | 风险 |
|---|---|---|
| `/api/product-management/overview` | `getProductV2Overview`优先旧快照，回退`latestStateJson` | 与新经营看板口径不同 |
| `/api/product-management/products/:id` | `getProductV2Detail → getProductBusinessAnalysis` | 产品详情经营分析可能全为空 |
| `POST .../evaluate` | `evaluateProductHealth → getProductBusinessAnalysis` | 可能用空/旧指标生成持久化健康记录 |
| AI产品证据 | `getProductBusinessAnalysis` | AI可能引用旧或缺失数据 |
| 经营驾驶舱产品区 | `operationManagementService` | 仍直接依赖旧快照 |
| 供应链库存概览 | `supplyChainService` | 仍直接依赖旧快照，阻止快照Schema立即退役 |

因此，迁移不能只把旧数据中心菜单链接到产品中心；必须先迁移上述正式消费者。

## 六、最终归属

| 旧功能 | 最终处理 | 目标位置 |
|---|---|---|
| 产品趋势 | 合并 | 产品中心 → 产品经营分析；产品详情 → 销售表现 |
| 长期滞销 | 迁移并合并 | 产品中心 → 库存经营/产品健康；作为筛选和风险分类 |
| 资金占用 | 合并 | 产品中心经营表、SKU列表排序、产品库存详情 |
| 产品分析详情 | 删除旧独立页面 | 由产品Workspace详情承接 |
| 旧数据中心产品Tab | 兼容后退役 | 不再作为正式入口 |
| 旧产品分析API | 兼容后退役 | 新产品中心API完成口径对齐后停止前台调用 |
| 旧快照生成/Schema | 暂时保留 | 等经营驾驶舱、供应链和AI全部迁移后另行评估 |

## 七、实施方案

### Phase A：入口迁移

1. 将经营驾驶舱“进入数据中心”改为进入产品中心产品经营看板。
2. 将产品中心遗留的 `open-product-analysis → #dataCenter` 改为产品中心内部详情/经营看板。
3. 旧 `#dataCenter` 产品分析URL保留一个版本的兼容提示，不再作为导航入口。
4. 权限统一使用 `products.view`；库存成本继续额外检查 `finance.view`。

验收：所有产品经营入口进入产品中心，旧URL仍能被安全处理。

### Phase B：数据逻辑迁移

1. 以`ProductBusinessReadModel`作为产品经营列表和健康规则的统一读取门面。
2. 趋势统一读取daily facts，明确当前期、对比期和无数据语义。
3. 库存与资金占用统一读取库存汇总；不得回退旧快照或`latestStateJson`。
4. 链接贡献统一经Sales Object Resolver解释。
5. 将旧产品详情经营分析、`evaluateProductHealth`和AI产品证据迁移到同一新读模型。
6. 长期滞销按库存历史覆盖日数守门；不足30/60日时不生成正式结论。

验收：同一产品在列表、详情、健康分析和AI证据中的销售、库存、利润和关系结果一致。

### Phase C：旧页面退役

1. 确认前端不再调用四个`/api/data-center/*`产品分析接口。
2. 将旧产品Tab和详情弹窗从正式页面移除。
3. API先进入兼容只读/迁移提示，再评估删除。
4. 单独完成经营驾驶舱、供应链和AI旧快照依赖迁移。
5. 所有消费者归零后，再评估旧快照服务和Schema退役；本阶段不得删除。

验收：产品经营正式读取只经过产品中心新链路，旧快照不再参与任何正式产品判断。

## 八、主要风险

1. **口径混淆**：旧页面的`sales30d`是ERP库存来源销量，新页面销售来自daily facts，两者不能直接宣称数值等价。
2. **利润含义不同**：daily facts提供销售利润；旧详情的`finance_entries`计算净利润。迁移时必须分别命名，不能互相覆盖。
3. **长期滞销证据不足**：当前库存历史只有10日，不能为了迁移完成而生成30/60日结论。
4. **金额权限**：库存金额和单位成本必须继续受财务权限保护。
5. **间接旧依赖**：经营驾驶舱、供应链和AI仍读取旧快照，未迁移前不能物理删除旧Schema。

## 九、最终建议

可以进入Phase A入口迁移，但不建议直接删除旧页面或API。

最小安全路径是：先把入口全部指向产品中心，再以`ProductBusinessReadModel + daily facts + Sales Object + 当前库存汇总`统一详情、健康和AI读取，最后退役旧数据中心产品页面。禁止通过重新生成旧快照来维持旧功能。
