# Business-001 链接经营中心销售日报接入 Phase 5-2 验收报告

## 1. 页面接入

链接详情 Workspace 的“销售分析”区域新增标准模块 `link_daily_sales`，按需加载，不影响链接列表首屏。

模块展示：

- 销售概览：周期、销售额、利润、销量、利润率；
- 每日趋势：日期、销售额、利润；
- SKU贡献：链接SKU、ERP SKU组成、销售额、利润、销量；
- 近7日、近30日周期切换。

无事实时统一显示“暂无数据”。存在事实且指标真实为0时显示0。趋势中的缺失日期保留 `noData`，不补0。

## 2. 查询调用

新增只读展示编排服务 `getConnectionDailySalesPerformance`。该服务只调用：

- `QueryDailySalesSummary`
- `QueryDailySalesTrend`
- `QueryDailySalesBySku`

页面和展示编排服务均不直接查询 `connection_sku_sales_daily_facts`，也不读取旧 `connection_sku_sales_facts`。

SKU贡献中的ERP SKU组成统一通过一次 `ResolveLinkSkuErpRelations` 批量解析。页面不读取旧关系字段、不按编码匹配，也不自行解释single/combo。

## 3. 展示结果验证

使用Phase 4隔离数据库副本验证，日期范围为2026-07-09至2026-08-09，共171条日报事实。

真实有数据链接验证结果：

- 日报事实3条；
- 销量3；
- 销售额116.70；
- 成本74.2877；
- 利润42.4123；
- 利润率36.343%；
- SKU贡献2组；
- SKU销售额、利润合计与链接汇总完全一致；
- 趋势返回完整32日，其中缺失日期指标为`null`而不是0；
- 重复刷新返回结构和数据完全一致。

真实无数据链接验证结果：

- `hasData=false`；
- 销售额、利润率为`null`；
- SKU贡献为空；
- 全部趋势日期保持`noData`。

## 4. 性能

- 日报模块仅在进入“销售分析”Tab时按需加载。
- 单链接详情允许单链接查询。
- SKU组成使用批量Resolver，没有逐SKU调用。
- 隔离验证中完整详情编排共执行12条SQL；SKU数量增加不会产生逐SKU关系解析请求。
- 日报汇总、趋势、SKU贡献继续由Phase 5-1 Capability在数据库端完成过滤和聚合。

## 5. 数据保护

隔离验证前后SHA-256摘要一致：

- 日报事实：171条，不变；
- V2 mappings：不变；
- ERP SKU：不变；
- ERP SKU用途：不变。

数据库检查：

- `integrity_check`: `ok`
- `foreign_key_check`: 0项异常

本阶段未修改销售事实、关系解析规则、Mapping、ERP SKU、用途或Combo。

## 6. 结论

链接经营中心已经可以展示日报事实口径的销售表现，并严格保持日报事实、ERP组成关系和无数据语义边界。当前实现具备进入产品中心日报接入的条件。
