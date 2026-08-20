# Architecture Upgrade-003 V3关系主链切换 Phase 5验收报告

## 1. 验收结论

本阶段已经完成V3关系主链的代码能力、显式编排、最新完整平台批次复核、生产数据库副本迁移预演、连续两次幂等验证和Feature Flag回滚预演。

**最终结论：可以进入Shadow生产。**

该结论只允许先部署全部开关关闭的代码，再开启投影Shadow观察；当前不建议直接开启正式关系写入或完成主链切换。生产数据库、正式Resolver返回、销售事实和业务指标均未被本次演练修改。

## 2. 正式V3主链

正式编排固定为：

`平台货品完整批次 → Store / Link / Link SKU / ERP编码 → Operating ERP Set → 旺店通Goods/Suite按需补全 → Single/Bundle身份 → Bundle BOM Version → Sales Object自动投影 → Link SKU自动关系 → 异常候选`

编排由单一入口按顺序显式调用，Service之间不互相隐式触发。平台资产提交是独立完成的事实边界：旺店通失败时保留平台导入，状态进入`erp_enrichment_pending`；BOM失败时进入`bundle_bom_pending`，不猜测结构、不回滚平台资产。

## 3. Feature Flag与发布顺序

| 开关 | 作用 | 默认值 | 保护规则 |
|---|---|---|---|
| `V3_AUTO_PROJECTION` | `off / shadow / on`控制Sales Object及结构投影 | `off` | 非法值直接拒绝 |
| `V3_AUTO_RELATION_WRITE` | 控制Link SKU正式关系写入 | `off` | 仅当Projection=`on`时允许开启 |
| `V3_RELATION_READ` | 控制正式读取选择V3来源关系 | `off` | 关闭时继续读取切换前有效关系 |

建议发布顺序：

1. Release A：部署代码，三个开关全部关闭。
2. Release B：仅开启`V3_AUTO_PROJECTION=shadow`，比较结果，不写正式关系。
3. Release C：Shadow稳定后开启Projection和Relation Write，继续保持Relation Read关闭。
4. Release D：关系写入稳定且异常可解释后，再开启Relation Read并退出正常关系人工治理入口。

## 4. 最新完整平台批次复核

数据源：`8.19平台货品.xlsx`，32,275行；文件SHA256：`e1bdfccecc50343731a3bfa8df00b00bfb704fcc3e9ebeaef2c94c79374463ae`。隔离导入批次为完整批次，包含23个店铺。

| 指标 | 结果 |
|---|---:|
| Link | 8,486 |
| Link SKU | 32,177 |
| 有ERP/Suite编码 | 31,140 |
| 字面缺编码 | 1,037 |
| 其中明确“不适用” | 948 |
| 当前真实经营缺口 | 89（Single 88、Bundle 1） |
| 当前已有正式关系 | 31,117 |
| Operating ERP Set | 2,812 |
| Operating对象（Single + Suite） | 6,396 |
| Single确认 | 2,691 |
| Bundle确认 | 3,651 |
| 自动完整闭环 | 6,341 / 6,396（99.1401%） |
| 可自动处理正常Link SKU关系 | 31,113 / 31,113（100%） |
| 全部有编码Link SKU关系覆盖 | 31,117 / 31,140（99.9261%） |
| 全部Link SKU关系覆盖 | 31,117 / 32,177（96.7063%） |
| 关系冲突 | 1 |

Phase 4记录的1,076条缺编码并非全部是真实经营缺口。最新完整批次字面缺编码为1,037条，其中948条平台已明确标识为“无”，真正需要补源数据的经营缺口为89条。

## 5. 旺店通实时只读复核与异常

针对最新批次新增或变化的395个编码执行旺店通Goods/Suite实时只读复核，完成395/395，API失败0；其中Suite确认342、两端均未找到52、类型冲突1。其余未变化对象复用已验证的物化权威身份。

最新异常重新计算后为：

| 类型 | 对象数 | 说明 |
|---|---:|---|
| `erp_not_found` | 52 | Goods与Suite均未确认 |
| `sku_type_conflict` | 1 | `HP0264-5`同时出现身份冲突 |
| `source_conflict` | 1 | `FZH0118-15`源状态冲突 |
| `product_mapping_missing` | 1 | `BZ00008-1`缺Product Mapping |
| `relation_conflict` | 1条Link SKU | `HP0613-1`现有关系与V3投影不一致 |

这些对象保持异常，不通过Legacy Mapping、Product Structure或人工猜测补齐。当前经营Bundle 3,651/3,651均有完整BOM，BOM缺失、组件缺失和非法数量均为0。

## 6. 生产数据库副本迁移预演

演练使用完整生产数据库只读来源的隔离副本：`/private/tmp/v3-relation-main-chain-phase5-live.db`。正式生产数据库未连接、未写入。

| 资产 | Before | 第一次V3迁移后 | 变化 |
|---|---:|---:|---:|
| Sales Object | 8,099 | 8,118 | +19 |
| Structure | 8,099 | 8,118 | +19 |
| Structure Component | 14,348 | 14,367 | +19 |
| Link SKU Relation | 31,784 | 32,579 | +795 |
| V3来源关系 | 0 | 31,113 | +31,113（含30,318条既有关系补追溯证据） |
| Legacy Mapping | 43,316 | 43,316 | 0 |
| Legacy Product Structure | 10,949 | 10,949 | 0 |
| Manual Binding | 0 | 0 | 0 |
| 旧审批Item | 10,957 | 10,957 | 0 |
| Daily Facts | 11,548 | 11,548 | 0 |
| Product Mapping | 2,956 | 2,956 | 0 |
| Inventory Facts | 12,305 | 12,305 | 0 |

正常V3写链不再创建Product Structure、Legacy Mapping、Manual Binding或正常关系人工审批Candidate。旧审批能力仅保留历史兼容/异常用途。

## 7. 经济事实与数据保护

| 指标 | Before | After | 结果 |
|---|---:|---:|---|
| Daily Facts | 11,548 | 11,548 | 一致 |
| 销售额 | 1,327,063.9502 | 1,327,063.9502 | 一致 |
| 成本 | 574,096.4340 | 574,096.4340 | 一致 |
| 利润 | 624,038.6962 | 624,038.6962 | 一致 |
| Product Mapping | 2,956 | 2,956 | 一致 |
| 库存事实 | 12,305 | 12,305 | 一致 |

数据库检查：`integrity_check=ok`，`foreign_key_check=0`。

## 8. 幂等与回滚预演

同一隔离副本连续执行第二次完整迁移：Sales Object新增0、Structure新增0、Relation新增0、关系追溯更新0；异常使用稳定键，不产生重复业务资产，验证完全幂等。

关系追溯证据包含：平台批次ID/来源/文件Hash、平台ERP或Suite编码、旺店通身份、Sales Object、Structure ID/Version/Hash/Source、关系来源和是否由投影新建。

回滚预演结果：

- 关闭Projection和Relation Write后立即停止新增写入；
- 关闭Relation Read后可继续读取切换前的30,322条有效关系；
- 795条V3新建关系通过`source + createdByProjection + batch/version`可识别，不需要物理删除；
- 不需要恢复Daily Facts，也不需要删除历史Sales Object；
- 30,318条原有关系只补充V3追溯证据，标记为非投影新建，回滚读取仍保留。

## 9. Resolver与人工审批定位

当前Resolver不需要再创建或更换。正式读取仍是：

`Link SKU → Sales Object Relation → Sales Object Structure`

本阶段修改的是关系的权威生成源和Feature Flag选择，不是再造第二个Resolver。正常对象已经可以完全自动生成关系，不再需要人工审批；人工入口仅处理缺编码、源冲突、关系冲突、BOM异常和Product Mapping缺失等真实异常。

## 10. 自动测试与门禁

| 验证 | 结果 |
|---|---|
| Phase 5专项测试 | 36/36通过 |
| `npm run check` | 通过 |
| V2 Cleanup测试 | 6/6通过 |
| Product Business测试 | 8/8通过 |
| 平台货品资产测试 | 1/1通过 |
| 旺店通Suite测试 | 6/6通过 |
| Legacy写入门禁 | risk=none |
| `git diff --check` | 通过 |
| 连续两次生产副本迁移 | 第二次完全幂等 |

专项测试覆盖：全部Flag关闭、Shadow、Projection、Relation Write依赖保护、API失败、BOM失败、Single、Bundle、缺编码、ERP不存在、关系冲突、重复运行、Legacy写入门禁、Flag回滚、生产副本迁移和Daily Facts保护。

## 11. 提交边界

当前工作区仍混合包含Phase 1–5及既有恢复报告等未提交内容。本阶段未执行`git add -A`、未提交、未发布。后续必须先按逻辑边界审计并拆分：

1. Operating ERP Set与平台批次语义；
2. 旺店通身份/BOM权威能力；
3. Sales Object自动投影；
4. V3 Feature Flag、编排、关系写读选择及专项测试；
5. 报告和隔离验证脚本。

## 12. 必答结论

1. **真实缺编码Link SKU还有多少？** 字面缺编码1,037；排除948条明确“不适用”后，当前真实经营缺口89。
2. **V3自动覆盖率是多少？** 正常可自动处理关系31,113/31,113，覆盖率100%；全部有编码Link SKU覆盖99.9261%。
3. **正常关系是否需要人工审批？** 不需要，人工治理只处理真实异常。
4. **正式写链是否产生Legacy资产？** 预演新增Legacy Mapping、Product Structure、Manual Binding、旧审批Item均为0。
5. **Resolver是否需要修改？** 不需要更换Resolver，只需切换关系生成源及读取选择。
6. **生产副本新增什么？** 新增19个Sales Object、19个Structure、19条Component、795条Relation，并为30,318条既有关系补V3追溯证据。
7. **第二次是否完全幂等？** 是，核心业务资产新增均为0。
8. **Feature Flag能否安全回滚？** 能；关闭写/读Flag即可停写并回到切换前有效关系，无需恢复销售事实。
9. **是否具备生产分阶段切换条件？** 具备Release A和Release B条件；尚需生产Shadow观察后才允许进入正式写链。

## 13. 最终判定

**可以进入Shadow生产**

进入下一阶段前置条件：使用干净提交链部署；全部Flag默认关闭；先完成Release A观察，再仅开启Shadow；持续监控自动投影率、关系冲突、52个ERP不存在、BOM异常、Product Mapping缺失、Legacy新增和Daily Facts变化。未完成生产Shadow观察前，不得开启正式Relation Write或Relation Read。
