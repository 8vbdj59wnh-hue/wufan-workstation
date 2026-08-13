# V2-PRODUCT-004 组合SKU卡片视图优化验收报告

## 实现结果

- 组合SKU管理默认使用卡片视图，并保留列表视图切换。
- 卡片延续产品中心现有产品卡片样式，展示名称、组合编码、组成商品数量、关联链接数量、组合销售额和更新时间。
- 列表接口在同一分页请求内批量返回卡片数据，不产生逐卡请求。

## 图片规则

- 图片链路固定为 `Sales Object(bundle) → sales_object_structure_components → ERP SKU → Product.mainImage`。
- 1个组件显示单图；2–4个组件使用4宫格；5个及以上使用9宫格；超过9个只取结构排序前9个。
- Product没有主图时使用现有空图状态，不读取ERP图片，也不读取Legacy Product Structure。

## 销售额规则

- 组合销售额来自 `connection_sku_sales_daily_facts` 中与Sales Object关联链接SKU对应的原始销售行。
- 按来源批次、来源行、销售日期和链接SKU去重，同一销售行只计一次。
- 组件只用于结构展示，组件销售额不会汇总到组合卡片。

## 验证

- 隔离数据库覆盖单组件、2–4组件、超过9组件三类真实组合对象。
- 验证组件图片字段与Product主图逐项一致。
- 验证组合销售额与源销售行去重聚合一致。
- 验证服务不读取Legacy Product Structure。
- `integrity_check` 与 `foreign_key_check` 均通过，源数据库副本未变化。
- `npm run check` 与 `git diff --check` 通过。

## 数据保护

本次仅修改组合SKU只读查询与前端展示，不修改Sales Object、组件结构、Product、销售事实或Legacy关系数据。
