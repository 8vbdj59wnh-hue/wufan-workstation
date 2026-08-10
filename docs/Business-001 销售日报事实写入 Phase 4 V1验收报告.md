# Business-001 销售日报事实写入 Phase 4 V1验收报告

## 一、验收结论

Phase 4 V1 已完成。系统新增“销售日报预览确认”能力；确认时重新执行明细标准化、业务分类、ERP SKU用途解析及链接SKU—ERP SKU统一关系解析，只把全部条件同时满足的商品销售写入 `connection_sku_sales_daily_facts`。

## 二、写入流程

1. 校验预览批次仍为 `preview_ready`，并校验确认人。
2. 重新读取原始预览行，不信任历史分类结果。
3. 批量执行 `ClassifySalesDetailLine`、`ResolveErpSkuBusinessUsages` 和 `ResolveLinkSkuErpRelations`。
4. 仅保留 `product_sale + confirmed/usable ERP usage + active_complete/usable relation + target ERP in mappings`。
5. 对业务唯一键执行 insert、skip、update_pending 分类。
6. 单事务写入事实并更新批次审计摘要。
7. 返回新增、跳过、待更新、阻断原因和金额核对结果。

页面在销售日报预览底部新增“确认写入日报事实”，确认后展示新增事实、幂等跳过、待确认更新、未写入数量、写入销售额和写入利润。

## 三、字段映射

写入身份、日期、数量、销售额、成本、利润、全部利润构成、`factType`、来源批次、源行号、原始JSON及创建/更新时间。完整Combo组件写入 `factType=combo_component`；普通商品写入 `normal`。

## 四、幂等与差异规则

业务唯一键为 `salesLinkSkuId + erpSkuId + saleDate`。

- 不存在：insert。
- 已存在且全部业务字段一致：skip。
- 已存在但业务字段不同：update_pending，返回事实ID、源行号及差异字段；不执行覆盖。
- 同一批次重复点击：直接返回原批次审计结果并标记幂等。

## 五、真实文件隔离验证

验证文件：`7.9-8.9链接利润报表（SKU明细）.xlsx`。

为覆盖写入场景，隔离副本中人工确认了测试ERP用途，并使用真实Combo候选建立两组测试关系：一组完整、一组故意不完整。测试关系和用途在提交前固定快照，提交后逐表逐字段哈希核对。

首次写入结果：

- 新增事实：171条。
- 可写入销售额：14,524.70；实际写入销售额：14,524.70。
- 可写入利润：5,227.43；实际写入利润：5,227.43。
- 辅助核算阻断：57行。
- 邮费调整阻断：41行。
- unknown阻断：11,531行。
- 待确认关系阻断：21行。
- 不完整Combo冲突阻断：4行。
- 完整Combo组件事实：写入成功。

幂等和异常验证：

- 同批次重复点击：幂等，无新增。
- 相同文件新批次：171条全部skip。
- 已存在事实金额不同：1条进入update_pending，原事实未覆盖。
- 注入第1条写入后异常：全部事务回滚，事实数和批次状态均未改变。

## 六、批次审计

批次摘要保存文件名、源文件SHA、解析版本、确认人、确认时间、新增/跳过/待更新数量、阻断原因分布以及候选/写入金额。未写入的辅助、邮费、unknown、待确认关系及冲突保持可追溯。

## 七、数据保护

提交前后哈希一致：

- `sales_link_sku_erp_mappings`
- `sales_link_sku_combo_groups`
- `erp_skus`
- `erp_sku_business_usages`

提交逻辑没有创建关系、修改Combo、修改ERP SKU或确认用途。

- `integrity_check`：ok。
- `foreign_key_check`：0项异常。
- `npm run check`：通过。
- `git diff --check`：通过。

## 八、后续阶段

可以进入经营查询阶段，但查询必须把日报事实作为原子事实来源，并明确区分ERP组件数量和平台成交件数。`update_pending` 在建立人工差异确认能力前不得自动覆盖。
