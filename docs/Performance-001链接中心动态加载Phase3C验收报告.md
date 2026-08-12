# Performance-001 链接中心动态加载 Phase 3C 验收报告

## 1. 接入结果

- `connectionCenter` 已注册到统一 `moduleLoader`。
- adapter 保持原页面契约：`renderConnectionCenterPage` 对应 `render`，`bindConnectionCenterPageEvents` 对应 `bind`。
- `main.js` 已移除链接中心静态 import。
- 只有路由进入 `connectionCenter` 时才执行动态 import。
- 原有 hash 路由、权限逻辑、页面 render/bind 调用方式保持不变。

## 2. Business-001 回归

没有修改链接中心业务页面及其服务。真实动态模块加载后可正常渲染页面，并确认以下能力仍由原链接中心模块提供：

- Business-001 销售日报分析 `link_daily_sales`；
- 销售日报数据质量 `sales_daily_data_quality`；
- 销售数据异常治理 `sales-data-quality-governance`。

销售事实、mapping、Product Structure、ERP SKU、`appState` 均未修改。

## 3. 加载行为

| 场景 | 结果 |
|---|---|
| 驾驶舱首屏无链接中心静态依赖 | 通过 |
| 首次进入链接中心才加载真实模块 | 通过 |
| 真实模块 render 返回有效页面 | 通过 |
| 重复进入复用 adapter 缓存 | 通过 |
| 快速切换阻止过期页面渲染 | 通过 |
| 加载中状态 | 通过 |
| 加载失败及重试入口 | 通过 |

## 4. 错误隔离

模拟链接中心缺少 `bind` export 后，加载器返回 `route_module_contract_invalid`。链接中心显示独立错误页，其他已注册模块仍可正常加载，错误不会导致整个工作站无法进入。

## 5. 质量检查

- `node --check src/main.js`：通过；
- `node --check src/moduleLoader.js`：通过；
- Phase 3A、3B、3C 专项验证：通过；
- `npm run check`：通过；
- `git diff --check`：通过；
- 旧关系写入风险检查：0 项。

## 6. 结论

链接中心已完成路由级动态加载接入，Business-001 原有页面能力和数据规则未发生变化，满足 Phase 3C 验收条件。
