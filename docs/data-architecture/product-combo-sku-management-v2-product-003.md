# V2-PRODUCT-003 组合SKU管理验收报告

## 1. 实现结论

产品中心已新增只读“组合SKU管理”，数据源严格限定为正式 `Sales Object(bundle)`：

- 列表按Sales Object去重分页，不按Link SKU重复展示；
- 详情组件读取`Sales Object Structure Components`；
- 关联链接由`ResolveLinkSkuSalesObject(s)`解析；
- Product通过组件ERP SKU的有效`product_erp_mappings`关联；
- 销售表现读取`connection_sku_sales_daily_facts`，按原始销售来源行只计一次，不把销售额或利润复制到组件；
- 服务未读取Legacy Link Product Structure。

模块不提供新增、编辑、删除、结构调整或产品建档操作。

## 2. 页面能力

产品中心子模块增加“组合SKU管理”。

列表字段：Sales Object编码、名称、bundle类型、组成数量、关联链接数量、关联产品数量、状态、更新时间；支持编码/名称搜索和后端分页。

详情展示：Sales Object基础信息、结构版本、ERP SKU组件与quantity、组件Product、经Sales Object Resolver反查的Link SKU/Link、Sales Object自身销售汇总。

## 3. 接口与读取边界

- `GET /api/product-center-v2/combo-skus`
- `GET /api/product-center-v2/combo-skus/:id`
- 权限沿用`products.view`。

列表与详情均标记`source=sales_object_v1`。销售表现标记`source=daily_fact_v1_sales_object`及`allocation=source_sales_line_once`，明确金额归属层级。

## 4. 隔离验证

使用生产只读副本、平台货品表和组合装明细，在临时数据库生成Sales Object后验证：

| 项目 | 结果 |
|---|---:|
| bundle列表数量 | 3,643 |
| 分页 | 20/页设计；10条验证页返回10个唯一Sales Object |
| 样本Sales Object | `BZ00003-4` |
| 样本组件 | 3 |
| 样本关联Link SKU | 8 |
| 样本关联Product | 3 |
| 详情组件与结构表 | 完全一致 |
| Link反查Resolver | 全部返回同一Sales Object |
| Legacy Product Structure读取 | 0 |
| 金额组件复制 | 0；按源销售行计一次 |
| integrity_check | ok |
| foreign_key_check | 0错误 |
| 源数据库SHA前后 | 不变 |

## 5. 修改范围

- 后端：扩展组合Sales Object只读列表/详情服务，增加两个只读API；
- 前端：产品中心增加组合SKU列表、详情、搜索、分页及只读展示；
- 验证：新增隔离验证脚本；
- 未修改Schema、Sales Object结构、ERP SKU、Product、mapping、销售事实或Legacy关系。

## 6. 结论

V2-PRODUCT-003达到只读管理要求：bundle数量正确，组件、Link、Product关系可追溯，销售金额不重复，并且不依赖Legacy Link Product Structure。可以进入独立提交，暂不发布。
