# V2-DATA-020 Resolver 有限范围读取切换验收报告

## 1. Feature Flag 实现

新增统一读取门面 `ResolveLinkSkuRelationRead`，由 `salesObjectResolverEnabled` 控制。服务端环境变量为：

- `SALES_OBJECT_RESOLVER_ENABLED`：总开关，未设置时为 `false`；
- `SALES_OBJECT_RESOLVER_SCOPES`：允许切换的场景，以逗号分隔；未设置时只允许 `comboSkuManagement`。

开关与场景必须同时满足才会使用 Sales Object Resolver。因此即使误开启总开关，链接经营分析和产品中心也不会自动切换。

## 2. 本阶段切换范围

第一阶段仅新增并接入组合 SKU 管理只读服务 `listSalesObjectComboSkus`：

1. 从 Sales Object 正式模型读取 bundle 对象；
2. 通过统一灰度门面解析 ERP 组件；
3. 同时执行旧、新 Resolver 比较；
4. 对减少或冲突自动回退旧 Resolver。

以下范围本阶段仍保持旧读取：

- 链接详情；
- 产品关联详情；
- LinkBusinessTable；
- LinkSalesRanking；
- LinkSalesDistribution；
- Product Workspace。

这满足“有限范围切换”，没有一次性替换经营读取。

## 3. 双读保护与差异日志

启用灰度的场景会同时运行两套 Resolver，并以 `ERP SKU + quantity` 集合比较。结构化日志事件为：

`sales_object_resolver_difference`

记录字段包括：场景、Link SKU、差异类型、旧新状态、旧新组件及时间。分类为 `added`、`reduced`、`conflict`；完全一致不写日志。

- `consistent`：使用新结果；
- `added`：使用新结果并记录差异；
- `reduced/conflict`：记录差异并自动回退旧结果；
- 新结果不完整或不可用：回退旧结果。

日志不修改数据，也不影响用户请求成功。

## 4. 隔离验证结果

| 场景 | 结果 |
|---|---|
| Flag 默认值 | 关闭 |
| Flag 关闭 | 旧 Resolver 正常；新 Resolver 查询数 0 |
| Flag 开启 + `comboSkuManagement` | Sales Object Resolver 生效 |
| Flag 开启 + `linkBusinessTable` | 不在允许范围，仍使用旧 Resolver |
| 组合 SKU 管理抽样 | 100 条 bundle，100 条可用，0 冲突 |
| 差异日志 | 已用 `HP0754-3` 验证 `added` 日志和新结果路径 |
| LinkBusinessTable | 开关前后结果完全一致 |
| Product Workspace | 开关前后结果完全一致 |

销售事实保持 11,548 条，销售额 1,327,063.9502，利润 624,038.6962。开关不参与金额聚合，bundle 组件不会继承销售额或利润。

## 5. 性能

500 个 Link SKU 批量验证：

| 模式 | 旧 Resolver SQL | 新 Resolver SQL | 说明 |
|---|---:|---:|---|
| Flag 关闭 | 7 | 0 | 无灰度额外开销 |
| Flag 开启 | 7 | 6 | 双读固定批量查询 |

新 Resolver 每批固定 6 次查询，没有逐 Link SKU 查询。双读阶段存在可控的固定额外开销；正式扩大范围前应继续监测真实接口 P95。

## 6. 数据保护

隔离验证前后以下资产计数完全一致：active mapping、Link Product Structure、daily facts、ERP SKU、Product、Product Mapping。

检查结果：`integrity_check=ok`，`foreign_key_check=0`。

## 7. 回滚方式

即时回滚只需将 `SALES_OBJECT_RESOLVER_ENABLED=0` 或移除目标 scope，无需数据库恢复。旧 Resolver、active mapping 和 Link Product Structure 均保留，读取门面会立即返回旧结果。

若移除新组合 SKU 管理功能，则删除其只读服务及灰度门面即可；销售事实和旧关系不受影响。

## 8. 下一步建议

当前仅具备第一阶段上线条件。建议顺序：

1. 先发布默认关闭版本；
2. 仅为内部组合 SKU 管理开启 `comboSkuManagement`；
3. 观察差异日志和接口 P95；
4. 再单独评审链接详情、产品关联详情；
5. 最后才评审经营分析四个高影响读取点。

在 `reduced/conflict=0`、金额与 Product 覆盖持续守恒、性能稳定之前，不扩大 scope，也不冻结旧关系。
