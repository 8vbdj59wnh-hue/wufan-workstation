# Link Workspace V2

## Workspace

经营链接中心继续使用现有 BusinessLink、销售事实、健康、诊断、改善和权限能力，仅重新组合 UI：

- `my-links`：数据状态、个人经营摘要、销售排行、待处理问题、我的链接。
- `connections`：公司经营概览、销售排行、数据状态、筛选、全部链接。
- `hospital`：医院阶段概览、问题链接、诊断与改善入口。
- `data-import`：运营数据状态与既有导入能力；管理员可进入技术后台。
- `connectionCenter/:id`：经营概览、问题诊断、销售分析、商品库存、高级信息。

## Standard modules

| Module Key | 依赖 | 用途 |
| --- | --- | --- |
| `link_data_status` | LinkDataStatus | 数据日期、更新时间、状态与异常摘要 |
| `link_sales_ranking` | LinkSalesRanking | mine/company 范围销售额排行 |
| `link_filter` | QueryBusinessLinks | 复用既有搜索、筛选与排序 |
| `link_list` | QueryBusinessLinks | 权限范围内的链接列表 |
| `link_detail_header` | BusinessLink, ProductRelation | 链接详情统一头部 |
| `link_business_summary` | PeriodSnapshot, HealthRecord | 经营概览组合 |
| `link_sales_analysis` | SalesFact, PeriodSnapshot | 平台、ERP、SKU与趋势组合 |
| `link_inventory_summary` | Product, ErpSku, Inventory | 产品、SKU与库存组合 |
| `link_hospital_overview` | HealthRecord, Improvement, Action | 医院、诊断、改善与动作组合 |

所有模块共享页面已经加载的 Workspace 数据；趋势、诊断历史、改善、动作和高级对标在首次进入对应区域时加载。

## Business invariants

本次未新增业务 API、数据库表或计算规则。链接身份、负责人范围、销售/利润口径、健康/诊断/改善规则、提成和评级规则保持不变。
