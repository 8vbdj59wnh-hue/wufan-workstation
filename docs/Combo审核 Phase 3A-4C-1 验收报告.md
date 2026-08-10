# 《Combo审核 Phase 3A-4C-1 验收报告》

## 一、验收结论

Phase 3A-4C-1 已完成隔离开发与验证。待审核的 Combo Group 现在支持平台 SKU 级草稿编辑：人工填写或清空组件数量、排除错误组件、搜索并添加 ERP SKU、保存审核备注。保存后 Group 始终保持 `pending`，未提供批准入口，未创建正式 combo mapping，未写入销售日报事实。

## 二、实现范围

- 服务端新增 Combo 草稿保存能力，并在保存时重新校验 Group 状态、ERP SKU 有效性、组件唯一性和 quantity 合法性。
- 新增 ERP SKU 精确关键词搜索，仅返回有效 ERP SKU；People/权限规则继续由现有 `links.manage` 服务端中间件保护。
- 审核组件增加来源标识：系统发现组件保留原候选来源，人工新增组件写入 `manual_added`。
- 页面增加“编辑草稿”状态，可填写数量、保留/排除组件、添加 ERP SKU 和填写审核备注。
- 既有组件不能静默删除；不需要的组件必须显式标记为 `excluded`，保留审计轨迹。

## 三、quantity规则

| 场景 | quantity | quantitySource |
| --- | ---: | --- |
| 尚未人工确认 | `NULL` | `NULL` |
| 人工填写正数 | 正数 | `manual_confirmation` |
| 非法输入 | 0、负数、非数字 | 服务端拒绝 |

系统没有使用日报 quantity、金额、比例、名称或出现频率推导正式组件数量。

## 四、隔离验证结果

隔离副本验证全部通过：

- quantity 为空可保存；
- 人工填写 `1`、`2.5` 后正确保存并标记 `manual_confirmation`；
- `0`、负数、非数字均被拒绝；
- 组件可标记为排除，记录未删除；
- 可添加有效 ERP SKU，新组件来源为 `manual_added`，来源候选为空；
- 重复保存返回幂等结果，Group 更新时间不重复变化；
- 保存后 Group 仍为 `pending`；
- ERP SKU 搜索仅返回有效记录；
- SQLite `integrity_check=ok`；
- `foreign_key_check` 0 条异常。

## 五、数据保护核对

隔离验证前后保持一致：

| 数据 | 数量 |
| --- | ---: |
| 正式 V2 mapping | 20,819 |
| 销售日报事实 | 0 |
| 周期销售事实 | 505 |
| 销售链接 | 9,051 |
| 平台 SKU | 33,073 |
| ERP SKU | 6,902 |
| 产品 | 1,663 |

正式 mapping 全量哈希和 `sales_link_skus.erpSkuId/productId` 兼容字段哈希均保持不变；approved Combo Group 数量为 0。

## 六、回归与工程检查

- `npm run check`：通过。
- `git diff --check`：通过。
- Combo Component Schema V1.1 回归：通过。
- Phase 3A-4B 工作台真实 938 候选回归：通过，仍归并为 448 个审核组，组件分布仍为 411/32/5。

## 七、修改文件

- `server/db.js`
- `server/schema.sql`
- `server/salesComboReviewService.js`
- `server/index.js`
- `src/appState.js`
- `src/services/connectionCenterService.js`
- `src/connectionCenterPage.js`
- `scripts/verify-combo-review-draft-editing.js`

## 八、范围确认

本阶段未实现批准、拒绝、正式 mapping 生成或日报事实写入，也未修改旧 `erpSkuId/productId` 字段。当前能力仅为可审计的 pending 草稿编辑，可作为后续 Phase 3A-4C 正式人工确认流程的输入。
