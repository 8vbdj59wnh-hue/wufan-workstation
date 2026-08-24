# 客户中心与供应链中心彻底退役验收报告

日期：2026-08-24

范围：客户中心、供应链中心及其专属依赖

发布状态：未发布

## 1. 退役结论

客户中心和供应链中心已从正式业务架构中退出，不再保留菜单、路由、页面、Module注册、业务API、Service、Capability入口、权限组或启动加载函数。AI经营助手不再生成客户或供应链分析；历史AI分析记录仍可只读展示，并明确标记为历史类型。

## 2. 删除内容

- 删除客户中心与供应链中心页面、兼容包装页面和专属样式。
- 删除客户、供应商、采购、供应商质量与评价Service，以及全部对应API。
- 删除 `customers`、`supplyChain` 权限组、模块权限和旧产品权限回退。
- 删除前端全局状态中的客户/供应链API函数与主入口的静态导入。
- 删除供应链专属验证脚本、测试和包脚本。
- 正式Schema退出客户5表、供应链6表及其31个索引；升级迁移按子表到主表顺序删除，并清理历史权限JSON中的模块授权。

退役表：

- 客户：`customers`、`customer_consumptions`、`customer_tags`、`customer_tag_relations`、`customer_followups`
- 供应链：`suppliers`、`supplier_products`、`purchase_orders`、`purchase_order_items`、`supplier_quality_issues`、`supplier_evaluations`

生产数据副本中上述11表均为0行；代码反向扫描无正式读、写、API或Capability依赖，外键仅存在于退役集合内部或由退役表指向共享表，没有共享正式表反向引用退役表。

## 3. 保留的共享数据资产

以下能力虽然曾被供应链中心读取，但属于其他正式领域，不随模块退役：

- 产品：`products`、产品档案及产品关系
- ERP：`erp_goods`、`erp_skus`、`product_erp_mappings`
- 库存：`erp_sku_warehouse_inventory_facts`、`erp_sku_inventory_daily_summaries`
- 销售利润：`connection_sku_sales_daily_facts`、Sales Object与Structure关系
- 财务：`finance_entries`、财务规则与利润查询
- 执行体系：目标、关键行动、任务中的“供应链管理”“客户维护”价值链分类
- 历史AI分析：共享 `ai_analysis_records` 中既有记录只读保留

隔离迁移前后，上述7类核心共享表的整体导出SHA-256均为 `6ce8b4a051565e8b2bd6667f826b3589383db0841226bb0eaa60f3870a4aeb00`。

## 4. Schema与数据安全

| 指标 | 旧代码初始化后的副本 | 退役后的副本 | 变化 |
|---|---:|---:|---:|
| 表 | 129 | 118 | -11 |
| 索引（含SQLite自动索引） | 351 | 320 | -31 |
| 退役目标表 | 11 | 0 | -11 |
| `foreign_key_check` | 0 | 0 | 无异常 |
| `integrity_check` | ok | ok | 通过 |

原始数据库全程未用于迁移，前后SHA-256均为 `9009fe4d56ef3dee8b5534e6e3d59759259ff05799fff7a5020ca78e5edd59e6`。

## 5. 性能对比

| 指标 | 退役前 | 退役后 | 变化 |
|---|---:|---:|---:|
| 浏览器首屏脚本请求 | 51 | 47 | -4（-7.84%） |
| 浏览器首屏静态资源 | 54 | 50 | -4（-7.41%） |
| 首屏加载脚本源文件体积 | 1,356,224 B | 1,320,310 B | -35,914 B（-2.65%） |
| `src/**/*.js` 总体积 | 2,275,078 B | 2,240,426 B | -34,652 B（-1.52%） |
| `/api/data` | 112,950 B | 111,653 B | -1,297 B（-1.15%） |
| dashboard/products/finance bootstrap | 83,605 B | 82,308 B | -1,297 B（-1.55%） |
| 同条件隔离Node RSS | 86,448 KB | 76,720 KB | -9,728 KB（-11.25%） |

客户与供应链表原本不在 `/api/data` 的资源清单内，因此响应下降主要来自历史权限负载被清理；主要前端收益来自取消4个静态导入脚本及相关启动代码。

## 6. 回归与验证

- `npm run check`：通过。
- `git diff --check`：通过。
- 退役与权限自动化测试：17项通过。
- 产品中心正式读取回归：8项通过。
- 链接评级、历史改善记录兼容回归：通过。
- 生产数据副本：`integrity_check=ok`，`foreign_key_check=0`。
- 已认证隔离API：产品接口200；客户中心和供应链中心旧端点均404。
- 真实浏览器：驾驶舱、目标、关键行动、任务、链接、产品、财务、模板、行动标准、设置、管理员数据中心均正常渲染，无退役模块入口或加载错误。

本提交未发布。
