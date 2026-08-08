# My Link Workspace

## 工作台

- Workspace Key：`my_links`
- 中文名称：我的链接运营工作台
- 入口：经营链接中心 → 我的链接
- 用户：运营、管理员
- 权限边界：继续由现有 `links.view` / `products.view` 及负责人范围控制

## 标准模块

| Module Key | 名称 | 复用的数据 / Capability | 说明 |
| --- | --- | --- | --- |
| `link_data_status` | LinkDataStatus | `LinkDataStatus` | 最新数据日期、更新时间、更新状态及异常摘要 |
| `my_link_summary` | MyLinkSummary | `getMyConnectionWorkbench`、链接医院摘要 | 我的链接、昨日销售、上涨、风险和待处理数量；提成无唯一规则时固定显示“待配置” |
| `link_sales_ranking` | LinkSalesRanking | `LinkSalesRanking` | 复用既有 `mine` 范围与 7 日 / 30 日 / 自定义日期排行 |
| `link_hospital_todo` | MyLinkHospitalTodo | `getConnectionHospital` | 复用既有诊断、治疗、观察阶段，不改变诊断流程 |
| `link_list` | LinkList | `getMyConnectionWorkbench` | 当前负责人范围内的搜索、筛选、分页和详情入口 |

## 依赖关系

```text
BusinessLink + ConnectionSkuSalesFact + ConnectionHospital + DataSyncBatch
  ↓
getMyConnectionWorkbench / LinkSalesRanking / LinkDataStatus / getConnectionHospital
  ↓
my_link_summary / link_sales_ranking / link_data_status / link_hospital_todo / link_list
  ↓
my_links
```

## 业务边界

- 不保存工作台派生业务数据。
- 不新增提成计算；“昨日提成”仅展示能力缺口状态。
- 不改变销售、增长、健康、诊断、负责人和权限口径。
- 销售排行按需加载；各模块共享已有工作台链接和健康数据。
- 我的链接列表不重复显示负责人，但保留关注、加入诊断与详情入口。
