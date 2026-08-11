# Business-001 经营异常分析 V1 Phase 7-3 验收报告

## 1. 实现内容

新增只读 Capability `QueryBusinessAnomalies` 和标准 UI Module `business_anomalies`，接入经营驾驶舱“经营异常”区域。支持销售链接与产品两种经营对象，展示高风险、需关注和全部异常数量，并可进入产品详情、链接中心或数据更新页面。

## 2. 异常规则

- `sales_drop`：近7日销售额较前7日下降达到阈值，默认30%；
- `profit_drop`：近7日利润较前7日下降达到阈值，默认30%；
- `sales_gap`：前期存在销售，最近连续3日没有销售事实；
- `data_quality_issue`：直接映射 `QuerySalesDailyDataQuality` 的健康状态。

严重等级按下降幅度划分：50%及以上为 high，30%—50%为 medium，10%—30%为 low。默认阈值为30%，因此默认结果不会产生10%—30%的低风险下降项；Capability允许最低10%的显式阈值。

## 3. 数据边界

对象对比通过 `QueryDailySalesSummary` 新增的批量comparison模式完成。异常 Capability不直接查询销售日报事实，不读取旧周期销售事实，也不解释关系。数据质量异常直接消费 `QuerySalesDailyDataQuality`。

`data_quality_issue` 是批次级全局异常，返回 `objectType=dataQuality`；经营对象异常严格限制为 `salesLink` 和 `product`，避免把全局数据质量问题伪装成某个链接或产品问题。

## 4. 无数据规则

销售/利润下降必须同时满足当前期与对比期均有事实；缺失事实不会转换为0，也不会误报下降。销售断档独立判断，返回 `currentValue=null`，明确表达“无事实”而非销售额为0。

## 5. 隔离验证

在3668条日报事实的隔离副本中模拟：

- 一个链接当前销售额与利润缩减90%，成功发现 `sales_drop`、`profit_drop`；
- 一个链接删除最近3日隔离事实，成功发现 `sales_gap`；
- 无事实对象不进入下降异常；
- 产品与链接两种对象均能返回；
- 重复执行结果稳定。

模拟后的结果为162项：high 45、medium 117；其中销售下降55、利润下降47、销售断档59、数据质量问题1。

## 6. 性能

每次异常查询固定执行：一次数据质量查询，以及产品、链接各一次服务端批量对比聚合。不存在逐产品、逐链接调用和N+1查询。

## 7. 数据保护

模拟数据只存在于临时隔离副本。异常查询前后保持：日报事实3665、V2 Mapping 20819、ERP用途86。正式开发数据库和生产数据库均未修改。

- `integrity_check=ok`；
- `foreign_key_check` 无异常；
- `npm run check` 通过；
- `git diff --check` 通过。

## 8. 业务限制

系统只展示异常事实和阈值结果，不推断原因、不自动生成任务、不修改销售事实、关系或ERP用途。
