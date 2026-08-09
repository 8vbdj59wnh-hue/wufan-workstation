# V2-LINK-013 LinkBusinessTable P0

## 定位

`LinkBusinessTable` 是“经营链接中心 → 全部链接”的经营分析数据表。它与面向日常管理的 `LinkDataTable` 并存，不改变链接身份、销售事实、利润、健康、医院或档案状态规则。

## Data → Capability → Module → Workspace

| 层级 | 资产 |
| --- | --- |
| Data | `sales_links`、`sales_shops`、`connection_profiles`、`connection_sku_sales_facts`、`connection_period_snapshots`、现有增长分析与医院阶段数据 |
| Capability | `QueryLinkBusinessTable` |
| Module | `link_business_toolbar`、`link_indicator_setting`、`link_business_table`；图片继续复用 `link_image` |
| Workspace | `business_links / company_links`（全部链接） |

## 查询边界

- 范围：`company`、`mine`；普通用户继续受现有负责人权限约束。
- 时间：昨日、近 7 日、近 30 日、自定义日期。
- 服务端能力：聚合、筛选、排序、分页。
- ERP 销售与平台支付分别返回，禁止合并口径。
- 无数据使用 `null + noData`，不伪装为 0。

## 指标

### 链接信息

主图、链接名称、平台、店铺、商品 ID、负责人。

### ERP 销售与利润

销售额、销量、成本、利润、利润率。

### 平台经营

支付件数、支付买家数、浏览量、访客数、收藏、加购、转化率。

### 经营状态

增长状态、健康状态、医院状态、档案状态分别呈现，不合并语义。

## 配置与性能

指标显隐继续使用浏览器本地配置，不新增业务表。查询只返回当前页，前端不对当前页做伪排序。4345 级链接规模由服务端一次聚合后分页返回，不读取历史销售明细到浏览器。

## 明确不包含

提成、点击、自定义公式、低代码报表、自动评级及任何业务规则变更。
