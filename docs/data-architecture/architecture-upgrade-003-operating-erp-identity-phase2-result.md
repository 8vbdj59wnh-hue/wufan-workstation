# 《Architecture Upgrade-003 经营ERP身份契约与影子验证 Phase 2验收报告》

## 1. 验收结论

本阶段已在生产只读快照的隔离副本中建立旺店通经营身份契约、身份观察表和 Sales Object 影子投影，未切换正式 Resolver，未修改生产数据库。

核心结论：

- `2,844` 个 Operating ERP SKU 全部具有旺店通 Goods/规格身份，其中 `2,724` 个直接参与当前平台经营，`120` 个仅作为当前 Bundle 组件依赖。
- 当前经营销售对象身份候选共 `6,418` 个：`2,724` 个 Single、`3,642` 个有效 Bundle、`52` 个原未解析编码。
- 自动完整闭环 `6,366 / 6,418 = 99.1898%`。
- `52` 个原未解析编码经 Goods + Suite 实时查询后：`51` 个两侧均查不到；`1` 个能查到历史 Suite，但旺店通已删除，属于 `source_conflict`，不能自动恢复为当前有效 Bundle。
- 当前有效 Bundle `3,642 / 3,642` 均有完整 BOM、有效数量、存在的 Component ERP SKU，且组件 Product Mapping 完整率为 `100%`。
- 当前 `8,099` 个正式 Sales Object 中，V3 当前经营投影只需要 `6,366` 个；现有正式模型已覆盖 `6,364` 个，需自动新增 `HP1025-1`、`HP1055-1` 两个 Single 投影；`1,735` 个为历史或当前非经营对象候选。
- 可以进入 Phase 3 的 BOM 版本权威化隔离开发，但不能据此直接切换生产主链。最大前置问题是生产库“最新完整平台批次”仍是 `2026-08-05` 的 `8.5平台货品.xlsx`，并非更晚的实际平台资产基线。

## 2. 范围与口径

### 2.1 两层身份必须分开

| 层级 | 数量 | 真实语义 | 权威来源 |
|---|---:|---|---|
| Operating ERP Set | 2,844 | 旺店通 Goods 规格/库存组件身份 | `goods.Goods.queryWithSpec` |
| 当前经营销售对象候选 | 6,418 | 平台实际销售编码；可为 Single 或 Suite | Goods + `goods.Suite.search` |
| Bundle Dependency Only | 120 | 只作为当前 Bundle 组件，不是独立销售对象 | Suite BOM → Goods Component |
| 范围外历史 ERP | 4,062 | External / Unused 候选 | 本阶段不查询、不计失败 |

不能用 `6,906` 个历史 ERP SKU 作为本阶段覆盖率分母。正式质量口径是当前经营对象能否由旺店通权威解释。

### 2.2 当前正式平台批次

| 字段 | 值 |
|---|---|
| batchId | `erp-v2-platform_goods-1785895464792-5de15a` |
| 文件 | `8.5平台货品.xlsx` |
| businessDate | `2026-08-05` |
| 完成时间 | `2026-08-05T02:12:17.314Z` |

因此报告中的“当前平台经营”严格指生产数据库最后一个已提交完整批次。若 `8.19平台货品.xlsx` 才是业务上的最新完整表，应先按正式流程建立新完整批次，再重新计算 Operating ERP Set；本报告不拿未提交文件替换正式口径。

## 3. 旺店通身份契约

### 3.1 判定规则

| Goods API | Suite API | 结果 | 状态 | 自动处理 |
|---|---|---|---|---|
| 找到 | 未找到 | Single ERP SKU | `confirmed` | 可生成 Single Sales Object 投影 |
| 未找到 | 找到且有效 | Bundle Suite | `confirmed` | 可生成 Bundle 投影与 BOM |
| 找到 | 找到 | 身份冲突 | `sku_type_conflict` | 禁止自动选择 |
| 未找到 | 未找到 | 无权威身份 | `erp_not_found` | 人工核对来源编码 |
| 任一接口失败 | 任意 | 来源不可用 | `source_unavailable` | 重试，禁止记为不存在 |
| 找到但源端已删除 | 任意 | 来源状态冲突 | `source_conflict` | 保留证据，禁止自动激活 |

### 3.2 底层语义

- `erp_skus` 只表达旺店通 Goods 下的规格身份，不容纳 Bundle 父编码。
- Suite 父编码是旺店通组合装身份，不应为了字段统一强写入 `erp_skus`。
- Sales Object 是经营层自动投影：Single 投影指向一个 ERP SKU ×1；Bundle 投影指向 Suite 的有效 BOM 版本。
- `objectType=single/bundle` 可以存在于 Sales Object，但不能作为底层主数据真相替代 Goods/Suite 身份。

## 4. 本阶段影子模型

新增的代码级影子资产只用于隔离验证：

### `operating_erp_identity_observations`

保存：

- 经营范围标识；
- Goods/Suite 分别是否找到；
- 权威身份类型；
- `confirmed / sku_type_conflict / source_conflict / erp_not_found / source_unavailable`；
- 实时或物化来源；
- 源更新时间和查询时间。

### `operating_erp_identity_shadow_comparisons`

保存：

- 当前正式解释；
- V3 权威解释；
- `consistent / v3_fill / type_conflict / source_conflict / erp_not_found`；
- BOM完整性；
- Product Mapping完整性；
- Sales Object影子投影编码。

这两张表未进入生产数据库，也不改变 ERP SKU、Sales Object、Link SKU关系、Product Mapping、Daily Facts、库存事实或正式 Resolver。

## 5. 实时只读复核

旺店通调度限制约 `55` 请求/分钟。对全部 `6,418` 个经营销售编码同时执行 Goods + Suite 双查，需要数小时且会产生大量无价值重复请求。因此本阶段采用：

1. 对 `52` 个未解析编码实时执行 Goods + Suite 双查；
2. 对 `342` 个仍标记为旧表格来源的当前经营 Bundle 实时执行 Suite/BOM查询；Goods侧使用 `2026-08-18/19` 已物化 Goods快照确认不存在同码规格；
3. 对另外 `3,300` 个当前经营 Bundle 使用 `2026-08-20` 旺店通 Suite同步结果；
4. 对 `2,844` 个 ERP SKU 使用已物化旺店通 Goods主数据，其中 `2,155` 个在 `2026-08-18` 批次确认、`2` 个在 `2026-08-19` 批次确认，其余为未变化的历史增量保留；
5. Phase 1 已有 `950` 个业务编码实时样本无差异，作为补充证据，但不冒充本阶段全量实时双查。

| 项目 | 数量 | 结果 |
|---|---:|---|
| 本阶段重点实时对象 | 394 | 全部完成 |
| Goods实时查询 | 52 | 0错误 |
| Suite实时查询 | 394 | 0错误 |
| 旧表格来源当前Bundle | 342 | 342均在Suite API找到，均未删除 |
| 未解析编码 | 52 | 51查无结果；1为已删除历史Suite |

结论：接口具备按编码权威确认能力，但不适合每次对全部经营编码做无差别双查。正式方案应按新增、超期和结构Hash变化触发。

## 6. 52个未解析经营编码原因

| 原因 | 编码数 | 影响Link SKU | 判断 |
|---|---:|---:|---|
| `tb_`平台标识被放入ERP编码字段 | 37 | 130 | 字段语义错误，不是旺店通ERP编码 |
| 尾部仅有`-`等格式残缺 | 3 | 3 | 编码格式异常 |
| 纯数字/混入商品描述，不符合ERP编码语义 | 2 | 3 | 字段语义错误 |
| 形式像ERP编码但Goods/Suite均查不到 | 9 | 15 | `erp_not_found`；需核对历史编码、下架或源数据延迟 |
| 历史Suite存在但旺店通已删除：`FZH0118-15` | 1 | 1 | `source_conflict`，不能自动激活 |
| API失败 | 0 | 0 | 无 |
| 同码Single/Bundle冲突 | 0 | 0 | 无 |

`FZH0118-15` 的历史BOM仍可读取：3个组件中2个已有Product Mapping；但源端Suite已删除，所以它不计自动闭环，也不应自动新建当前Sales Object。

## 7. 1,076个缺ERP编码Link SKU复核

| 项目 | 数量 |
|---|---:|
| 最新正式完整批次Link SKU | 33,005 |
| ERP编码为空Link SKU | 1,076 |
| 影响Link | 986 |
| 已有`erpSkuId` | 0 |
| 已有active Sales Object关系 | 0 |
| 占当前批次Link SKU | 3.2601% |

严格按生产库最后完整批次判断，这 `1,076` 条全部属于当前批次真实缺口，不是单纯历史系统残留。但由于正式批次停留在 `8.5`，必须先确认并提交最新完整平台批次，才能把该数字当作今天的生产治理工作量。

另外，带编码但身份未闭环的 `52` 个编码影响 `152` 条Link SKU。两类合计影响 `1,228 / 33,005 = 3.7206%` 的当前批次Link SKU；两者不能与对象级治理率混用。

## 8. Bundle BOM与Product Mapping

| 指标 | 数量 | 比率 |
|---|---:|---:|
| 有效经营Bundle | 3,642 | 100%基数 |
| 旺店通身份确认 | 3,642 | 100% |
| BOM完整 | 3,642 | 100% |
| BOM缺失 | 0 | 0% |
| Component缺失 | 0 | 0% |
| Quantity异常 | 0 | 0% |
| 结构冲突 | 0 | 0% |
| 不同Component ERP SKU | 1,645 | — |
| Component Product Mapping完整 | 1,645 | 100% |

原来 `342` 个 `combo_master_excel` 来源Bundle经实时 Suite API复核后全部可由旺店通权威接管；这是 Phase 3 将 BOM 来源从旧表格切换为旺店通版本资产的直接证据。

## 9. Sales Object影子投影

| 项目 | 数量 |
|---|---:|
| 当前正式Sales Object总量 | 8,099 |
| 当前经营范围内已有Sales Object | 6,364 |
| V3自动投影需要 | 6,366 |
| V3需新增Single投影 | 2 |
| V3需新增Bundle投影 | 0 |
| 类型修正 | 0 |
| 真正类型冲突 | 0 |
| 历史/非经营Sales Object候选 | 1,735 |

需新增的两个投影是：

- `HP1025-1`：Goods身份与Product Mapping均完整；
- `HP1055-1`：Goods身份与Product Mapping均完整。

这说明 Sales Object 可以降级为自动经营投影，而不再承担人工维护商品真相的职责；但本阶段没有写入或修改正式 Sales Object。

## 10. 影子比较

比较范围是 `6,538` 个经营成员：`6,418` 个销售对象身份候选 + `120` 个Dependency-only ERP组件。

| 状态 | 数量 | 说明 |
|---|---:|---|
| 完全一致 | 6,484 | 当前解释与V3权威身份一致 |
| V3可补齐 | 2 | 两个Single缺Sales Object投影 |
| 类型冲突 | 0 | 无同码Goods/Suite冲突 |
| 旺店通不存在 | 51 | Goods/Suite均查不到 |
| API异常 | 0 | 本轮无失败 |
| 来源冲突 | 1 | `FZH0118-15`平台仍出现、Suite已删除 |
| 当前系统多余关系 | 0 | Operating范围内未发现；范围外1,735个历史对象另行生命周期处理 |

## 11. 核心验收指标

| 指标 | 数量 | 口径 | 结果 |
|---|---:|---|---:|
| Operating ERP Goods身份确认 | 2,844 / 2,844 | ERP主数据层 | 100% |
| 经营对象身份确认率 | 6,366 / 6,418 | 当前销售对象身份候选 | 99.1898% |
| Single识别率 | 2,724 / 2,724 | 当前Single候选 | 100% |
| Bundle识别率 | 3,642 / 3,643 | 含1个已删除Suite来源冲突 | 99.9726% |
| 有效Bundle BOM完整率 | 3,642 / 3,642 | 已确认有效Bundle | 100% |
| 已确认对象Product Mapping完整率 | 6,366 / 6,366 | 可自动投影对象 | 100% |
| 自动关系可建立率 | 6,366 / 6,418 | 不含缺编码Link SKU | 99.1898% |
| 对象级人工治理率 | 52 / 6,418 | 51不存在+1来源冲突 | 0.8102% |
| Link SKU缺编码率 | 1,076 / 33,005 | 当前正式完整平台批次 | 3.2601% |

## 12. 正式目标模型建议

Phase 3不要给所有对象增加一个模糊`skuType`字段。建议保持三层：

### Goods规格身份

继续使用`erp_skus`，保留：

- `merchantSkuCode`；
- 旺店通Goods/Spec标识（当前可从`rawSourceData`取出，后续可结构化）；
- `erpStatus/currentState`；
- `sourceUpdatedAt`；
- `lastSeenBatchId`。

### Suite身份与版本BOM

Phase 3建立独立旺店通Suite主数据语义，建议资产：

- `wangdian_suites`：suiteId、suiteCode、名称、deleted/status、sourceUpdatedAt、lastCheckedAt、rawSource；
- `wangdian_suite_structure_versions`：suiteId、version、structureHash、effectiveFrom/effectiveTo、sourceUpdatedAt、状态；
- `wangdian_suite_components`：structureVersionId、componentErpSkuId、componentCode、quantity、sortOrder。

Bundle父编码不进入`erp_skus`。

### Sales Object投影

Sales Object只保存经营投影关系：

- `sourceIdentityType = wangdian_goods_spec | wangdian_suite`；
- `sourceIdentityId`；
- `objectType`由底层身份派生；
- Single结构固定ERP SKU ×1；
- Bundle结构引用有效Suite BOM版本，不复制为另一套人工真相。

## 13. 人工治理边界

人工只处理异常：

- `missing_erp_code`：1,076条当前批次Link SKU；
- `erp_not_found`：51个编码、151条Link SKU；
- `source_conflict`：1个编码、1条Link SKU；
- `sku_type_conflict`：0；
- `bundle_bom_missing`：0；
- `bundle_component_missing`：0；
- 已确认对象`product_mapping_missing`：0；
- `relation_conflict`：0；
- `source_unavailable`：0。

历史ERP未进入Operating Set的4,062个对象不计治理异常。

## 14. 数据保护与验证

| 资产 | 前 | 后 | 结果 |
|---|---:|---:|---|
| ERP SKU | 6,906 | 6,906 | 不变 |
| Sales Object | 8,099 | 8,099 | 不变 |
| Link SKU | 33,073 | 33,073 | 不变 |
| Link SKU-Sales Object关系 | 31,784 | 31,784 | 不变 |
| Sales Object Structure | 8,099 | 8,099 | 不变 |
| Structure Component | 14,348 | 14,348 | 不变 |
| Product Mapping | 2,956 | 2,956 | 不变 |
| Daily Facts | 11,548 | 11,548 | 不变 |
| 库存日报摘要 | 12,305 | 12,305 | 不变 |
| 销售额 | 1,327,063.9502 | 1,327,063.9502 | 不变 |
| 成本 | 574,096.4340 | 574,096.4340 | 不变 |
| 利润 | 624,038.6962 | 624,038.6962 | 不变 |

- `integrity_check = ok`
- `foreign_key_check = 0`
- 影子模型重复物化幂等
- 生产数据库只读打开，未执行同步或写入
- 正式Resolver未切换
- `npm run check`通过（数据库测试全部使用隔离临时库）
- `npm run test:operating-erp-set`：10/10通过
- `npm run test:operating-erp-identity`：11/11通过
- `git diff --check`通过

## 15. 自动测试

专项测试 `11/11` 通过：

1. Single识别；
2. Bundle识别；
3. 同编码类型冲突；
4. ERP不存在；
5. API失败；
6. 已删除源身份冲突；
7. Operating范围外历史ERP不进入异常；
8. Sales Object影子投影；
9. BOM缺失；
10. Component缺失；
11. 幂等与正式业务数据保护。

## 16. 九个重点问题回答

1. **2,844个Operating ERP对象中有多少需要旺店通身份确认？** 全部2,844个；现有物化Goods主数据已确认2,844/2,844。它们中2,724个是直接经营Single，120个仅为Bundle Dependency。
2. **当前经营对象闭环率是多少？** 6,366/6,418，99.1898%。
3. **Single/Bundle能否完全由旺店通权威确定？** 正常对象可以；Goods决定Single、Suite决定Bundle。剩余51个源端查无身份，1个源端已删除，不能自动确定为当前有效对象。
4. **52个未解析编码是什么原因？** 37个平台标识误入、3个残缺编码、2个非ERP语义值、9个形式正常但源端查不到、1个已删除历史Suite。
5. **1,076个缺编码Link SKU有多少属于当前真实经营缺口？** 按生产库最后正式完整批次，1,076个全部是当前批次active缺口；但该批次仅到8月5日，需用最新完整平台批次重算后才能确认为今天的缺口。
6. **当前经营Bundle BOM完整率？** 有效Bundle 3,642/3,642，100%。
7. **Sales Object自动投影覆盖率？** 可自动投影6,366/6,418，99.1898%；相比当前经营范围内正式对象需新增2个Single投影。
8. **真正需要人工治理比例？** 对象级52/6,418=0.8102%；另有Link SKU缺编码1,076/33,005=3.2601%，必须分开表达。
9. **是否具备进入Phase 3 BOM版本权威化条件？** **具备进入隔离开发与影子运行的条件；不具备直接生产切换条件。**

## 17. Phase 3准入条件

可以开始：

- Suite独立身份表与有效期版本BOM设计；
- 342个旧表格Bundle向旺店通Suite权威结构的影子迁移；
- Sales Object自动投影器；
- 结构Hash、有效期和历史销售可解释测试。

生产切换前必须完成：

1. 以最新实际完整平台货品批次重新计算Operating ERP Set；
2. 处理或明确接受1,076条缺编码Link SKU；
3. 处理51个`erp_not_found`和1个`source_conflict`；
4. 建立Suite版本有效期，证明历史Daily Facts可按销售日解释；
5. 延续影子比较，确认正式指标、销量贡献、销售额和利润不变；
6. 保留旧全量同步和现有Resolver作为回滚兼容，直至观察窗口结束。

## 18. 最终指标表

| 指标 | 数量 | 占当前经营对象比例 | 是否阻断V3 |
|---|---:|---:|---|
| 自动完整闭环 | 6,366 | 99.1898% | 否 |
| 缺ERP编码 | 1,076条Link SKU | 不与6,418对象分母混算；占当前Link SKU 3.2601% | 阻断直接生产切换 |
| ERP不存在 | 51个编码 | 0.7946% | 阻断对应对象自动建立，不阻断Phase 3开发 |
| 类型冲突 | 0 | 0% | 否 |
| 来源冲突 | 1 | 0.0156% | 阻断对应对象自动激活 |
| BOM异常 | 0个有效Bundle | 0% | 否 |
| Product Mapping缺失 | 0个已确认经营对象 | 0% | 否 |
| 关系冲突 | 0 | 0% | 否 |

最终判断：Operating ERP Set + 旺店通Goods/Suite契约已经足以支撑Phase 3 BOM版本权威化；但只有在最新完整平台批次重算并完成异常隔离后，才可以讨论生产读取切换。
