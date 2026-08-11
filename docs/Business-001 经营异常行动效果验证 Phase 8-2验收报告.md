# Business-001 经营异常行动效果验证 Phase 8-2 验收报告

## 1. 实现内容

销售异常返回增加 `baselineSnapshot`，在人工创建关键行动时随 `sales_anomaly` 来源一并冻结保存。新增只读 Capability `QueryBusinessImprovementResult`，并在已发起关键行动详情接入标准模块 `business_improvement_result`。

模块仅展示行动前、行动后及变化率，不判断原因，也不输出“有效/无效”结论。

## 2. 基线快照

`baselineSnapshot` 包含：

- `objectType`：`salesLink` 或 `product`；
- `objectId`；
- `period.startDate/endDate`；
- `salesAmount`；
- `profitAmount`；
- `quantity`；
- `dataSource=daily_fact_v1`。

基线来自异常发现过程中调用的 `QueryDailySalesSummary` 批量对比结果，不由页面查询事实表。

## 3. 结果周期规则

结果期从基线结束日的下一天开始，长度与基线周期完全一致。例如基线为2026-08-03至2026-08-09，结果期为2026-08-10至2026-08-16。

结果通过 `QueryDailySalesSummary` 查询同一产品或链接。Capability和页面均不直接读取日报事实。

## 4. 返回结构

`QueryBusinessImprovementResult({ keyActionId })` 支持待发起关键行动ID和后续流程实例ID，返回：

- `before`：销售额、利润、销量；
- `after`：销售额、利润、销量；
- `changeRate`：三项指标各自的 `(after-before)/before`；
- `period.before/after`；
- `dataSource=daily_fact_v1`；
- `status`：`result_available`、`awaiting_data`、`baseline_missing`、`not_applicable` 或 `not_found`。

基线为0或结果期无事实时变化率返回 `null`，不会制造除零结果或把无数据解释为0。

## 5. 页面展示

关键行动详情增加“经营改善结果”模块，展示：

- 行动前和行动后周期；
- 销售额前后值及变化；
- 利润前后值及变化；
- 销量前后值及变化；
- 结果期无事实时显示“等待结果数据/暂无结果”。

页面明确提示数值变化不代表原因或行动有效性判断。

## 6. 隔离验证

验证行动基线：销售额160.53、利润26.03、销量9，周期2026-08-03至2026-08-09。

无结果事实时：

- 状态 `awaiting_data`；
- after三项指标均为 `null`；
- changeRate三项均为 `null`。

在隔离数据库加入结果期测试事实后：

- 销售额：160.53 → 200，变化率24.5873%；
- 利润：26.03 → 80，变化率207.3377%；
- 销量：9 → 5，变化率-44.4444%。

计算结果正确，重复查询稳定。

## 7. 数据保护

隔离测试事实准备完成后，结果查询前后保持：

- 日报事实：3669 → 3669；
- V2 Mapping：20819 → 20819；
- ERP用途：86 → 86；
- 任务：5481 → 5481。

测试事实只存在于临时隔离数据库。开发库和生产库均未写入事实。

- `integrity_check=ok`；
- `foreign_key_check` 无异常；
- `npm run check` 通过；
- `git diff --check` 通过；
- 本阶段未发布生产。
