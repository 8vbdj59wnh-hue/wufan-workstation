# Business-001 销售经营行动标准接入 Phase 8-6 验收报告

## 1. 实现结果

销售经营异常已经接入现有关键行动标准体系，链路为：异常 → 推荐行动标准 → `future` 关键行动 → 用户确认启动 → 标准流程实例 → 标准步骤任务。系统不会在异常产生或关键行动保存时自动启动流程。

## 2. 四类标准映射

|异常类型|行动标准|行动标准ID|标准流程|
|-|-|-|-|
|sales_drop|链接销售恢复分析标准|action-standard-sales-drop-recovery|process-template-sales-drop-recovery|
|profit_drop|链接利润改善标准|action-standard-profit-drop-improvement|process-template-profit-drop-improvement|
|sales_gap|链接销售恢复排查标准|action-standard-sales-gap-investigation|process-template-sales-gap-investigation|
|data_quality_issue|经营数据治理标准|action-standard-sales-data-governance|process-template-sales-data-governance|

四个标准及流程采用稳定ID并进行幂等初始化。若生产已有同名启用标准，则复用已有标准，避免重复资产。

## 3. 关键行动保存

销售异常创建关键行动时保存：`sourceType=sales_anomaly`、`actionStandardId`、`anomalySnapshot`、`baselineSnapshot`、`salesLinkId`/`productId` 和推荐标准说明。保存后的状态为 `future`，`processInstanceId` 为空，任务数量不变。

## 4. 行动详情

异常详情和关键行动详情展示来源异常、异常指标、行动标准、标准目标及流程说明。推荐只负责匹配标准，不判断异常原因，也不生成改善结论。

## 5. 流程与权限

用户确认启动后复用现有 `launchWorkPlanAsProcess` / `launchWorkPlanWithProcess` 链路，根据行动标准绑定的 `defaultProcessTemplateId` 创建流程实例，再按标准节点创建任务。权限继续复用现有关键行动创建和启动权限，没有新增权限体系。

## 6. 隔离验证

- 四类异常均匹配正确行动标准和流程模板。
- 每个未启动关键行动均不创建任务或流程实例。
- 启动后均创建对应流程实例和2个标准步骤任务。
- 行动标准初始化重复执行无重复数据。
- 日报事实、SKU-ERP Mapping、ERP用途记录均未变化。
- `integrity_check=ok`。
- `foreign_key_check` 无异常。
- `npm run check` 与 `git diff --check` 通过。

## 7. 数据保护结论

本阶段只新增标准资产和展示/关联逻辑，没有修改销售事实、关系映射、ERP SKU用途或异常判断规则，也没有在异常产生时自动执行经营动作。
