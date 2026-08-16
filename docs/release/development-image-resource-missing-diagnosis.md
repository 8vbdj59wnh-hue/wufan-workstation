# 《开发环境图片资源缺失诊断报告》

## 1. 诊断结论

生产数据同步只同步了 SQLite 业务数据库，没有同步生产 `uploads` 图片资源目录。数据库中的图片字段主要保存文件 URL/相对路径，不保存图片二进制内容。因此开发页面能够取得图片路径，但请求开发 API 的 `/uploads/...` 时找不到对应文件并返回 HTTP 404。

问题属于开发环境静态资源缺失，不是数据库图片字段丢失，也不是前端 URL 拼接错误。

本次检查全程只读，未修改数据库、图片文件或代码。

## 2. 数据库图片字段存储方式

数据库中图片相关字段均为 `TEXT`，主要包括：

| 表 | 字段 | 用途 |
|---|---|---|
| `products` | `mainImage`, `galleryImages` | 产品主图、图集路径 |
| `erp_skus` | `mainImage`, `galleryImages` | ERP SKU主图、图集路径 |
| `connection_profiles` | `mainImage`, `imageSource` | 链接档案图片及来源 |
| `connection_benchmark_targets` | `mainImage` | 对标链接图片 |
| `persons` | `avatarUrl` | 用户头像路径 |
| `tasks`, `work_plans`, `process_instances` | `coverImageUrl` | 工作对象封面路径 |
| `content_schedules` | `productImage` | 内容排期产品图片 |
| `templates` | `previewImage` | 模板预览图片 |

`products.mainImage` 的存储类型检查结果为 2,933 条文本、25 条空值，没有 BLOB 图片内容。

### 产品与ERP SKU图片记录

| 分类 | 数量 |
|---|---:|
| 产品主图非空 | 2,933 |
| 产品本地 `/uploads/...` 路径 | 2,919 |
| 产品远程 HTTP(S) URL | 14 |
| 产品主图为空 | 25 |
| ERP SKU主图非空 | 5,970 |
| ERP SKU本地 `/uploads/...` 路径 | 5,970 |
| ERP SKU主图为空 | 932 |

典型数据库值：

`/uploads/product-imports/product-import-1784987522648-qtdfat/row-2-1.jpeg`

`/uploads/product-v2-imports/erp-v2-goods_info-1785908125185-c91805/66f3e144c236a0ff949aa97c.png`

## 3. 图片路径来源与请求规则

- 服务端资源根目录由 `server/db.js` 定义为项目根目录下的 `uploads`。
- 服务端通过 `app.use("/uploads", express.static(uploadsDir))` 暴露静态文件。
- 前端 `resolveAssetUrl` 遇到以 `/` 开头的路径时，会拼接 API 地址。
- 当前开发页面为 `http://127.0.0.1:5174/`，API端口为3001，因此数据库路径最终转换为：

`http://127.0.0.1:3001/uploads/...`

该 URL 生成逻辑与当前开发服务配置一致。

## 4. 生产与开发图片目录对比

### 生产环境

| 项目 | 结果 |
|---|---|
| 项目目录 | `/Users/meiyounaichatouyuna/Projects/goal-execution-system` |
| 图片资源目录 | `/Users/meiyounaichatouyuna/Projects/goal-execution-system/uploads` |
| 目录大小 | 约19 GB |
| 文件总数 | 33,688 |
| `uploads/product-imports` | 1,674 个文件 |
| `uploads/product-v2-imports` | 30,968 个文件 |
| `uploads/images` | 693 个文件 |

抽查数据库引用的 `row-2-1.jpeg`：生产目录存在。

### 开发环境

| 目录 | 状态 |
|---|---|
| `/Users/mac/Documents/极简工作站开发/v2-release-001-integration/uploads` | 存在 |
| `uploads/product-imports` | 缺失 |
| `uploads/product-v2-imports` | 缺失 |
| `uploads/images` | 存在但0个文件 |
| 开发 `uploads` 总文件数 | 0 |

结论：图片文件没有随数据库同步到开发环境。

## 5. 图片请求验证

对数据库中的两条真实图片路径按前端规则生成开发请求 URL：

| 请求URL | HTTP状态 |
|---|---:|
| `http://127.0.0.1:3001/uploads/product-imports/product-import-1784987522648-qtdfat/row-2-1.jpeg` | 404 Not Found |
| `http://127.0.0.1:3001/uploads/product-v2-imports/erp-v2-goods_info-1785908125185-c91805/66f3e144c236a0ff949aa97c.png` | 404 Not Found |

404由开发 API 的静态资源服务返回。API本身在线，失败原因是文件不存在，不是服务不可用。

14条保存为远程 HTTP(S) URL 的产品图片不依赖本地 `uploads`，其展示仍取决于外部图片站点的可访问性。

## 6. 根因判断

1. 数据库同步成功，图片路径字段完整存在。
2. 图片是数据库外部文件资产，不包含在 SQLite 数据库中。
3. 当前生产部署流程明确将 `uploads/` 与数据库、源码分开管理。
4. Phase Dev-Data-001只同步了生产数据库快照，未同步约19 GB的生产图片目录。
5. 开发静态服务按本地项目 `uploads` 查找文件，而该目录为空，所以页面图片请求返回404。

## 7. 修复建议

### 推荐方案

在单独备份和校验后，将生产 `uploads` 目录只读复制到开发项目的：

`/Users/mac/Documents/极简工作站开发/v2-release-001-integration/uploads`

建议步骤：

1. 记录当前开发 `uploads` 目录状态并备份已有文件；
2. 在生产端生成一致的 `uploads` 资源归档或使用可校验的增量同步；
3. 同步 `product-imports`、`product-v2-imports`、`images` 等数据库正在引用的目录；
4. 对文件数量、目录大小和归档SHA256进行核验；
5. 抽查数据库图片路径对应文件，并验证开发URL返回HTTP 200；
6. 不修改数据库中的图片路径。

生产图片目录约19 GB，建议执行独立的“开发环境生产图片资源同步”任务，避免把大文件复制与数据库恢复混在同一事务中。若开发只需产品模块，也可以先同步数据库实际引用最多的 `product-imports` 与 `product-v2-imports`，但这会留下头像、行动图片和附件缺失，不属于完整环境镜像。

### 不建议方案

- 不建议批量改写数据库路径指向生产服务；这会让开发依赖生产运行状态，并可能造成环境串用。
- 不建议用占位图掩盖404；这不能解决资源缺失。
- 不建议重新导入产品数据生成图片；现有路径已正确，只缺对应文件。
