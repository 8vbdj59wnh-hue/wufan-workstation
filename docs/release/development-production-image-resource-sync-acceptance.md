# 《开发环境生产图片资源同步验收报告》

## 1. 执行结论

- 执行日期：2026-08-15（Asia/Shanghai）
- 执行内容：生产 `uploads` 完整复制到开发环境
- 执行结果：通过
- 生产文件：只读，未修改
- 数据库、图片路径与代码：未修改
- 开发前端、后端及图片静态资源：运行正常

## 2. 路径与同步前保护

| 项目 | 路径 |
|---|---|
| 生产 uploads | `/Users/meiyounaichatouyuna/Projects/goal-execution-system/uploads` |
| 开发 uploads | `/Users/mac/Documents/极简工作站开发/v2-release-001-integration/uploads` |
| 开发同步前备份 | `/Users/mac/Documents/极简工作站开发/v2-release-001-integration/backups/dev-image-sync-20260815/development-uploads-before-sync.tar.gz` |

同步前开发 `uploads` 目录存在，但文件数为0、占用为0 KiB。已将其目录结构归档备份：

- 备份大小：643 bytes
- SHA256：`4e06d97d97dff0f2b57242047d7ecde7fcb45c8cccd13f085879a022ccc291c9`

同步前开发磁盘可用空间约50 GiB，满足生产资源复制需要。

## 3. 生产资源基线

生产目录存在，权限为 `drwxr-xr-x`，所属用户/组为 `meiyounaichatouyuna:staff`。

| 范围 | 文件数 | 生产占用（KiB） |
|---|---:|---:|
| uploads全部 | 33,688 | 19,698,424 |
| product-imports | 1,674 | 282,132 |
| product-v2-imports | 30,968 | 4,768,968 |
| images | 693 | 445,908 |

生产全部普通文件的逻辑字节总数：`20,099,370,979` bytes。

## 4. 复制方式

使用只读SSH来源和归档同步模式，将生产 `uploads/` 完整复制到开发 `uploads/`：

- 保留目录层级；
- 保留文件名称；
- 保留权限位；
- 保留修改时间；
- 开发目标中不存在于生产源的旧文件按镜像规则清理；
- 未对生产端执行写入、重命名或删除。

开发目录同步后的权限为 `drwxr-xr-x`，权限位与生产一致；本地所有者按开发机器身份保持为 `mac:staff`。

## 5. 复制后完整性验证

### 数量与逻辑大小

| 验证项 | 生产 | 开发 | 结果 |
|---|---:|---:|---|
| 文件总数 | 33,688 | 33,688 | 一致 |
| product-imports | 1,674 | 1,674 | 一致 |
| product-v2-imports | 30,968 | 30,968 | 一致 |
| images | 693 | 693 | 一致 |
| 文件逻辑字节总数 | 20,099,370,979 | 20,099,370,979 | 一致 |

生产与开发的 `du` 占用略有差异，是两台机器文件系统分配块不同造成；文件逻辑字节总数完全一致。

### 全量内容校验

复制完成后执行基于文件内容校验和的只读全量差异扫描，结果：

- 退出状态：0
- 差异输出：0条
- 缺少文件：0
- 多余文件：0
- 内容差异：0

### SHA256抽样

| 目录样本 | SHA256 | 两端结果 |
|---|---|---|
| `product-imports/.../row-10-9.jpeg` | `fbc20db877374288f2e6068728f5b7e7ab9c7ba99735027e324eccebe209a9b2` | 一致 |
| `product-v2-imports/.../erp-v2-goods_info-1785388614548-b0298d.json` | `406bd38621c59d3d0ef3fe1a7b0153fe301b829db33d67945c96f1abd556fc6d` | 一致 |
| `images/1782287295752-2gb5c34d.jpg` | `878300d7d1fab5af32de58041ff865ecbef13a3506f8c41ddf169c6c91be0651` | 一致 |

## 6. 图片抽查

### 产品主图与链接图片

数据库真实路径：

`/uploads/product-imports/product-import-1784987522648-qtdfat/row-2-1.jpeg`

开发请求：

`http://127.0.0.1:3001/uploads/product-imports/product-import-1784987522648-qtdfat/row-2-1.jpeg`

结果：HTTP 200，`Content-Type: image/jpeg`，`Content-Length: 124710`。

该图片同时被真实产品档案和链接档案引用，产品主图及链接图片路径均可访问。

### ERP SKU图片

数据库真实路径：

`/uploads/product-v2-imports/erp-v2-goods_info-1785908125185-c91805/e87b95c286809c734aff1e68.png`

开发请求：

`http://127.0.0.1:3001/uploads/product-v2-imports/erp-v2-goods_info-1785908125185-c91805/e87b95c286809c734aff1e68.png`

结果：HTTP 200，`Content-Type: image/png`，`Content-Length: 994602`。

上述请求在同步前为HTTP 404，同步后均恢复为HTTP 200。

## 7. 服务验证

| 服务 | 地址 | 结果 |
|---|---|---|
| 开发前端 | `http://127.0.0.1:5174/` | HTTP 200 |
| 开发API | `http://127.0.0.1:3001/api/health` | HTTP 200，`status=ok`，`database=ok` |
| 图片静态资源 | `http://127.0.0.1:3001/uploads/...` | 抽查HTTP 200 |

资源目录由静态服务实时读取，本次不需要重启开发服务。

## 8. 回滚方案

如需恢复同步前的开发图片状态：

1. 停止开发服务以避免资源读取竞争；
2. 将当前开发 `uploads` 移出运行路径留档；
3. 解压 `development-uploads-before-sync.tar.gz` 到项目根目录；
4. 核对备份SHA256；
5. 重启开发服务并检查前端与API。

本次同步前开发目录没有图片文件，因此回滚将恢复为空资源目录。
