import { closeDatabase } from "../server/db.js";
import {
  readStuckProcessTaskReadinessCandidates,
  repairStuckProcessTaskReadiness,
} from "../server/taskProcessReadinessService.js";

try {
  const candidates = readStuckProcessTaskReadinessCandidates();
  const preview = {
    mode: process.argv.includes("--apply") ? "apply" : "preview",
    candidateCount: candidates.length,
    waveCandidateCount: candidates.filter((item) => item.waveEnabled).length,
    candidates,
  };
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify(preview, null, 2));
    process.exitCode = candidates.length > 0 ? 1 : 0;
  } else {
    if (process.env.WUFAN_CONFIRM_TASK_READINESS_REPAIR !== "1") {
      throw new Error("执行修复前必须显式设置 WUFAN_CONFIRM_TASK_READINESS_REPAIR=1。");
    }
    console.log(JSON.stringify({ ...preview, result: repairStuckProcessTaskReadiness() }, null, 2));
  }
} finally {
  closeDatabase();
}
