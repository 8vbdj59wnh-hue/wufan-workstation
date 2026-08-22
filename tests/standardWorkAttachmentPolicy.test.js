import assert from "node:assert/strict";
import test from "node:test";

import {
  maxStandardWorkAttachmentSize,
  standardWorkAttachmentAccept,
  validateStandardWorkAttachmentFiles,
} from "../src/standardWorkAttachmentPolicy.js";

test("关键行动和任务公共附件策略允许 XMind 及原有格式", () => {
  assert.equal(standardWorkAttachmentAccept, ".xlsx,.xls,.csv,.xmind");
  for (const name of ["计划.xlsx", "清单.xls", "数据.csv", "思维导图.XMIND"]) {
    assert.equal(validateStandardWorkAttachmentFiles([{ name, size: 1024 }]), "");
  }
});

test("公共附件策略保持 20MB 限制并拒绝非允许格式", () => {
  assert.match(validateStandardWorkAttachmentFiles([{ name: "脚本.exe", size: 1024 }]), /只支持/);
  assert.match(validateStandardWorkAttachmentFiles([{ name: "超大.xmind", size: maxStandardWorkAttachmentSize + 1 }]), /20MB/);
});
