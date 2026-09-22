---
name: key-action-launch
description: Use when the user asks to create, initiate, launch, or 发起 a key action in 极简工作站. Enforces lookup, duplicate checking, preview, explicit confirmation, and controlled submission.
---

# 发起关键行动

1. 先读取目标、同目标已有关键行动和可发起行动标准，核对目标、业务对象、标题与时间，避免重复。
2. 收集行动内容、所属目标、负责人、截止时间，以及所选行动标准要求的全部必填表单字段。缺少信息时继续询问，不能猜测关键业务字段。
3. 如果用户明确提供或选择了本地参考图片，调用 `upload_key_action_reference_images` 暂存这些图片。只可传入用户指定的图片路径，不得扫描目录或寻找其他文件。将返回的全部 `attachmentIds` 原样传给预览；参考图片不是产品图。
4. 调用 `preview_key_action_launch`。预览不会创建工作计划、流程实例或任务；图片上传仅产生最长24小时的受控暂存附件。
5. 向用户展示目标、行动标准、标题、参考图片、负责人、截止时间、步骤、完成/验收标准和重复检查结果。
6. 必须等待用户在当前对话明确表达“确认发起”“发起”“提交”等同意。不能把用户最初要求创建行动的消息当作对预览内容的最终确认。
7. 只有得到确认后，才可把预览返回的 `confirmationToken` 和完全相同的业务参数及完全相同的 `referenceAttachmentIds` 传给 `launch_key_action`。新增、删除、替换图片或修改任何业务字段都必须重新预览并再次确认。
8. 提交后确认返回的关键行动编号、标题、任务数和参考图片关联结果。上传成功不等于行动关联成功；只有正式提交成功并返回关联图片后才能报告完成。
9. 用户取消发起或在预览前替换图片时，调用 `discard_key_action_reference_images` 清理本设备尚未引用的暂存图片。已被业务引用的附件会被服务器保留。失败时解释正式接口错误，不得改用通用写接口或绕过权限。

除 `upload_key_action_reference_images`、`discard_key_action_reference_images` 和 `launch_key_action` 外禁止关键行动业务写入。参考图工具只能处理用户明确选择的JPG、PNG或WebP图片，最多9张、单张不超过5MB。不得执行任务、编辑或取消行动、任意文件上传、任意URL抓取、导入、同步、审批、删除、修改通知状态、修改权限、访问数据库、SSH或服务器文件。
