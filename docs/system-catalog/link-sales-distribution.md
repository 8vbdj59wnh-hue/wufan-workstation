# LinkSalesDistribution

## 定位

- Capability Key：`LinkSalesDistribution`
- Module Key：`link_sales_distribution`
- Domain：`business_links`
- Workspace：经营链接驾驶舱（第一模块）
- 作用：观察公司或个人负责链接的销售结构；不替代 `LinkSalesRanking`，也不表达爆款、热销或其他业务评级。

## 数据与口径

唯一销售来源为 `connection_sku_sales_facts`。服务端按 `salesLinkId` 聚合所选 7 日、30 日或自定义周期，再关联现有 `connection_profiles`，按销售额降序输出。没有销售事实的链接返回 `salesAmount=null`、`noData=true`，不会被展示为销售额 0。

输出字段：`linkId`、`linkName`、`mainImage`、`salesAmount`、`salesPercentage`、`rank`、`groupIndex`。每条链接保留一条输出；每 100 条使用一个 `groupIndex`，该分组仅用于视觉识别。

## 钻取

1. 驾驶舱：全部可见链接一链接一柱。
2. 点击 100 链接分组：显示该组内部最多 100 根柱。
3. 点击 10 链接区间：复用 `QueryLinkDataTable` 和 `link_data_table` 查看明细。

第三层只向 `QueryLinkDataTable` 传入已选中的精确 `connectionIds`；权限仍由 `mine/company` 服务端范围控制。

## 依赖关系

```text
connection_sku_sales_facts + connection_profiles
  -> LinkSalesDistribution
  -> link_sales_distribution
  -> 经营链接驾驶舱

link_sales_distribution
  -> QueryLinkDataTable
  -> link_data_table
```

`LinkSalesRanking` 继续负责头部链接排行；`LinkSalesDistribution` 只负责整体销售结构。
