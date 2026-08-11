# Business-001 销售异常推荐关键行动 Phase 8-4 验收报告

## 1. 实现内容

经营异常详情新增“推荐关键行动”区域，并继续复用Phase 8-1建立的人工创建入口。系统仅根据 `anomalyType` 给出推荐名称和预选上下文，不分析异常原因、不自动创建行动、不启动流程。

## 2. 推荐映射

| 异常类型 | 推荐关键行动 |
|---|---|
| `sales_drop` | 链接销售恢复分析行动 |
| `profit_drop` | 链接利润改善行动 |
| `sales_gap` | 链接销售恢复排查行动 |
| `data_quality_issue` | 经营数据治理行动 |

推荐结果结构为 `recommendedActionTemplate`，包含稳定key、推荐名称、精确名称匹配方式和可选 `taskTemplateId`。

## 3. 真实模板匹配情况

当前隔离生产副本中不存在上述四个同名启用关键行动模板。系统不会伪造模板或自行创建模板：

- 异常详情正常展示推荐名称；
- 创建表单保存推荐名称；
- 用户仍需按现有规则人工选择可发起的关键行动模板；
- 未来出现同名、启用且已绑定流程的模板后，创建入口会精确预选；
- 不使用模糊名称匹配。

## 4. 创建与追溯

人工保存的待发起关键行动包含：

- `source=sales_anomaly`；
- `sourceType=sales_anomaly`；
- `salesLinkId` 或 `productId`；
- `anomalySnapshot`；
- `baselineSnapshot`；
- `recommendedActionTemplate`。

创建状态固定为 `future`，不会自动启动流程，因此不会生成任务。数据质量异常也可进入人工创建表单，但不伪造 `salesLinkId/productId`。

## 5. 权限

继续复用：

- `workPlans.launch`；
- 关键行动模板发起范围；
- 目标管理现有权限。

没有新增权限体系，没有绕过模板范围。

## 6. 隔离验证

验证完成：

1. 四种异常推荐映射全部正确；
2. 产品异常可创建 `future` 关键行动；
3. 销售链接异常可创建 `future` 关键行动；
4. `sourceType=sales_anomaly` 正确恢复；
5. 异常快照完整恢复；
6. 产品和链接关联对象正确；
7. 推荐关键行动描述完整恢复；
8. 不生成任务；
9. 不创建流程实例。

## 7. 数据保护

验证前后：

- 日报事实：3668 → 3668；
- V2 Mapping：20819 → 20819；
- ERP用途：86 → 86；
- 任务：5481 → 5481；
- 流程实例：933 → 933。

`integrity_check=ok`，`foreign_key_check` 无异常。未修改销售事实、关系或用途数据。

## 8. 工程验证

- `npm run check`：通过；
- `git diff --check`：通过；
- 隔离验证脚本：通过；
- 本阶段未发布生产。
