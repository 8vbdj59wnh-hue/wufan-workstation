# Architecture Upgrade-003 旺店通BOM版本权威化 Phase 3验收报告

## 1. 结论

本阶段在生产快照副本 `/private/tmp/wangdian-bom-authority-phase3.db` 完成，未修改生产数据库，未切换正式 Resolver，未修改 Daily Facts、Product Mapping、ERP SKU、Link 关系或 Legacy Product Structure。

当前经营范围内，`goods.Suite.search` 可以作为 Bundle **当前结构**的唯一权威来源：3,642 个经营 Bundle 全部具有 BOM，组件和数量与当前 Sales Object Structure 完全一致。342 个历史 Excel Bundle 也全部与旺店通当前 BOM 一致，可以停止把 Excel 当作当前结构定义来源，转为历史证据保留。

历史时间语义不能被夸大：2,490 条 Bundle 销售事实发生于 2026-07-09 至 2026-08-09，早于本次旺店通权威验证。全部事实都能由一致的 Legacy Product Structure 作为历史证据解释，但没有一条具备旺店通当日版本证据。因此：

- 历史 BOM 可解释覆盖率：100%；
- 旺店通精确历史版本覆盖率：0%；
- 历史 Product 贡献数量可以影子计算；
- 不得把当前 BOM 回填成历史 `exact`，也不得在证据不足时宣称精确回放。

## 2. 模型评估与最小扩展

继续复用：

- `sales_object_structures`：结构定义、结构 Hash、结构版本、状态和来源；
- `sales_object_structure_components`：ERP SKU组件与数量。

结构表补充：

- `validityBasis`：`exact / inferred / legacy_evidence / unknown`；
- `sourceState`：`active / source_removed`；
- `sourceUpdatedAt`；
- `lastVerifiedAt`；
- `syncedAt`。

新增辅助表 `sales_object_structure_effective_periods`，只保存结构的有效期间和证据，不重复保存 BOM 组件。增加它的原因是现有表对 `(salesObjectId, structureHash)` 唯一，且只有一组 `effectiveFrom/effectiveTo`，无法表达“Bundle删除后恢复，恢复后的BOM与删除前完全相同”所形成的多个不连续有效期间。

结论：现有 Sales Object Structure 足以承载 BOM 定义和版本；需要有效期间证据扩展才能完整承载删除、恢复及销售日期解析。没有建立第三套 BOM 组件模型。

## 3. BOM版本规则

|场景|处理|
|---|---|
|首次出现|创建 Version 1，激活结构并开启有效期间|
|BOM Hash一致|不创建版本，仅更新验证时间、来源更新时间和同步时间|
|组件或数量变化|旧期间关闭，旧结构 superseded，新建 Version N+1并开启新期间|
|旺店通删除|不删除结构和组件；关闭当前期间，标记 `source_removed`|
|相同BOM重新启用|复用结构定义，开启新的有效期间，不覆盖删除前期间|
|人工修改正常旺店通BOM|拒绝并返回 `wangdian_bom_manual_override_blocked`|

销售日期解析使用半开区间：`validFrom <= Sale Date < validTo`。没有匹配期间时返回 `historical_bom_unknown`，禁止自动拿当前 BOM 冒充精确历史。

## 4. 当前经营Bundle验证

|状态|Bundle数量|
|---|---:|
|当前经营Bundle|3,642|
|旺店通BOM可用|3,642|
|Sales Object Structure完全一致|3,642|
|Sales Object缺结构|0|
|Component差异|0|
|Quantity差异|0|
|多active版本|0|

其中当前系统已经物化为 `wangdian_suite_api` 的 3,300 个 Bundle 复用 Phase 2 已验证结构；342 个历史 Excel Bundle 使用 Phase 2 的旺店通实时只读响应再次核对。未在本阶段对3,642个对象重新发起生产写同步。

## 5. 342个历史Excel Bundle

|分类|数量|处理|
|---|---:|---|
|与旺店通当前BOM完全一致|342|当前结构由旺店通接管；Excel仅保留历史证据|
|Component差异|0|无|
|Quantity差异|0|无|
|旺店通不存在|0|无|

不得删除历史 Excel 资产。它仍可证明旧时间段的结构，但不再具有修改当前 BOM 的权力。

## 6. Legacy Product Structure影子对比

按经营 Bundle 聚合比较：

|状态|Bundle数量|
|---|---:|
|完全一致|3,642|
|Product Structure缺失|0|
|Component差异|0|
|Quantity差异|0|
|旺店通缺失|0|

结论：对正常经营 Bundle，Product Structure 没有独立定义当前结构的业务价值。它在现阶段仅保留历史证据和兼容审计价值，不应继续作为当前结构来源，也不应允许人工审批覆盖正常旺店通 BOM。

## 7. 历史销售BOM解析

Bundle销售事实共2,490行，涉及607个Link SKU和431个Bundle。

|证据等级|事实数|占比|含义|
|---|---:|---:|---|
|exact|0|0%|没有旺店通当日版本证据|
|legacy_evidence|2,490|100%|Legacy结构与当前旺店通BOM一致，可作为历史证据|
|inferred|0|0%|本批不需要仅凭当前结构推断|
|unknown|0|0%|没有完全无法解释的事实|

“可解释100%”不等于“精确历史版本100%”。Phase 6若要正式计算历史 Bundle Contribution，必须在接口和报表中保留证据等级，不得把 `legacy_evidence` 显示为 `exact`。

## 8. Product贡献数量影子计算

按 `Bundle Quantity × Component Quantity` 计算，仅生成数量贡献：

- Bundle事实：2,490行；
- 涉及组件ERP SKU：337个；
- Bundle Contribution Quantity合计：21,676；
- 未创建新销售事实；
- 未拆分Bundle销售额、成本或利润。

正式经营指标保持：

|指标|隔离前/后|
|---|---:|
|Daily Facts|11,548|
|销售额|1,327,063.9502|
|成本|574,096.4340|
|利润|624,038.6962|

## 9. V3 BOM影子Resolver

影子输入为 `Bundle + Sale Date`，正式业务仍使用当前稳定读取链。

|影子状态|Bundle数量|
|---|---:|
|same|3,642|
|v3_more_complete|0|
|legacy_more_complete|0|
|conflict|0|
|unknown|0|

当前结构比较一致率为100%。历史日期查询仍按证据等级返回，避免当前结构倒灌为精确历史。

## 10. 真正BOM异常与人工治理

|异常类型|数量|
|---|---:|
|suite_not_found|0|
|bom_missing|0|
|component_not_found|0|
|invalid_quantity|0|
|historical_bom_unknown|0|
|source_conflict|0|

当前经营 Bundle 的 BOM 人工治理率为0%。人工能力应只用于标记源异常、请求重新同步、补充说明或处理 Product Mapping，不再负责建立或修改正常 Bundle 结构。

## 11. 自动测试与数据保护

- Phase 3专项测试：14/14通过；
- 旺店通Suite同步测试：6/6通过；
- Operating ERP身份测试：11/11通过；
- 产品经营回归：8/8通过；
- `npm run check`：在标准本机进程环境复跑通过；
- `git diff --check`：通过；
- 隔离库 `integrity_check`：`ok`；
- 隔离库 `foreign_key_check`：0项；
- 新环境初始化和现有快照迁移均通过。

全量 `npm run check` 在受限执行沙箱内的目标管理隔离API探测曾因子进程被提前结束而失败；切换到标准本机进程环境复跑后完整通过，确认不是BOM逻辑或Schema初始化问题。

## 12. 七项核心回答

1. **旺店通BOM是否足以作为当前Bundle唯一权威结构？** 是。当前经营范围3,642/3,642覆盖且无结构差异。
2. **现有Sales Object Structure是否足以承载BOM版本？** 结构定义足够；删除后重启用的多有效期间不足，已用有效期间证据表作最小扩展。
3. **历史销售有多少可以定位到正确BOM版本？** 2,490/2,490可由历史证据解释；0/2,490具备旺店通精确当日版本，二者必须区分。
4. **342个历史Excel Bundle如何处理？** 全部与旺店通当前结构一致；旺店通接管当前权威，Excel只读保留为历史证据。
5. **Product Structure还有多少独立业务价值？** 对当前正常经营Bundle没有独立当前结构价值；仅保留历史证据和兼容审计价值。
6. **人工审批是否还有必要修改正常Bundle结构？** 没有。正常旺店通BOM的组件、数量和类型禁止人工覆盖。
7. **是否具备进入Phase 4 Sales Object自动投影的条件？** **有条件具备。** 当前结构自动投影和影子读取已达到100%一致，完整检查已通过；Phase 4可继续隔离/灰度，但在历史有效期证据策略和迁移回滚预演完成前，不应切换生产主链。

## 13. 最终验收表

|指标|数量/比例|目标|是否通过|
|---|---:|---:|---|
|当前Bundle BOM覆盖率|3,642 / 3,642（100%）|100%|通过|
|Structure一致率|3,642 / 3,642（100%）|100%|通过|
|历史销售BOM可解释率|2,490 / 2,490（100%）|100%|通过|
|历史销售BOM精确率|0 / 2,490（0%）|不得伪造精确历史|符合约束，未达精确回放|
|影子Resolver一致率|3,642 / 3,642（100%）|100%|通过|
|真正人工治理率|0 / 3,642（0%）|尽可能低|通过|

## 14. 下一阶段条件

Phase 4可以继续做Sales Object自动投影的隔离生成、幂等和灰度比较。生产切换前必须补齐：

1. 明确历史销售界面和计算结果携带 `exact / legacy_evidence / inferred / unknown`；
2. 完成有效期间表的发布迁移预演与回滚验证；
3. 保持旧Resolver和Product Structure只读兼容，不删除历史证据；
4. 不允许Phase 4顺带拆分Bundle销售额、成本或利润。
