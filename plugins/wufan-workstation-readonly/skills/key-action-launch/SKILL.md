---
name: key-action-launch
description: Use when the user asks to create, initiate, launch, or 发起 a key action in 极简工作站. Enforces lookup, duplicate checking, preview, explicit confirmation, and controlled submission.
---

# 发起关键行动

1. 先读取目标、同目标已有关键行动和可发起行动标准，核对目标、业务对象、标题与时间，避免重复。
2. 收集行动内容、所属目标、负责人、截止时间，以及所选行动标准要求的全部必填表单字段。缺少信息时继续询问，不能猜测关键业务字段。
3. 调用 `preview_key_action_launch`。预览不会写入业务数据。
4. 向用户展示目标、行动标准、标题、负责人、截止时间、步骤、完成/验收标准和重复检查结果。
5. 必须等待用户在当前对话明确表达“确认发起”“发起”“提交”等同意。不能把用户最初要求创建行动的消息当作对预览内容的最终确认。
6. 只有得到确认后，才可把预览返回的 `confirmationToken` 和完全相同的业务参数传给 `launch_key_action`。任何字段变化都必须重新预览并再次确认。
7. 提交后返回关键行动编号、标题和任务数。失败时解释正式接口错误，不得改用通用写接口或绕过权限。

除 `launch_key_action` 外禁止业务写入。不得执行任务、编辑或取消行动、上传、导入、同步、审批、删除、修改通知状态、修改权限、访问数据库、SSH 或服务器文件。
