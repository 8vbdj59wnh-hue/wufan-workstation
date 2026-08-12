# V2-DATA-010 销售终端 ERP SKU 批量建立产品档案结果

执行日期：2026-08-12

执行范围：生产数据库最新副本，仅在隔离数据库写入验证；生产数据库未修改。

源码基线：`c39d95cf32b6ca5e31290056320b9ae3698d6380`

生产副本 SHA-256：`2af89e74e7fec7cf959c6f6414e6ac92959e48df48c7ca380d0aa47582baf581`

## 1. 执行结论

隔离数据库成功为 **1,295** 个销售终端 ERP SKU 建立 Product 产品档案及 active `product_erp_mappings`。

- 首次执行：新增1,295，跳过0；
- 重复执行：新增0，跳过1,295，`idempotent=true`；
- 一 ERP SKU 对应一个 Product：1,295/1,295；
- 原有产品和产品映射哈希不变；
- 销售终端 ERP SKU 产品档案覆盖率：54.43% → 100%；
- 生产数据库未执行写入，暂未发布。

## 2. 建档范围与执行前保护

候选口径：

```text
active sales_link_sku_erp_mappings
→ active erp_skus
→ 不存在 active product_erp_mappings
```

执行前统计：

| 指标 | 数量 |
|---|---:|
| 产品总数 | 1,663 |
| 产品 ERP 映射 | 1,661 |
| 销售终端 ERP SKU（去重） | 2,842 |
| 已建立产品映射的销售 ERP SKU | 1,547 |
| 待建档销售 ERP SKU | 1,295 |
| SKU编码重复风险 | 0 |
| 已有产品同码风险 | 0 |
| 已有mapping编码占用风险 | 0 |

隔离源库保留不变，执行时再次校验 ERP SKU 存在、active、编码非空及唯一约束。

## 3. 建档规则和字段来源

复用现有 `createProductsFromErpSkus` 事务能力，未建立第二套产品写入口。

| 产品字段 | 来源/规则 |
|---|---|
| Product身份 | ERP SKU；稳定ID由规范化ERP SKU编码生成 |
| `skuCode` | `erp_skus.merchantSkuCode` |
| `name` | `erp_goods.goodsName`；为空才回退SKU编码 |
| ERP关联 | `product_erp_mappings.erpSkuId` |
| `brand` | `erp_goods.brand` |
| `category` | `erp_goods.category` |
| `specification` | `erp_skus.specificationName` |
| `mainImage` | ERP SKU主图；为空时取ERP SKU图库第一张 |
| `galleryImages` | ERP SKU图库 |
| `status` | 统一“开发中” |
| `sourceSystem` | `ERP待建立SKU` |

没有自动生成材质、营销信息、故事、关键词、策略或占位图片。

字段结果：

| 字段 | 完整 | 缺失 |
|---|---:|---:|
| 名称 | 1,295 | 0 |
| SKU编码 | 1,295 | 0 |
| 品牌 | 1,295 | 0 |
| 类目 | 1,295 | 0 |
| 规格 | 1,295 | 0 |
| 图片 | 1,276 | 19 |
| 材质 | 0 | 1,295（按要求不自动填充） |

## 4. 隔离执行结果

| 指标 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| Products | 1,663 | 2,958 | +1,295 |
| Product ERP mappings | 1,661 | 2,956 | +1,295 |
| 未建档销售 ERP SKU | 1,295 | 0 | -1,295 |
| 已建档销售 ERP SKU | 1,547 | 2,842 | +1,295 |
| 销售终端 ERP SKU总数 | 2,842 | 2,842 | 0 |

所有1,295个新产品状态均为“开发中”。没有修改销售事实、链接关系、Product Structure、ERP SKU或ERP Goods。

## 5. 幂等验证

首次执行：

```json
{
  "insertedCount": 1295,
  "skippedCount": 0
}
```

重复执行同一候选范围：

```json
{
  "insertedCount": 0,
  "skippedCount": 1295,
  "idempotent": true
}
```

第二次执行重新查询候选，不再把已有 active mapping 的 ERP SKU交给创建事务，因此不会触发重复产品或重复mapping。

## 6. 一一对应与原数据保护

- 1,295个候选均恰好存在一个 active `product_erp_mappings`；
- mapping的 `erpSkuId` 与来源ERP SKU完全一致；
- Product与mapping在同一事务中创建；
- 执行前已有1,663个Product逐行哈希不变；
- 执行前已有1,661条产品映射逐行哈希不变；
- active销售关系涉及的ERP SKU总数保持2,842，不因建档改变关系。

## 7. 覆盖率变化

| 口径 | 执行前 | 执行后 |
|---|---:|---:|
| 销售终端ERP SKU产品档案覆盖 | 1,547 / 2,842 | 2,842 / 2,842 |
| 覆盖率 | 54.43% | 100.00% |
| 产品中心默认已建档视图新增 | — | 1,295 |

本次只建立产品档案，不重新解释ERP SKU类型，也不修改组合销售结构。

## 8. 随机/稳定排序样本

| ERP SKU | ERP Goods名称 | 规格 | 新Product | 状态 | 图片 |
|---|---|---|---|---|---|
| `FZH0016-03` | 清新小芙兰7色仿真花… | 小芙兰 橘色 | `product-306d15990dc719c408e5488d` | 开发中 | 有 |
| `FZH0018-01` | 橄榄枝仿真花橄榄果植物… | 橄榄枝 | `product-1ec2240c53468a46be1c5f1e` | 开发中 | 有 |
| `FZH0062-2` | 北欧ins金钱叶网纹叶子… | 绿色网纹叶 | `product-581e88456ad9ba9f5320ddb6` | 开发中 | 有 |
| `FZH0082-1` | 尤加利叶 | 长叶尤加利 | `product-2261e8d1e20e46b7eae4d8c0` | 开发中 | 有 |
| `FZH0082-2` | 尤加利叶 | 圆叶尤加利 | `product-b9a8d17813eb99db80731804` | 开发中 | 有 |
| `FZH0096-3` | 花瓶摆件客厅插花玻璃透明… | 轮风菊 白色 | `product-ec3b16abcd07eabbc68a1b83` | 开发中 | 有 |
| `FZH0096-4` | 花瓶摆件客厅插花玻璃透明… | 轮风菊 橘色 | `product-b3deac845153e70fb382c0ed` | 开发中 | 有 |
| `FZH0099-1` | 丁香豆 | 丁香豆 绿色 | `product-d82f273e363de513e9cf3b3e` | 开发中 | 无 |
| `FZH0103-20` | chic fun轻奢花瓶摆件… | 保湿感郁金香-奶白色 | `product-ec94b7ef70b63ad87192299e` | 开发中 | 有 |
| `FZH0103-5` | chic fun轻奢花瓶摆件… | 郁金香-桃红 | `product-86220c277549551f2648aa71` | 开发中 | 有 |

## 9. 风险说明

1. 当前系统仍没有 ERP SKU 单品/组合类型和 ERP BOM。本次按用户确认的“ERP终端组件均正常建Product”规则执行，不建立组合ERP模型。
2. 19个产品没有ERP图片，保持空值，未生成占位图。
3. 1,295个产品没有正式材质来源，保持空值。
4. ERP Goods名称可能偏长或偏供应链描述，后续可人工维护营销名称，但不得改变SKU身份。
5. 本次只完成隔离验收；生产库产品总数仍未发生变化。

## 10. 验证结果

- 隔离数据库首次建档：通过；
- 重复执行幂等：通过；
- ERP SKU与Product一一对应：通过；
- 原产品数据不变化：通过；
- 原产品映射不变化：通过；
- `integrity_check=ok`；
- `foreign_key_check`无返回项；
- `npm run check`：通过；
- `git diff --check`：通过。

## 11. 发布状态

本任务只提交验证脚本和报告，**暂不发布生产**。生产应用前应重新生成最新候选快照、备份数据库，并再次执行冲突和幂等预检。
