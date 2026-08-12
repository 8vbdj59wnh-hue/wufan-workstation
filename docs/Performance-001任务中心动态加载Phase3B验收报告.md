# Performance-001 任务中心动态加载 Phase 3B 验收报告

## 1. 实现结果

- `tasks` 已注册到统一 `moduleLoader`。
- 适配器契约包含 `render`、`bind` 与 `actions.selectTask`。
- `main.js` 已移除 `tasksPage` 静态导入；非任务首屏依赖树不再包含任务页面模块。
- 进入任务中心路由时才调用 `loadRouteModule("tasks")`。
- 页面渲染与事件绑定仍沿用原有 `renderTasksPage`、`bindTasksPageEvents` 调用语义。
- hash 路由、权限判断、`appState` 及任务数据接口均未改变。

## 2. 跨模块调用

通知点击任务时先加载任务模块，再通过 `actions.selectTask` 选择目标任务，最后进入原有 `#task-list` 路由。通知链路不再依赖静态任务模块。

## 3. 加载状态与失败处理

- 首次进入：展示“正在加载任务中心…”状态。
- 加载成功：渲染任务中心并绑定原有事件。
- 加载失败：展示独立错误页，支持重新加载或返回驾驶舱。
- 重复进入：直接复用 adapter 缓存，不重复执行动态导入。
- 快速切换：通过 `navigationRevision` 阻止过期任务页面覆盖当前页面。

## 4. 验证结果

| 场景 | 结果 |
|---|---|
| 非任务首屏无 `tasksPage` 静态依赖 | 通过 |
| 首次进入任务中心动态加载真实模块 | 通过 |
| `render/bind/selectTask` 契约 | 通过 |
| 重复进入复用缓存 | 通过 |
| 快速切换产生 stale navigation 并阻断旧渲染 | 通过 |
| 加载失败页与重试入口 | 通过 |
| 通知点击任务按需加载 | 通过 |
| `npm run check` | 通过 |
| `git diff --check` | 通过 |

专项验证还修正了 Phase 3A 加载器的 adapter 缓存命中路径：模块加载成功后，后续调用直接返回已缓存适配器。

## 5. 范围保护

- 未修改任务业务页面。
- 未修改任务数据接口。
- 未修改 `appState`。
- 未迁移其他页面。
- 未修改数据库或业务数据。

## 6. 结论

任务中心已完成路由级按需加载接入，满足 Phase 3B 验收条件。其他业务模块仍保持现状，可在后续阶段分别迁移。
