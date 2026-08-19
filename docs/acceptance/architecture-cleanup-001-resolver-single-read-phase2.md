# 《Architecture Cleanup-001 Resolver单轨化 Phase 2验收报告》

验收日期：2026-08-19
验证环境：开发业务数据库只读副本 `/private/tmp/resolver-single-read-phase2.db`

## 一、结论

验收通过。正式业务关系读取已切换为 Sales Object Resolver 单读；Legacy Resolver 仅在调用方显式传入 `shadowCompare: true` 时执行。诊断比较只生成诊断结果，不参与、不覆盖正式业务返回。

## 二、修改范围

1. `server/capabilities/resolveLinkSkuRelationRead.js`
   - 正式路径始终调用 `ResolveLinkSkuSalesObject`。
   - 移除 Feature Flag 关闭或Scope未命中时返回Legacy结果的分支。
   - 移除正式请求开头无条件执行Legacy Resolver的双读。
   - 保留原业务读取契约字段，`resolverSource`固定为`sales_object`。
   - `shadowCompare: true`时才执行Legacy Resolver，并输出一致、差异类型和差异原因。
2. `server/capabilities/resolveLinkSkuSalesObject.js`
   - 在Sales Object解析结果中透传`salesLinkId`，避免为兼容业务契约再次查询Legacy Resolver。
3. `tests/resolveLinkSkuRelationRead.test.js`
   - 新增Sales Object-only fixture。
   - fixture不创建Legacy mapping，也不创建Legacy Combo Group。
   - 验证正式请求旧查询为0、诊断模式可比较且不改变正式结果。
4. `scripts/verify-sales-object-resolver-rollout-v2-data-020.js`
   - 将旧Feature Flag开关测试迁移为正式单读和显式Shadow Compare测试。
5. `scripts/verify-resolver-single-read-phase2.js`
   - 新增只读全量差异、性能、经营指标和数据库保护验证。
6. `package.json`
   - 将Resolver单读回归纳入`test:v2-cleanup`。

未修改关系写入、Product Structure审批、旧Resolver实现、销售事实、利润口径或数据库Schema。

## 三、正式读取与诊断模式

### 正式业务模式

- 返回来源：Sales Object。
- Legacy Resolver执行次数：0。
- Feature Flag保留为兼容元数据，不再控制正式结果回退。
- 无Sales Object时返回Sales Object模型的`missing`/`incomplete`/`conflict`结果，不再偷偷读取旧mapping补结果。

### Shadow Compare诊断模式

仅在显式传入`shadowCompare: true`时：

- 同时计算新旧组件集合；
- 输出`consistent`或`different`；
- 差异分类为`added`、`reduced`、`conflict`；
- 原因分别为`sales_object_only`、`legacy_only`、`component_set_mismatch`；
- 正式`results`始终来自Sales Object，不受诊断差异影响。

## 四、全量关系验证

对开发业务数据库副本中31,824条active Sales Object关系进行全量Shadow Compare：

|结果|数量|
|---|---:|
|完全一致|31,822|
|Sales Object新增关系|2|
|Legacy独有|0|
|组件冲突|0|

两条Sales Object-only关系：

- `sales-link-sku-62eb06ef921e2d596d0b9769`（HP0754-6）
- `sales-link-sku-c8dbe903dccc4ac962da9ccb`（hp0963-1）

两者均在不存在active Legacy mapping的情况下返回可用关系，证明单轨读取不会遗漏新模型独有关系。

## 五、性能结果

基于1,000个Link SKU、8轮热查询：

|模式|P50|P95|查询组成|
|---|---:|---:|---|
|Sales Object正式单读|16.588 ms|17.999 ms|新Resolver 6次，旧Resolver 0次|
|显式Shadow Compare双读|27.889 ms|29.807 ms|新旧Resolver均执行|

P50耗时下降40.524%。诊断模式不进入正式请求，因此不占用日常业务查询成本。

## 六、业务与数据保护

验证前后保持：

|对象|验证前|验证后|
|---|---:|---:|
|销售日报事实|11,548|11,548|
|Legacy mappings|43,375|43,375|
|Sales Objects|6,420|6,420|
|Sales Object关系|31,824|31,824|
|Sales Object Structures|6,420|6,420|
|Sales Object组件|10,480|10,480|

经营指标保持：

- 销售额：1,327,063.9502
- 利润：624,038.6962

数据库检查：

- `integrity_check`：`ok`
- `foreign_key_check`：0条错误

## 七、自动验证

- `npm run check`：通过。
- `npm run test:v2-cleanup`：2/2通过。
- `npm run test:product-business`：4/4通过。
- Sales Object-only fixture：通过。
- 正式路径旧Resolver查询计数：0。
- Shadow Compare业务返回守恒：通过。

## 八、后续建议

1. 保留Legacy Resolver文件和诊断入口，暂不删除，供发布后专项比对。
2. 诊断调用必须显式开启，不应由业务页面默认传入`shadowCompare`。
3. 下一阶段可清理各业务调用点上已经失去控制作用的旧Feature Flag参数，但该清理不影响本阶段单轨结果，也不应与关系写入改造混做。
