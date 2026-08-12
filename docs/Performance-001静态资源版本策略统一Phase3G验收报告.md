# Performance-001 静态资源版本策略统一 Phase 3G 验收报告

## 1. 问题基线

改造前扫描结果：

- 版本化静态引用：181处；
- 涉及资源：76个；
- 同一文件存在多个版本URL：6个；
- 多余URL变体：8个。

重复版本资源包括：

- `permissions.js`：4种版本参数；
- `actionProductRelations.js`：2种；
- `processInstanceDetail.js`：2种；
- `assessmentPage.js`：2种；
- `settingsPage.js`：2种；
- `methodologiesPage.js`：2种。

## 2. 统一策略

采用“规范化唯一URL + HTTP协商缓存”：

- 所有静态import、动态import和HTML资源入口移除业务文件自行维护的 `?v=`；
- 同一资源在同一发布及跨发布期间都使用唯一规范路径；
- HTML入口保持 `no-store`，确保应用入口及时更新；
- JS/CSS启用ETag、Last-Modified和 `must-revalidate`；
- 文件未改变时返回304，文件改变时以同一URL返回新内容。

该策略避免原生ES Module无法共享运行时版本常量的问题，也不再要求每个业务文件手工同步版本号。

## 3. 动态模块URL

三个动态模块统一为：

- `./pages/tasksPage.js`；
- `./pages/connectionCenterPage.js`；
- `./pages/productCenterPage.js`。

`main.js`、`moduleLoader`、`moduleActions`、所有静态import和动态import均采用无版本分叉的规范URL。

## 4. 验证结果

| 指标 | 改造前 | 改造后 |
|---|---:|---:|
| `?v=`资源引用 | 181 | 0 |
| 多版本资源 | 6 | 0 |
| 多余URL变体 | 8 | 0 |
| 动态路由URL变体 | 3条带独立版本 | 3条唯一规范URL |

真实HTTP验证：

- 首次请求任务主体：200，返回ETag；
- 再次携带相同ETag：304 Not Modified；
- JS缓存头：`public, max-age=0, must-revalidate`；
- HTML缓存头：`no-store, no-cache, must-revalidate`；
- 任务、链接、产品三个动态入口均以唯一URL返回200。

## 5. 回归检查

- Phase 3A–3F专项验证：通过；
- moduleActions单例注册：通过；
- 任务、链接、产品动态加载：通过；
- `npm run check`：通过；
- `git diff --check`：通过；
- 未修改业务逻辑、页面功能或数据库。

## 6. 结论

静态资源版本策略已经统一。同一模块不再因不同 `?v=` 形成多个浏览器资源身份；重复访问可以通过ETag命中304协商缓存，满足Phase 3G验收条件。
