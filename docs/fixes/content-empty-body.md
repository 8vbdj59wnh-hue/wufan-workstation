# 内容中心：明确无正文支持

## 语义与修改
- `copyText: ""` 是明确不设正文，允许首次策划回填和既有文案修订，也能清空旧正文。
- 缺失、null、非字符串、纯空白、超长正文拒绝。标题必填，非空正文仍按原规则去除首尾空白。
- `server/contentCenterRouter.js`：plans、revise-copy 使用严格正文校验。
- `server/contentCenter/store.mjs`：候选完整性、生成状态、排期与后续文案/话题修订接受已确认空正文；原子性、revision、幂等、行动限制及前后审计不变。
- `public/content-center/requests.js`、app.js、workstation.js：无正文选择与尚未填写分开显示，保存与发起预览不再强制正文非空。
- `shared/contentNoteFields.js`、goalsPage.js、tasksPage.js、keyActionLaunchService.js：仅发布内容笔记标准的正文对应字段不必填（包含历史动态字段ID），其他字段与其他标准保持原有要求。

## 历史兼容
不新增字段、不做数据库迁移、不批量改写历史记录。利用已有 contentStage 记录明确完成的策划。历史上依靠标题、正文等推断为候选、但未保存显式状态的记录，仅在用户明确清空正文时补记原有候选状态，避免退回需求；历史未完成空白需求不自动晋级。

## 验证
`node --test tests/contentCenter/*.test.mjs tests/assistantDeviceSessions.test.js`：68项通过。
`npm run check`：通过。
包含：首次空正文持久化与重启读取、16空9短混合批次、旧正文清空及审计、所有非法输入、权限拒绝、整批版本/行动状态失败回滚、幂等重试、非目标字段不变、再次修改标题/话题、前端状态与发布预览。全程使用隔离测试数据库；没有修改真实文案、发起真实行动或发布笔记。

## 部署状态
原正式提交 d192d19d573692d7564a8da0b1dad9b6a3e6d997。
原生产工作区七项修改已备份到服务器 WufanWorkstationReleases/source-reconcile-20260918，源文件归档 SHA256：8796985588698cded590ef27350c0e83fceab746b242385089f1cef20ccaf164。
本地逐一检查并测试后，以 df407468b58650fc0c141def4f622961394d2b53 保存原生产代码。注册该基线前必须确认生产HEAD未变化、无原暂存修改、全部源文件与快照一致且无额外未跟踪文件；仅登记Git版本，不切换或删除源文件。
基线通过合并保留到本修复的 main，联合回归共75项通过，npm run check通过。此提交为待发布包，正式生效以 release-from-package 的 RELEASE_DEPLOYED=true 与健康检查记录为准。正式发布继续使用预检、备份、纯快进更新及健康检查流程。

## 正式生效后的交接
原内容策划任务重新读取半然阿柚2026-09-21至27的25条原记录及最新revision，确认对应关系和行动状态，再提交已确认的16条 copyText:"" 与9条短正文混合修订稿。使用新的稳定幂等键，不复用已变更内容的旧键；遇到冲突整批停止。本修复任务未代写这些业务文案。
