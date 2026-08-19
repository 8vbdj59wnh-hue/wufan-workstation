# 《Architecture Cleanup-001 关系写入单轨化 Phase 3验收报告》

验收日期：2026-08-19
隔离验证数据库：`/private/tmp/relation-write-single-track-phase3.db`

## 一、结论

验收通过。新关系的生产写入路径已经从Legacy Mapping与Link Product Structure切换为Sales Object单轨写入。

新审批应用只生成：

- `sales_objects`
- `sales_link_sku_sales_object_relations`
- `sales_object_structures`
- `sales_object_structure_components`

其中`Sales Link SKU → Sales Object`关系表是Resolver能够从Link SKU找到Sales Object的必要新模型资产，不属于Legacy关系。

以下Legacy资产不再由生产Service新增、更新或重新激活：

- `sales_link_sku_erp_mappings`
- `sales_link_sku_product_structures`
- `sales_link_sku_product_structure_components`
- `platform_sku_manual_bindings`

## 二、审批写入审计

### 修改前

`productStructureApplicationApprovalService`存在三段并行写入：

1. 创建审批批次时预建Link Product Structure和组件；
2. 应用审批时停用旧active mapping；
3. 生成或重新激活mapping、激活旧Product Structure，同时补写Sales Object。

这导致同一审批同时维护两套正式关系。

### 修改后

1. 审批批次只保存目标组件快照到申请项，不再预建旧Product Structure。
2. 审批应用以申请项冻结的目标组件为准，事务生成Sales Object及其结构。
3. 不再停用、插入、更新或重新激活Legacy mapping。
4. 不再激活Link Product Structure。
5. 目标ERP SKU必须存在且为active，否则拒绝应用。
6. 当前Sales Object结构与审批快照不一致时拒绝应用，避免覆盖并发变化。
7. 被多个Link SKU复用的Sales Object发生结构变化时，只为当前Link SKU创建独立Sales Object，不影响其他链接。

## 三、兼容策略

- Legacy mapping及旧Product Structure数据全部保留，只读兼容。
- Legacy Resolver继续保留，仅用于显式诊断比较。
- 历史申请批次、申请项和历史审计记录不删除、不改写。
- 新申请使用申请项的目标组件快照、审核人和审核时间作为审批记录；正式Sales Object Structure同时保存审核人、审核时间和来源批次。
- 旧一次性迁移函数仍保留在`server/db.js`，不在运行时调用。

## 四、人工绑定与候选确认

### platform_sku_manual_bindings

人工选择产品后：

- 通过产品唯一ERP SKU形成Sales Object关系审批；
- 产品ID及操作人作为审批证据保存；
- 不再新增或更新`platform_sku_manual_bindings`；
- 既有历史绑定仍允许读取，取消旧绑定只删除历史记录，不改变已审核Sales Object。

### Single候选确认

- 不再直接查询或生成active mapping；
- 以当前Sales Object结构判断幂等或冲突；
- 新候选进入Sales Object结构审批；
- 已与Sales Object一致的候选可幂等确认，`mappingId`保持为空。

平台货品Excel、旺店通平台货品、ERP平台货品和ERP产品关系导入均复用同一审批入口。

## 五、隔离数据库验证

### 新关系审批

审批前后Legacy资产：

|数据资产|审批前|审批后|变化|
|---|---:|---:|---:|
|日报事实|11,548|11,548|0|
|Legacy mappings|43,375|43,375|0|
|Legacy Product Structures|11,004|11,004|0|
|Legacy Structure Components|22,558|22,558|0|
|Legacy Manual Bindings|0|0|0|

Sales Object资产：

|数据资产|审批前|审批后|变化|
|---|---:|---:|---:|
|Sales Objects|6,420|6,421|+1|
|Link SKU关系|31,824|31,825|+1|
|Sales Object Structures|6,420|6,421|+1|
|Sales Object Components|10,480|10,481|+1|

应用返回：

- `outcome=applied`
- `generatedMappingCount=0`
- `generatedComponentCount=1`
- 返回正式`salesObjectId`和`salesObjectStructureId`

### Resolver验证

审批完成后立即通过统一Resolver读取：

- `resolverSource=sales_object`
- `isUsable=true`
- ERP SKU及quantity与审批目标完全一致
- mapping契约中的`mappingId=null`，明确没有Legacy mapping

### 幂等与回滚

- 重复应用同一审批：`outcome=idempotent`，所有数量不变化。
- 模拟结构切换后失败：`outcome=rolled_back`。
- Sales Object、关系、结构、组件和Legacy资产均恢复到事务前数量。

### 人工绑定

- 返回`outcome=governance_pending`。
- 生成Sales Object审批批次。
- `legacyManualBindingCreated=false`。
- `platform_sku_manual_bindings`数量不增长。

## 六、自动防回归

`check-link-center-v2-cleanup`新增检查：

- 生产Service禁止写Legacy mapping；
- 禁止写Link Product Structure及其组件；
- 禁止新增`platform_sku_manual_bindings`；
- 新关系审批只允许写Sales Object结构。

代码扫描仅发现：

- Schema触发器定义；
- `server/db.js`中显式、未自动调用的一次性历史迁移函数。

未发现生产Service Legacy关系写入。

## 七、验证结果

- `npm run check`：通过。
- `npm run test:v2-cleanup`：2/2通过。
- `npm run test:product-business`：4/4通过。
- `git diff --check`：通过。
- 开发数据库只读检查：`integrity_check=ok`。
- 开发数据库只读检查：`foreign_key_check=0`。
- 隔离应用数据库：`integrity_check=ok`。
- 隔离应用数据库：`foreign_key_check=0`。

## 八、数据保护结论

开发业务数据库未执行关系写入。所有应用、幂等和失败回滚验证均在复制的隔离数据库完成。销售事实、Legacy mapping、旧Product Structure、ERP SKU及产品数据均未修改。

## 九、后续建议

1. 下一阶段可将历史脚本中直接创建Legacy mapping的旧验证fixture迁移为Sales Object fixture；这些脚本不属于生产Service，但不应继续作为新开发样例。
2. 可逐步将`Product Structure Application`页面文案改为`Sales Object Structure Approval`，只调整展示命名，不影响本阶段写入结果。
3. 暂不删除Legacy表，待观察期结束且诊断比较不再需要后再单独制定退出方案。
