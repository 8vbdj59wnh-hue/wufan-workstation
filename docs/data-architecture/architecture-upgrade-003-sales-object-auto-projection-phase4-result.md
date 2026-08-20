# Architecture Upgrade-003 Sales Object自动投影 Phase 4验收报告

## 1. 验收结论

本阶段已在生产快照的隔离副本中完成 Sales Object 自动投影开发与影子验证。正式 Resolver 未切换，生产数据库未修改，Daily Facts、Product、Product Mapping、Legacy Mapping 和 Product Structure均未改变。

当前经营销售对象候选6,418个，其中6,366个可以由平台货品身份与旺店通权威主数据自动投影：Single 2,724个、Bundle 3,642个。52个真实异常没有创建伪造Sales Object。

隔离投影新增：

- Sales Object：2个；
- Sales Object Structure：2个；
- Link SKU关系：18条；
- Product Structure：0；
- Legacy Mapping：0；
- 人工审批项：0。

第二次执行新增全部为0，说明幂等成立。

最终判断：**正常经营商品关系已经可以由“人工审批型系统”迁移为“自动投影 + 异常治理型系统”**。Phase 5可以继续做正式触发编排和读取链灰度，但最新完整平台批次仍是2026-08-05，不能在更新平台批次前把1,076个缺编码Link SKU判定为永久异常。

## 2. V3自动投影规则

### Single

`平台ERP编码 → 旺店通Goods确认 → Single Sales Object → ERP SKU ×1`

- Sales Object编码按ERP商家编码唯一；
- 已有正确对象和结构只更新权威来源语义；
- 不存在时使用确定性ID创建对象、Version 1结构和ERP SKU ×1组件；
- Product Mapping不参与创建条件；
- Product Mapping缺失只产生独立治理候选。

### Bundle

`平台Suite编码 → 旺店通Suite确认 → Bundle Sales Object → 当前权威BOM`

- 复用Phase 3的 `sales_object_structures` 和组件；
- Bundle首次出现时可以直接使用旺店通BOM创建；
- 结构变化继续由Phase 3版本机制处理；
- 人工不得覆盖 `wangdian_suite_api` 当前有效结构。

### Link SKU关系

`最新完整平台批次 Link SKU → ERP/Suite编码 → 自动投影Sales Object`

- 正确关系幂等保留；
- 缺失关系自动创建；
- 已存在不同active关系时返回 `relation_conflict`，不静默覆盖；
- 缺编码或身份异常时不猜测关系。

## 3. 来源字段评估

现有字段已经足够，不新增重复来源字段：

|对象|source|sourceType|语义|
|---|---|---|---|
|Single Sales Object|wangdian|wangdian_goods_api|旺店通Goods权威身份自动投影|
|Bundle Sales Object|wangdian|wangdian_suite_api|旺店通Suite权威身份和BOM投影|
|Link SKU关系|—|platform_goods_v3_projection|平台货品身份经旺店通确认后的自动关系|
|历史Excel|原值保留|combo_master_excel / legacy_excel|只读历史证据|
|历史人工对象|原值保留|manual_legacy等|只读兼容和历史审计|

## 4. 真实投影结果

|指标|结果|
|---|---:|
|当前经营销售对象候选|6,418|
|V3自动投影成功|6,366|
|自动投影覆盖率|99.1898%|
|Single投影|2,724 / 2,724（100%）|
|Bundle投影|3,642 / 3,642（100%）|
|新增Sales Object|2|
|更新为权威来源语义|6,364|
|新增Structure|2|
|第二次执行新增对象/结构|0 / 0|

Sales Object从8,099增加至8,101。新增仅为已确认缺口 `HP1025-1` 和 `HP1055-1`，没有为52个异常编码创建对象。

## 5. 两个已知缺失投影

|编码|结果|自动关联Link SKU|
|---|---|---:|
|HP1025-1|创建Single Sales Object及ERP SKU ×1结构|8|
|HP1055-1|创建Single Sales Object及ERP SKU ×1结构|5|

两者均由旺店通Goods身份自动生成，没有创建人工审批任务、Product Structure或Legacy Mapping。

## 6. Link SKU自动关系

最新完整平台批次共有33,005个Link SKU：

|分类|数量|
|---|---:|
|投影前正式关系一致|31,759|
|V3新增正确关系|18|
|投影后正式关系一致|31,777|
|真关系冲突|0|
|缺ERP/Suite编码|1,076|
|有编码但身份无法确认|152|

覆盖率需分口径解释：

- 已确认可投影Link SKU：31,777 / 31,777，100%；
- 有编码Link SKU：31,777 / 31,929，99.5239%；
- 最新批次全部Link SKU：31,777 / 33,005，96.2794%。

后两个口径的缺口来自源数据缺失或权威身份异常，不是自动投影失败。

## 7. 52个经营编码异常

|异常|编码数量|影响Link SKU|处理|
|---|---:|---:|---|
|erp_not_found|51|151|保持异常，不创建Sales Object|
|source_conflict|1|1|`FZH0118-15`为已删除Suite，保持来源冲突|
|relation_conflict|0|0|无|
|sku_type_conflict|0|0|无|

此外1,076个Link SKU缺少ERP/Suite编码。由于当前最新完整平台批次是2026-08-05，本阶段只保留待复核状态，不批量治理、不猜测关系。

## 8. 人工审批退出

历史数据中，10,956个当前可由V3完整解释的对象曾进入Product Structure Application审批。这代表历史正常关系审批负担，不代表当前仍需治理。

本阶段调整后：

- V3确认的Single目标与 `ERP SKU ×1` 一致时，不创建审批项；
- V3确认的Bundle目标与旺店通BOM一致时，不创建审批项；
- Product Mapping缺失不阻断自动投影；
- 正常关系人工审批新增：0；
- 异常关系仍可进入人工治理边界。

旧入口若遇到V3可自动解释关系，返回 `v3_auto_projection_required`，而不是 `product_structure_review_pending`。

## 9. Legacy资产保护

|资产|投影前|投影后|变化|
|---|---:|---:|---:|
|Link Product Structure|10,949|10,949|0|
|Product Structure组件|22,503|22,503|0|
|Legacy Mapping|43,316|43,316|0|
|Product Structure Application项|10,957|10,957|0|

正式自动投影服务对Legacy Mapping和Link Product Structure保持零读取、零写入；Legacy统计只存在于隔离验收脚本。

## 10. 历史Sales Object分类

投影后Sales Object共8,101个：

|分类|数量|
|---|---:|
|operating|6,366|
|historical|1,735|
|source_removed|0|
|legacy_only|0|

本阶段没有删除或停用1,735个非当前经营对象，仅完成影子分类。

## 11. V3影子Resolver对比

### 投影前

|状态|Link SKU数量|
|---|---:|
|same|31,759|
|v3_missing_current|18|
|current_missing_v3|0|
|relation_conflict|0|
|type_conflict|0|
|source_conflict|1|
|unresolved|1,227|

### 隔离投影后

|状态|Link SKU数量|
|---|---:|
|same|31,777|
|v3_missing_current|0|
|current_missing_v3|0|
|relation_conflict|0|
|type_conflict|0|
|source_conflict|1|
|unresolved|1,227|

正式Resolver返回没有改变。V3影子结果只补齐18条已确认缺失关系，没有减少现有正确关系，也没有产生系统性冲突。

## 12. Product经营和销售事实保护

|指标|投影前|投影后|
|---|---:|---:|
|ERP SKU|6,906|6,906|
|Products|2,958|2,958|
|Product Mapping|2,956|2,956|
|Daily Facts|11,548|11,548|
|销售额|1,327,063.9502|1,327,063.9502|
|成本|574,096.4340|574,096.4340|
|利润|624,038.6962|624,038.6962|

当前6,366个可投影经营对象的Product Mapping均完整。自动投影没有复制销售事实、没有把Bundle金额分摊到组件，也没有引入重复销售额。

## 13. 事务、幂等和回滚

- 全批投影使用单事务；
- 注入失败后Sales Object、Structure和Relation全部回滚；
- 第二次真实投影：对象新增0、结构新增0、关系新增0；
- 已有不同active关系只记录冲突，不自动覆盖；
- 可以关闭自动投影并继续使用当前正式Resolver；
- 历史Sales Object、Product Structure、Legacy Mapping均保留。

## 14. 正式触发顺序设计

未来正式编排顺序：

`平台货品完整导入`
→ `Operating ERP Set更新`
→ `旺店通Goods/Suite按需补全`
→ `Phase 3 BOM版本更新`
→ `Sales Object自动投影`
→ `Link SKU自动关系`
→ `异常治理`

每一步成功后才能推进下一步。身份或BOM失败时不产生半成品关系；异常进入限定分类，正常对象不进入人工审批。

## 15. 自动测试与回归

- Phase 4专项测试：17/17通过；
- Phase 3 BOM专项测试：14/14通过；
- 旺店通Suite测试：6/6通过；
- Operating ERP身份测试：11/11通过；
- V2 Cleanup测试：6/6通过；
- 产品经营回归：8/8通过；
- `npm run check`：通过；
- `git diff --check`：通过；
- 隔离库 `integrity_check`：`ok`；
- 隔离库 `foreign_key_check`：0。

## 16. 核心问题回答

1. **当前经营对象能否由V3自动完整生成Sales Object？** 6,366个权威身份已确认对象可以，覆盖全部Single和Bundle；52个真实异常不会伪造生成。
2. **正常Link SKU关系是否可以完全自动建立？** 可以。31,777个具备完整权威身份的Link SKU达到100%自动关系覆盖。
3. **两个已知Sales Object缺口是否自动补齐？** 是，且自动建立13条相关Link SKU关系。
4. **正常关系是否还需要Product Structure审批？** 不需要。当前历史正常审批负担10,956项，V3路径新增为0。
5. **Product Mapping缺失是否可以降级为独立治理问题？** 可以；它不阻断ERP身份、Sales Object或Link关系。本批当前对象映射缺失为0。
6. **当前真正需要人工治理的对象还有多少？** 52个经营编码需要身份/来源治理；另有1,076个缺编码Link SKU等待更新完整平台批次后复核。正常结构治理对象为0。
7. **V3影子Resolver与正式Resolver差异是什么？** 投影前仅有18条V3正确新增关系；投影后全部一致。无当前独有关系、无真关系冲突、无类型冲突。
8. **是否具备Phase 5正式Link SKU关系自动化与读链切换条件？** **有条件具备。** 自动投影、幂等、冲突保护和数据保护均通过；正式切换前仍需完成触发编排、Feature Flag、最新平台完整批次复核及生产迁移回滚预演。

## 17. 最终验收指标

|指标|结果|
|---|---:|
|当前经营销售对象候选|6,418|
|V3自动投影成功|6,366|
|自动投影覆盖率|99.1898%|
|Single投影覆盖率|100%|
|Bundle投影覆盖率|100%|
|已确认Link SKU自动关系覆盖率|100%|
|V3新增正确关系|18|
|真关系冲突|0|
|正常关系人工审批新增|0|
|Product Structure新增|0|
|Legacy Mapping新增|0|
|真正身份治理编码|52|
|缺编码待复核Link SKU|1,076|

## 18. Phase 5前置条件

1. 导入一份新的、确认完整的平台货品批次，重新核对1,076个缺编码Link SKU；
2. 用Feature Flag控制自动投影触发和读链灰度；
3. 生产迁移预演必须证明第二次执行零增长；
4. 异常日志必须区分缺编码、ERP不存在、来源冲突和关系冲突；
5. 正式读取切换前继续保留当前Resolver、历史Sales Object和Legacy只读资产；
6. 不在Phase 5修改Daily Facts或Product销售金额口径。
