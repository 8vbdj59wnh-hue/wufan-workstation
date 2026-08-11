# 《Business-001发布阻断修复Phase8-9验收报告》

## 一、验收结论

Phase 8-8 发现的三个发布阻断已处理：生产状态验证不再依赖历史数量，链接中心、产品中心和销售驾驶舱的销售经营查询已统一使用 `connection_sku_sales_daily_facts`，Business-001 修改已整理为独立 release commit。

结论：可以重新进入发布前最终检查，本阶段未发布、未修改业务数据。

## 二、测试基线修复

- `verify-sales-daily-data-quality.js` 改为从当前隔离库读取事实数量和金额，验证 ready 不少于已写事实、商品源金额守恒、异常数等于真实异常分类之和。
- `verify-sales-data-quality-anomaly-governance.js` 不再固定断言 179/117，改为与当前销售日报质量分类逐类对账。
- `verify-sales-daily-production-phase710b.js` 不再固定断言 11548，改为验证日报事实非空、日期范围合法、页面查询来源为 `daily_fact_v1`、周期金额与事实守恒。
- 历史阶段的 Excel 固定样本脚本仍保留样本期望值；这些是不变的测试夹具，不是生产状态基线。

## 三、经营查询来源统一

已迁移的运行时查询包括：

- 链接销售排行、销售分布、经营表格、链接核心页、链接驾驶舱、链接 V3 指标。
- 产品中心 SKU 列表、产品详情销售趋势和链接贡献。
- ERP SKU 用途候选的销售影响证据。

统一规则：

- 销售额、利润、成本、ERP SKU 销量均来自 `connection_sku_sales_daily_facts`。
- 日期条件使用 `saleDate`，销量使用 `quantity`。
- 页面服务不再读取 `connection_sku_sales_facts`。
- `connection_sku_sales_facts` 仅剩历史导入/兼容治理路径和 Schema 迁移引用，不参与经营页面统计。

## 四、隔离数据库核对

| 检查项 | 结果 |
|---|---:|
| 日报事实 | 11,548 |
| active mappings | 43,316 |
| active Product Structure | 10,946 |
| Product Structure 总数 | 10,949 |
| 销售额 | 1,327,063.9502 |
| 利润 | 624,038.6962 |
| integrity_check | ok |
| foreign_key_check | 0 |

数据质量动态核对结果：ready 11,596 行，missing_relation 69 行，relation_conflict 6 行，identity_error 56 行，真实异常合计 131 行；商品销售额覆盖率 99.1731%，金额守恒。

## 五、代码质量

- `npm run check`：通过。
- `git diff --check`：通过。
- 链接、产品、驾驶舱查询冒烟验证：通过，无 SQL 字段错误。
- 质量查询及异常治理的受保护表摘要前后一致。

## 六、发布提交

Business-001 发布修改已单独整理。提交不包含 `link-center-exception-*` 报告、链接异常收敛脚本及其独立服务。

Commit hash：提交后回填。
