# Performance-001 跨模块 Action 解耦 Phase 3F 验收报告

## 1. 实现结果

新增轻量 `moduleActions`：

- `registerModuleAction(moduleId, actionName, handler)`；
- `invokeModuleAction(moduleId, actionName, ...args)`；
- 未注册 Action 首次调用时按需加载对应路由模块；
- 模块加载后由 `moduleLoader` 注册 adapter 暴露的 actions；
- 后续调用直接复用已注册函数和模块缓存。

任务模块加载完成后注册 `tasks.selectTask`，未改动 `selectTask` 的业务实现。

## 2. 跨模块迁移

以下调用方已移除对 `tasksPage.js` 的静态 import：

- `goalsPage.js`；
- `scheduleBoardPage.js`；
- `processesPage.js`；
- `main.js` 通知跳转。

调用统一改为 `invokeModuleAction("tasks", "selectTask", taskId)`。目标、排期、流程及通知的原有提示和 hash 路由行为保持不变。

## 3. 性能验证

| 指标 | Phase 3E | Phase 3F |
|---|---:|---:|
| 首屏静态 JS 闭包 | 52个 | 50个 |
| 首屏静态源码 | 1,663,159 bytes | 1,377,033 bytes |
| 任务路由首次新增 | 123 bytes包装入口 | 4个模块 / 287,650 bytes |
| 首屏直接引用 `tasksPage.js` | 3处 | 0处 |

Phase 3F 进一步从首屏移除 286,126 bytes（约279 KiB）。任务主体现在只在进入任务中心或首次调用任务 Action 时加载。

## 4. 稳定性验证

| 场景 | 结果 |
|---|---|
| Action注册与调用 | 通过 |
| 未注册任务Action触发模块加载 | 通过 |
| 加载后注册 `selectTask` | 通过 |
| 重复Action调用复用缓存 | 通过 |
| 目标页面任务选择入口 | 通过 |
| 排期页面任务跳转入口 | 通过 |
| 流程页面任务选择入口 | 通过 |
| 通知任务跳转入口 | 通过 |
| Phase 3A–3D回归 | 通过 |
| `npm run check` | 通过 |
| `git diff --check` | 通过 |

## 5. 数据与业务保护

- 未修改任务业务逻辑；
- 未修改任务数据接口；
- 未修改 `appState`；
- 未修改数据库或业务数据。

## 6. 结论

跨模块 `selectTask` 静态依赖已经消除，任务中心实现真实按需加载，满足 Phase 3F 验收条件。
