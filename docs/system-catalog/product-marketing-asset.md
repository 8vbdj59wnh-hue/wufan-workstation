# ProductMarketingAsset System Catalog

## Data Asset

| Key | 中文名称 | 表 | 身份 | 关系 |
| --- | --- | --- | --- | --- |
| `ProductMarketingAsset` | 产品营销资产 | `product_marketing_assets` | `id` | 通过唯一 `productId` 关联 `Product`，不与 ERP SKU 合并 |

结构化字段：

- `sellingPointsJson`：`[{ id, text, sortOrder }]`，保留多条卖点和顺序。
- `usageScenariosJson`：字符串集合。
- `keywordsJson`：字符串集合。
- 空数据保持为空值/空集合，UI 统一显示“未维护”。

## Capability

| Capability Key | 名称 | 输入 | 输出 | 权限 |
| --- | --- | --- | --- | --- |
| `ProductMarketingManage` | 产品营销资产管理 | `productId` + 结构化营销内容 | 营销资产 | 查看 `products.view`，保存 `products.edit` |
| `ProductAIExport` | 产品 AI 资料导出 | `productId` | `product-ai-export-v1` 固定文本 + 图片清单 | `products.view` |

## Module

| Module Key | 名称 | 状态 | 模式 | 依赖 |
| --- | --- | --- | --- | --- |
| `product_marketing_asset` | ProductMarketingAsset | 已注册 | 阅读态、编辑态 | Product, ProductMarketingAsset, ProductMarketingManage |

## Workspace

`Product Workspace (#products/sku/:erpSkuId)` 增加“营销资产” Tab：

- 已建档 SKU：按需读取 `productId` 对应的营销资产。
- 未建档 SKU：显示“需先建立产品档案”，不产生孤立营销数据。

## Dependency Map

```text
Product + ProductMarketingAsset
  ↓
ProductMarketingManage / ProductAIExport
  ↓
product_marketing_asset
  ↓
Product Workspace
```

`ProductAIExport` 只读取产品基础信息和营销资产；不读取成本、ERP 原始 JSON、库存、利润或其他权限外数据。
