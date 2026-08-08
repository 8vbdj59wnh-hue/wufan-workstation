# V2-LINK-005 经营链接中心 Workspace 全量升级验收报告

## 基线与范围

- 修改前 Git HEAD：`8fff3880315cf69f5bed226b50580d5df1686632`
- 基线：当前生产兼容版本。
- 范围：Workspace 组合、Module Registry 注册、前端样式与信息层级。
- 数据库迁移：无。
- 业务 API：无变化。

## 完成结果

1. 全部链接 Workspace：公司经营概览、LinkDataStatus、LinkSalesRanking(company)、LinkFilter、LinkList。
2. 链接医院 Workspace：阶段概览、问题链接、诊断入口、改善行动入口。
3. 数据更新 Workspace：运营摘要与既有导入入口；管理员保留技术详情入口。
4. 链接详情 Workspace：原 13 个 Tab 重组为经营概览、问题诊断、销售分析、商品库存、高级信息。
5. 按需加载：诊断历史/改善/动作、销售趋势、高级对标首次打开时加载，模块不重复请求同一页面数据。

## 新增标准模块

- `link_filter`
- `link_detail_header`
- `link_business_summary`
- `link_sales_analysis`
- `link_inventory_summary`
- `link_hospital_overview`

继续复用：`link_sales_ranking`、`link_data_status`、`link_list`。

## 隔离验证

- 隔离数据库：生产数据副本，仅用于本机验收。
- SQLite `integrity_check`：ok。
- SQLite `foreign_key_check`：无异常。
- LinkSalesRanking：mine/company 结果及销售事实口径通过既有验证脚本。
- LinkDataStatus：数据日期、状态、异常摘要通过既有验证脚本。
- 管理员：可见全部链接、公司排行、数据中心技术入口。
- 普通运营：无管理员数据中心和 company 排行范围；无负责链接时返回空范围，未扩大权限。
- 搜索/筛选：表单沿用原事件和服务端查询，隔离页面提交搜索后无错误。
- 详情入口：正常打开；5 个区域均可切换，标准模块正确挂载。
- 医院：3 个阶段与问题链接正常显示。
- 数据更新：状态摘要、既有导入页面和管理员技术入口正常。
- 浏览器控制台：无应用新增错误。

## 数据保护

未修改生产数据库。测试账号和登录时间只存在于一次性隔离副本。未改变销售事实、利润、健康、诊断、改善、链接身份、权限、提成或评级规则。
