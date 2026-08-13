# V2-RELEASE-003 Sales Object + 组合SKU完整发布整合检查

检查时间：2026-08-13（Asia/Shanghai）

## 1. 当前生产版本

- 生产部署目录：`/Users/meiyounaichatouyuna/Projects/goal-execution-system`
- 当前生产 commit：`f24816661b9ffdb5d393b453dd58669b30826e05`
- 当前开发 commit：`a840afc58b52f6bddccb1c7d87d50623826a6343`
- Git 关系：生产 commit 是当前开发 commit 的祖先，当前版本为生产版本的安全后继。
- 结论：不需要额外生产兼容整合，也不得强制覆盖生产历史。发布目标应为 `a840afc58b52f6bddccb1c7d87d50623826a6343`。

## 2. 整合功能清单

### 数据层

- 已包含 `sales_objects`。
- 已包含 `sales_link_sku_sales_object_relations`。
- 已包含 `sales_object_structures`。
- 已包含 `sales_object_structure_components`。
- 已包含平台货品表与组合装明细驱动的历史数据初始化能力。
- 初始化支持 single、bundle、Link SKU关联和结构组件生成，并可重复幂等执行。

### Resolver层

- 已包含 `ResolveLinkSkuSalesObject`。
- 已包含统一读取门面 `ResolveLinkSkuRelationRead`。
- Legacy active mapping 与 Link Product Structure 保留，不删除、不修改。
- 影子比较结果无减少、无冲突；Sales Object额外解释4个旧Resolver缺失关系。

### 产品中心

- SKU管理与Product Workspace入口保留。
- 已包含组合SKU管理列表、详情、组件、关联链接和对象级销售表现。
- 已包含组合SKU列表视图与卡片视图。
- 卡片图片严格来自Sales Object组件关联Product主图。
- 卡片支持单图、4宫格、9宫格，超过9个组件仅显示前9个。
- 组合销售额按Sales Object源销售行计一次，不累加组件销售额。

## 3. 发布依赖与迁移清单

### 代码依赖

- Schema创建逻辑：存在。
- Sales Object历史生成服务：存在。
- Resolver与统一读取门面：存在。
- 组合SKU API：`/api/product-center-v2/combo-skus`及详情接口存在。
- 产品中心组合SKU页面、列表与卡片视图：存在。

### 数据依赖

- 生产当前已经完成Sales Object历史初始化，不是空表状态。
- 发布仍应执行数据库备份并运行幂等初始化核验；若目标环境为空，必须先完成历史初始化再开放组合SKU页面。
- 权威输入为平台货品表和组合装明细；不得用Legacy结构或销售明细反推组件。

## 4. 隔离发布预演

生产数据库已只读复制到本地隔离环境，源文件SHA-256：

`96048074be54e771224480c458162bb12cbc83c7baba229895840dc8d2139602`

在副本上执行完整Schema初始化和历史数据生成，结果如下：

| 项目 | 结果 |
|---|---:|
| Sales Object | 6,365 |
| single | 2,722 |
| bundle | 3,643 |
| active Link SKU关联 | 31,769 |
| Sales Object Structure | 6,365 |
| 结构组件 | 10,425 |
| 终端ERP SKU | 2,842 |
| 已关联Product | 2,842（100%） |

生产副本已有完整初始化数据，因此生成器执行结果为：对象新增0、结构新增0、组件新增0、关系新增0；31,769条关系均作为已存在关系识别，幂等通过。

## 5. 页面与卡片验证

- 产品中心SKU管理数据依赖正常。
- Product Workspace数据依赖正常。
- 组合SKU API、列表、详情、关联链接及Product组件链路存在。
- 单组件真实样本 `FZH0188-9`：显示1张图。
- 4组件真实样本 `FZH0144-52`：显示4宫格。
- 15组件真实样本 `HP0169-43`：仅显示前9张图。
- Product主图来源逐项核对一致。
- Sales Object销售额样本按源销售行去重一致。
- 服务未读取Legacy Product Structure。

## 6. 经营指标与数据保护

| 指标 | 预演前后结果 |
|---|---:|
| 日报事实数量 | 11,548（不变） |
| 销售额 | 1,327,063.9502（不变） |
| 利润 | 624,038.6962（不变） |
| active mapping | 43,316（不变） |
| Legacy Product Structure | 10,949（不变） |
| ERP SKU | 6,902（不变） |
| Product | 2,958（不变） |
| Product Mapping | 2,956（不变） |

- `integrity_check`：`ok`。
- `foreign_key_check`：0项错误。
- 源生产数据库未修改。

## 7. 发布建议

检查结论：**具备发布条件，但本任务未执行发布。**

建议发布顺序：

1. 备份生产数据库并记录SHA-256。
2. 确认生产HEAD仍为`f24816661b9ffdb5d393b453dd58669b30826e05`且工作区无额外修改。
3. 以其后继版本`a840afc58b52f6bddccb1c7d87d50623826a6343`发布，禁止reset或强制覆盖。
4. 启动后执行Schema初始化与Sales Object历史生成幂等检查。
5. 先核对四张Sales Object表数量，再开放产品中心组合SKU管理。
6. 验证列表、卡片、详情、单图/4宫格/9宫格及销售额口径。
7. 复核销售额、利润、daily facts与Legacy资产不变。

已知非阻断差异：31,769个Sales Object关系中，31,765个与旧Resolver完全一致；4个为Sales Object新增解释，减少0、冲突0。该差异已在既有影子验证中确认，不构成本次发布阻断。
