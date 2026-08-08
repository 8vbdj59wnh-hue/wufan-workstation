# LinkSalesRanking

- Capability Key：`LinkSalesRanking`
- Module Key：`link_sales_ranking`
- Domain：`business_links`
- Data：`BusinessLink`、`ConnectionProfile`、`ConnectionSkuSalesFact`
- Scope：`mine`（负责人范围）、`company`（管理员）
- Range：7 日、30 日、自定义日期
- Workspace：我的链接、链接资产
- Permission：复用 `links.view`；公司范围额外要求管理员身份
- Business rule：销售额直接汇总既有销售事实，不产生新口径

依赖：

`connection_sku_sales_facts -> LinkSalesRanking -> link_sales_ranking -> 我的链接 / 链接资产`
