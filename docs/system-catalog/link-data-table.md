# LinkDataTable 基础能力

## Capability

- **QueryLinkDataTable**：以现有链接身份、负责人权限、销售事实和经营状态能力为唯一数据来源，提供 `mine` / `company` 范围、服务端分页、搜索、筛选、排序及 7 日、30 日、自定义日期查询。
- 销售字段保留 `hasData` / `noData` 语义；无销售事实时不返回金额 `0`。
- 增长、健康、医院和档案状态分别返回，不合并业务语义。

## Standard Modules

| Module Key | 职责 | 依赖 |
| --- | --- | --- |
| `link_image` | 链接主图、占位和加载失败状态 | BusinessLink |
| `link_data_table` | 当前页高密度经营数据表、服务端排序及行操作 | QueryLinkDataTable, link_image |
| `link_column_setting` | 本机字段显示与顺序配置 | localStorage |
| `link_data_toolbar` | 搜索、筛选、时间范围和字段设置入口 | QueryLinkDataTable |

## Workspace 接入

第一阶段仅替换“我的链接”工作台中的旧列表区域。经营摘要、销售排行、医院待办及链接详情能力继续复用原有实现；“全部链接”和“链接资产”不变。

## 边界

- 不新增销售、利润、健康、诊断、改善、提成或评级规则。
- 不新增用户视图数据表，不改变数据库结构。
- 不加入点击、提成、自定义公式、共享视图或低代码能力。
