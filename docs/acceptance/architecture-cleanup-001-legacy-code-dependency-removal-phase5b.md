# Architecture Cleanup-001 Legacy代码依赖解除 Phase 5B验收报告

## 1. 结论

本阶段已解除正式运行代码对旧Combo体系和`platform_sku_manual_bindings`人工绑定体系的依赖。Legacy数据库表、字段和历史数据保持原样，未执行Schema迁移或业务数据修改。

- Combo Review前端门面、4个API和后端Service已移除。
- Legacy诊断Resolver不再查询Combo Group或其组件表；正式业务仍只读取Sales Object Resolver。
- 人工产品关系入口保留兼容URL，但只生成Sales Object关系审批，不创建Manual Binding。
- 旧人工绑定表已从全局快照、产品概览、ERP快照和产品页面移除。
- 旧解绑入口保留为明确的HTTP 410兼容响应，不再删除Legacy数据或改写链接SKU关系。
- 防回归检查已扩展为同时阻止Combo表、Manual Binding表的正式读取和写入。

## 2. 清理对象

### Combo体系

| 对象 | 处理 |
|---|---|
| `salesComboReviewService` | 删除正式Service |
| `/api/connection-data-foundation/combo-reviews*` | 删除4个无前端调用API |
| `loadComboReview*` | 删除appState和Service门面导出 |
| Legacy Resolver Combo Group分支 | 删除表查询、组件校验和结果证据依赖 |
| Combo数据库表、字段、索引、触发器 | 原样保留 |
| 历史Combo验证脚本 | 暂列Legacy归档/迁移候选，不纳入正式业务 |

### 人工绑定体系

| 对象 | 处理 |
|---|---|
| `platform_sku_manual_bindings`正式读取 | 从全局快照、产品概览、ERP快照、产品页面移除 |
| Manual Binding写入 | 保持为0；防回归检查覆盖INSERT/UPDATE/DELETE |
| 产品关系建议 | 改为`proposePlatformSkuProductRelation`，生成Sales Object审批 |
| 来源语义 | 使用`product_relation_proposal`和`sales_object_approval` |
| 旧解绑逻辑 | 移除表DELETE和链接SKU状态回写 |
| DELETE `/api/products/platform-skus/:id/bind` | 保留兼容路由，返回`410 legacy_manual_binding_retired` |
| Manual Binding数据库表和历史字段 | 原样保留 |

## 3. 修改文件

- `server/index.js`
- `server/modules/products/index.js`
- `server/productV2Import.js`
- `server/erpFactSnapshots.js`
- `server/db.js`
- `server/capabilities/resolveLinkSkuErpRelation.js`
- `server/salesComboReviewService.js`（删除）
- `src/appState.js`
- `src/services/connectionCenterService.js`
- `src/services/productCenterService.js`
- `src/productCenterPage.js`
- `scripts/check-link-center-v2-cleanup.js`
- `tests/linkCenterV2Cleanup.test.js`

工作区同时存在Phase 2至Phase 4的既有未提交修改；本阶段没有整体暂存或提交。

## 4. 防回归

`check-link-center-v2-cleanup`新增以下门禁：

1. `server/db.js`之外的正式服务禁止引用Combo Group两张表。
2. `server/db.js`之外的正式服务禁止引用`platform_sku_manual_bindings`。
3. 禁止Manual Binding INSERT、UPDATE、DELETE。
4. 前端禁止重新增加Combo Review入口、Manual Binding全局状态或旧解绑Action。
5. 保留数据库Schema初始化和历史资产，不把Schema声明误判为业务依赖。

门禁结果：`riskCount=0`。

## 5. 验证结果

| 检查 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm run test:v2-cleanup` | 4/4通过 |
| `npm run test:product-business` | 4/4通过 |
| `git diff --check` | 通过 |
| `integrity_check` | `ok` |
| `foreign_key_check` | 0项异常 |

开发数据库只读基线保持：

- Combo Group：0
- Combo组件：0
- Manual Binding：0
- Sales Object：6,420
- Daily Facts：11,548

## 6. 保留兼容项

1. Combo及Manual Binding数据库Schema、索引、触发器和历史字段。
2. Legacy Resolver本体继续用于诊断比较，但已不再以Combo Group解释关系。
3. POST产品关系入口保留原URL，避免现有页面调用失效，实际行为为Sales Object审批。
4. DELETE旧解绑URL返回410，明确阻止绕过正式审批修改关系。
5. Legacy历史验证脚本保留，尚未作为本阶段删除范围。

## 7. 删除候选

- 已无正式调用的历史Combo验证/建模脚本。
- Combo Group表、组件表及其索引和触发器；须待Schema退役阶段处理。
- `platform_sku_manual_bindings`及ERP快照中的`manualBindingId`历史字段；须待Schema退役阶段处理。
- 旧`comboGroupId`追溯字段；须先完成历史审计归档。

## 8. 下一阶段建议

Phase 5C建议只做Legacy Schema退役预演：

1. 在生产副本中验证删除空Combo与Manual Binding资产的迁移顺序和回滚。
2. 先移除外键、触发器和索引，再删除空表及空字段。
3. 将仍使用Combo fixture的历史脚本迁移到Sales Object fixture或归档。
4. 对`comboGroupId`、`manualBindingId`进行最终零数据、零引用、零API访问确认。
5. 高数据量Legacy Mapping、Link Product Structure和旧销售事实继续冻结，不在Phase 5C混合删除。
