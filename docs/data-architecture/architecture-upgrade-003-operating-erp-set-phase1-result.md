# 《Architecture Upgrade-003 Operating ERP Set Phase 1验收报告》

生成时间：2026-08-21（Asia/Shanghai）
阶段状态：开发与隔离验证完成；未发布、未切换正式同步
生产数据：未修改

## 一、验收结论

Phase 1 已建立Operating ERP Set的基础能力：

- 两张轻量资产表：当前成员 + 多来源证据；
- Platform Active、Bundle Dependency、Sales Active三类计算；
- Active、Active Dependency、Sales Active、Archived、External/Unused、Unresolved生命周期；
- 幂等物化、服务端分页查询和管理员只读API；
- 产品中心、库存和API范围影响模拟；
- 10项专项自动测试；
- 847MB生产数据库只读快照上的隔离验证。

但当前证据**不足以切换正式旺店通同步**。主要阻断：生产快照中最新可确认完整平台主档是2026-08-05，而不是最近的8.19平台表；另有1,076个Link SKU缺编码、152个Link SKU对应52个未解析经营编码；当前保留的历史来源证据尚不足以高置信区分全部Archived与External/Unused对象。

## 二、为什么需要独立资产表

已检查现有模型：

| 现有资产 | 能表达什么 | 不能表达什么 | 结论 |
|---|---|---|---|
| `erp_skus.currentState` | ERP主档自身active/missing | 同一SKU同时来自平台、Bundle依赖和销售 | 不复用为经营状态 |
| `lastSeenBatchId` | 最近主档/平台批次 | 多来源、来源对象和有效证据 | 仅作为来源输入 |
| `data_sync_batches` | 同步过程与结果 | 当前经营集合及逐对象原因 | 不适合作成员表 |
| `sales_objects.status` | 销售对象状态 | 组件ERP生命周期与多来源证据 | 不替代Operating Set |
| 库存事实 | 某日库存 | 是否属于当前经营范围 | 不能反推经营状态 |

因此新增独立Operating ERP资产是必要的，但它只是范围投影，不是第二套ERP主数据。

### 新增Schema

#### `operating_erp_set_members`

保存：`normalizedCode, merchantSkuCode, erpSkuId, salesObjectId, lifecycleStatus, sourceCount, firstSeenAt, lastSeenAt, calculatedAt, updatedAt`。

允许 `erpSkuId` 为空，因为旺店通Bundle父编码属于Suite而非 `erp_skus`；此时必须有Sales Object，或处于Unresolved。

#### `operating_erp_set_evidence`

保存：`sourceType, sourceObjectType, sourceObjectId, sourceBatchId, firstSeenAt, lastSeenAt, active, calculatedAt, metadataJson`。

同一编码可同时保留platform_active、bundle_dependency、sales_active，不会因生命周期摘要覆盖来源证据。

## 三、最终计算规则

`Operating ERP Set = Platform Active ∪ Bundle Dependency ∪ Sales Active`

### Platform Active

1. 只选择最近一次成功提交的完整平台货品批次；
2. 只将 `sales_link_skus.lastSeenBatchId` 等于该批次的Link SKU视为本批出现；
3. 不能继续使用 `sales_link_skus.currentState='active'` 作为Platform Active，因为旧批次缺席对象可能仍保持active；
4. Link SKU编码映射到Single时产生ERP SKU成员；映射到Bundle时产生Suite/Sales Object成员；
5. 缺编码或无法解析的对象进入异常/Unresolved，不进入正式ERP经营资产。

### Bundle Dependency

1. 当前经营Bundle只来自Platform Active Bundle或Sales Active Bundle；
2. 只展开这些Bundle当前有效BOM；
3. 组件ERP SKU加入bundle_dependency；
4. Bundle销售事实不会把组件错误标成sales_active；
5. 无Link、无近期销售的历史旺店通Bundle不会把组件带入经营集合。

### Sales Active

Sales窗口没有写死。系统从已提交Daily Facts推导：

- 最新正式销售日：2026-08-09；
- 最新已提交事实覆盖：2026-07-09至2026-08-09；
- 覆盖周期：32天；
- 当前模拟窗口：32天；
- 依据：`latest_committed_coverage`。

若存在至少两个连续、可信的导入间隔，窗口取“最新覆盖周期”与“三个导入周期”较大值；超长历史断档不参与节奏估算。可由配置显式覆盖，但不在代码中擅自固定90天。

### 生命周期优先级

`Active > Active Dependency > Sales Active > Archived > External/Unused`

Unresolved独立表示有经营证据但身份未解析。成员表保存摘要状态，证据表仍保留全部同时成立的来源。

## 四、隔离环境与数据保护

| 项目 | 结果 |
|---|---|
| 生产快照 | `/private/tmp/operating-erp-phase1-production-snapshot-complete.db` |
| 快照大小 | 847MB |
| 快照SHA256 | `21993a3d9583f8cc5a618e4fa12dc1764ebdb804320355fd184b2a949ac01720` |
| 隔离演练库 | `/private/tmp/operating-erp-phase1-rehearsal.db` |
| 演练库SHA256 | `b8a02a60b4fea43c36c072bf1b51b13c652d8e926abfa9f04f7d869f830cc0dc` |
| integrity_check | `ok` |
| foreign_key_check | 0条 |

### 正式资产前后对比

| 资产/指标 | 演练前 | 演练后 | 变化 |
|---|---:|---:|---:|
| ERP SKU | 6,906 | 6,906 | 0 |
| Sales Object | 8,099 | 8,099 | 0 |
| Products | 2,958 | 2,958 | 0 |
| Product Mapping | 2,956 | 2,956 | 0 |
| Links | 9,293 | 9,293 | 0 |
| Link SKU | 33,073 | 33,073 | 0 |
| Daily Facts | 11,548 | 11,548 | 0 |
| 库存明细事实 | 27,649 | 27,649 | 0 |
| 库存日汇总 | 12,305 | 12,305 | 0 |
| 销售额 | 1,327,063.9502 | 1,327,063.9502 | 0 |
| 成本 | 574,096.4340 | 574,096.4340 | 0 |
| 利润 | 624,038.6962 | 624,038.6962 | 0 |

## 五、6,906个ERP SKU分类结果

最新可确认完整平台批次：`8.5平台货品.xlsx`，业务日期2026-08-05，批次 `erp-v2-platform_goods-1785895464792-5de15a`。

| 分类 | ERP SKU数量 | 说明 |
|---|---:|---|
| Platform Active | 2,724 | 含与Dependency/Sales重叠对象 |
| Bundle Dependency only | 120 | 仅作为当前经营Bundle组件 |
| Sales Active only | 0 | 当前正式销售对象均同时有平台或依赖证据 |
| 多来源重叠 | 1,838 | 至少同时拥有两种来源 |
| Operating ERP Set总量 | 2,844 | 6,906个真实 `erp_skus` 中的经营范围 |
| Archived | 0 | 当前留存证据没有识别出可确定Archived对象 |
| External / Unused候选 | 4,062 | 无当前及可识别历史经营证据 |

Operating ERP Set占ERP SKU总量：**41.1816%**；默认非经营候选：58.8184%。

### 互斥来源组合

| Platform | Dependency | Sales | 数量 |
|---:|---:|---:|---:|
| 是 | 是 | 是 | 565 |
| 是 | 是 | 否 | 960 |
| 是 | 否 | 是 | 313 |
| 是 | 否 | 否 | 886 |
| 否 | 是 | 否 | 120 |
| 否 | 否 | 是 | 0 |

### 经营对象层

除2,844个ERP SKU外，集合还必须承接3,642个当前经营Bundle父对象：

- 已解析经营对象：6,486；
- Unresolved经营编码：52；
- Operating候选范围：6,538个编码；
- 活跃证据记录：42,939条。

这再次证明不能只用 `erp_skus` 表表达经营范围。

## 六、Archived与External / Unused边界

当前结果为Archived 0、External/Unused候选4,062，并不表示历史上从未经营过这4,062个对象。它表示当前数据库保留的可查询证据中，没有找到它们的历史平台、历史销售或已关联结构证据。

在正式启用生命周期前必须：

1. 从下一次完整平台批次开始持续保存逐对象证据；
2. 导入可获得的历史平台批次或建立归档清单；
3. 至少观察两个同范围完整批次；
4. 只有存在历史经营证据且当前三类证据均失效的对象才标Archived；
5. 无任何可靠历史经营证据的对象才标External/Unused。

因此本阶段不修改任何现有ERP SKU状态。

## 七、旺店通按需同步模拟

### 查询目标身份规模

| 范围 | 旧模式目标 | V3首次目标 | 减少 |
|---|---:|---:|---:|
| Goods/ERP SKU | 6,906 | 2,896 | 58.07% |
| Suite/Bundle | 5,377 | 3,694 | 31.30% |
| 合计身份检查 | 12,283 | 6,590 | 46.35% |

V3 Goods目标2,896 = 2,844个Operating ERP SKU + 52个Unresolved候选。Suite目标3,694 = 3,642个当前经营Bundle + 52个需做Goods/Suite双查的Unresolved编码。

该表比较的是“需检查的身份数量”，不是实际HTTP请求数。当前时间窗分页接口与未来精确查询的分页、缓存命中和批量能力不同，不能伪造HTTP调用次数。

### 未来流程

```text
完整平台货品批次
  → 更新Operating ERP证据
  → 新编码/过期编码立即查询Goods与Suite
  → Single写入ERP主档投影
  → Bundle读取Suite/BOM
  → 新组件加入Dependency并补查Goods
  → 缓存未变化对象
  → sourceUpdatedAt/TTL到期才刷新
```

- 已存在且来源未变化：不重复查询；
- 新经营编码：立即查询；
- 长期未刷新：按生命周期配置TTL；
- Bundle：按Suite修改时间与structureHash判断；
- API失败：保留上一次确认结果并标记stale，不清空身份；
- 旧全量/时间窗同步继续保留为兼容和对照，本阶段未停止。

## 八、产品中心默认经营视图影响

| 项目 | 数量 |
|---|---:|
| 当前ERP SKU | 6,906 |
| 默认经营ERP SKU | 2,844 |
| 默认隐藏ERP SKU | 4,062 |
| 当前Products | 2,958 |
| Operating Set覆盖Products | 2,844 |
| 非经营ERP仍有Product Mapping | 112 |
| 其他未进入经营视图Product | 2 |

如果立刻切换，产品中心默认经营视图会从全量ERP资产收敛到2,844个经营Product，但本阶段没有实际修改产品中心。由于平台批次仍停留在8.5且Archived证据不足，暂不允许应用该默认隐藏结果。

## 九、库存资产影响

最新库存日期：2026-08-19。

| 非经营库存指标 | 结果 |
|---|---:|
| 有库存的非经营ERP SKU | 1 |
| 库存数量 | 10 |
| 可发库存 | 9 |
| 库存金额 | 370.6000 |

对象：`ZH0535-3`，当前分类为External/Unused候选。

本阶段不删除库存、不停止库存同步。正式切换前需人工确认该对象是否为遗漏经营证据、历史库存清理对象或真实外部资产。

## 十、异常清单

| 异常 | 对象数量 | 说明 |
|---|---:|---|
| 平台ERP编码缺失 | 1,076个Link SKU | 无法进入编码集合，需回源平台 |
| 平台编码无法解析 | 152个Link SKU / 52个编码 | 既未匹配ERP SKU，也未匹配Sales Object |
| Bundle Component缺失 | 0 | 当前经营Bundle有效结构完整 |
| ERP规范化编码冲突 | 0 | 未发现重复编码 |
| Single/Bundle身份冲突 | 0 | 未发现Suite父与ERP SKU同码冲突 |
| 销售事实主档不存在 | 0 | 外键及当前数据正常 |

异常只统计，没有自动修复，也没有修改现有关系。

## 十一、查询能力

新增管理员只读接口：

- `GET /api/data-sync-center/operating-erp-set`
  - 支持page、pageSize、keyword、lifecycleStatus、sourceType；
- `GET /api/data-sync-center/operating-erp-set/summary`
  - 返回计算时间、生命周期数量和来源数量。

没有新增“执行同步”或“切换正式范围”的API。Operating Set物化能力目前只用于隔离验证和后续受控同步编排。

## 十二、自动测试与回归

专项测试：`npm run test:operating-erp-set`

| 场景 | 结果 |
|---|---|
| Platform Active | 通过 |
| Bundle Dependency | 通过 |
| Sales Active | 通过 |
| 多来源ERP SKU | 通过 |
| 平台批次消失 | 通过 |
| 历史销售/Archived | 通过 |
| External / Unused | 通过 |
| Bundle组件不误标Sales Active | 通过 |
| 重复计算幂等 | 通过 |
| 不修改正式业务数据 | 通过 |

结果：10/10通过。

其他验证：

- `npm run check`：通过；
- `git diff --check`：通过；
- 隔离库 `integrity_check`：ok；
- 隔离库 `foreign_key_check`：0；
- Legacy关系写入保护：无风险。

## 十三、修改范围

| 文件 | 用途 |
|---|---|
| `server/schema.sql` | Operating ERP成员和证据Schema |
| `server/operatingErpSetService.js` | 规则计算、物化、查询、影响模拟 |
| `server/index.js` | 管理员只读查询接口 |
| `tests/operatingErpSetService.test.js` | 10项专项测试 |
| `scripts/verify-operating-erp-set-phase1.js` | 生产快照隔离验证 |
| `package.json` | 专项测试命令 |

未提交，未发布。

## 十四、下一阶段迁移条件

进入正式按需同步灰度前必须全部满足：

1. 将最新完整平台货品批次（至少8.19或更新）正式纳入批次语义；
2. 对比至少两个连续、同范围完整平台批次，验证缺席/恢复逻辑；
3. 处理或明确分类52个Unresolved编码；
4. 为1,076个缺编码Link SKU建立“无关系/待补源”明确口径；
5. 补强历史平台证据，验证Archived与External/Unused分类；
6. 对2,896个Goods目标和3,694个Suite目标执行一次只读API覆盖验证；
7. 与旧同步对比主档覆盖、BOM覆盖、缓存命中和实际HTTP调用量；
8. Product默认视图影子比较确认不误隐藏；
9. 核对 `ZH0535-3` 的非经营库存归属；
10. 保持Feature Flag默认关闭，旧同步路径继续可用。

## 十五、最终回答

> Operating ERP Set是否已经足以作为未来旺店通按需同步的范围控制器？

**模型和代码能力已经足以承担“未来范围控制器”，但当前生产证据尚不足以切换正式同步。**

现在可以继续做影子计算、只读API覆盖验证和新旧范围对比；不能停止旧全量/时间窗同步，也不能据此隐藏或停用4,062个现有ERP SKU。完成上述十项迁移条件后，才能进入有限灰度。
