# LinkDataStatus

- Capability Key：`LinkDataStatus`
- Domain：`business_links`
- Data：`connection_import_batches`、`connection_import_rows`、`data_sync_batches`、`data_sync_exceptions`、`connection_sku_sales_facts`、`connection_period_snapshots`
- API：`GET /api/link-data-status`
- Permission：复用 `links.view` / `products.view`
- 普通运营输出：最新数据日期、最近更新时间、更新状态、异常标记与异常数
- 管理员附加输出：最新批次、最近成功批次、活动批次、分来源数据日期、异常来源、最近十个批次
- 写入：无

依赖：

`既有导入/同步批次与业务事实 -> LinkDataStatus -> 经营链接中心数据更新摘要`
