import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { listConnectionGrowthAnalyses } from "./connectionGrowthService.js";

function parseJson(value, fallback = []) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }

function isAnomalous(analysis) {
  return Number(analysis.salesGrowth) < -0.2 || Number(analysis.visitorGrowth) < -0.2
    || Number(analysis.conversionChange) < -0.01 || Number(analysis.profitGrowth) < -0.2
    || (analysis.healthScore !== null && analysis.healthScore < 60);
}

function isRecovered(analysis, improvement) {
  const observationDate = String(improvement?.updatedAt || "").slice(0, 10);
  const hasNewObservationPeriod = observationDate && String(analysis.currentPeriod?.periodEnd || "") > observationDate;
  return hasNewObservationPeriod && analysis.comparable && !isAnomalous(analysis) && Number(analysis.salesGrowth) >= 0
    && Number(analysis.visitorGrowth) >= 0 && Number(analysis.conversionChange) >= 0;
}

function analysisProblems(analysis) {
  const problems = [];
  if (Number(analysis.salesGrowth) < -0.2) problems.push({ type: "sales", title: "销售显著下降", value: analysis.salesGrowth });
  if (Number(analysis.visitorGrowth) < -0.2) problems.push({ type: "traffic", title: "流量下降", value: analysis.visitorGrowth });
  if (Number(analysis.conversionChange) < -0.01) problems.push({ type: "conversion", title: "转化下降", value: analysis.conversionChange });
  if (Number(analysis.profitGrowth) < -0.2) problems.push({ type: "profit", title: "利润下降", value: analysis.profitGrowth });
  if (!problems.length && analysis.healthScore !== null && analysis.healthScore < 60) problems.push({ type: "health", title: "健康评分下降", value: analysis.healthScore });
  return problems;
}

export function joinConnectionDiagnosis(connectionId, input = {}, userId, isAdmin = false) {
  const id = String(connectionId ?? "").trim(); const database = getDatabase();
  const analysis = listConnectionGrowthAnalyses().find((item) => item.connectionId === id);
  if (!analysis) throw new Error("未找到连接档案。");
  const operatorId = String(userId ?? "").trim();
  if (!isAdmin && (!analysis.ownerId || analysis.ownerId !== operatorId)) throw new Error("只有该链接负责人或管理员可以加入诊断。");
  const reasons = analysisProblems(analysis);
  if (!reasons.length && !["attention", "risk"].includes(analysis.healthStatus)) throw new Error("当前链接没有需要确认的经营异常。");
  const existing = database.prepare("SELECT * FROM connection_diagnosis_entries WHERE connectionId=? AND status='active'").get(id);
  if (existing) return { ...existing, anomalyReasons: parseJson(existing.anomalyReasonsJson) };
  const now = new Date().toISOString(); const entryId = `connection-diagnosis-${crypto.randomUUID()}`;
  database.prepare(`INSERT INTO connection_diagnosis_entries
    (id,connectionId,initiatedBy,joinedAt,anomalyReasonsJson,notes,status,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,'active',?,?)`).run(entryId, id, operatorId || null, now, JSON.stringify(reasons), String(input?.notes ?? "").trim() || null, now, now);
  const item = database.prepare("SELECT * FROM connection_diagnosis_entries WHERE id=?").get(entryId);
  return { ...item, anomalyReasons: reasons };
}

export function getConnectionHospital() {
  const database = getDatabase();
  const analyses = listConnectionGrowthAnalyses();
  const records = database.prepare(`SELECT * FROM connection_health_records ORDER BY createdAt DESC,id DESC`).all();
  const latestRecord = new Map();
  for (const row of records) if (!latestRecord.has(row.connectionId)) latestRecord.set(row.connectionId, row);
  const improvements = database.prepare(`
    SELECT i.*,p.status actionStatus,p.completedAt actionCompletedAt,
      (SELECT COUNT(*) FROM tasks t WHERE t.processInstanceId=i.actionId) taskCount,
      (SELECT COUNT(*) FROM tasks t WHERE t.processInstanceId=i.actionId AND t.status='completed') completedTaskCount
    FROM connection_improvements i JOIN process_instances p ON p.id=i.actionId
    ORDER BY i.updatedAt DESC,i.createdAt DESC
  `).all();
  const activeImprovement = new Map();
  for (const item of improvements) {
    if (!activeImprovement.has(item.connectionId) && !["effective", "closed"].includes(item.status)) activeImprovement.set(item.connectionId, item);
  }
  const diagnosisEntries = database.prepare(`SELECT e.*,(SELECT name FROM persons WHERE id=e.initiatedBy) initiatedByName
    FROM connection_diagnosis_entries e WHERE e.status='active' ORDER BY e.joinedAt DESC,e.id DESC`).all();
  const entryByConnection = new Map(diagnosisEntries.map((item) => [item.connectionId, item]));
  const result = { diagnosis: [], treatment: [], observation: [] };
  for (const analysis of analyses) {
    const health = latestRecord.get(analysis.connectionId) ?? null;
    const improvement = activeImprovement.get(analysis.connectionId) ?? null;
    const diagnosisEntry = entryByConnection.get(analysis.connectionId) ?? null;
    const healthProblems = health ? parseJson(health.problemsJson) : [];
    const entryProblems = diagnosisEntry ? parseJson(diagnosisEntry.anomalyReasonsJson) : [];
    const problems = entryProblems.length ? entryProblems : healthProblems.length ? healthProblems : analysisProblems(analysis);
    if (!diagnosisEntry && !improvement) continue;
    const stage = (!improvement && diagnosisEntry) || ["planned", "failed"].includes(improvement?.status) ? "diagnosis"
      : improvement.status === "executing" ? "treatment" : improvement.status === "observing" && !isRecovered(analysis, improvement) ? "observation" : null;
    if (!stage) continue;
    const suggestions = health ? parseJson(health.suggestionsJson) : [];
    result[stage].push({
      connectionId: analysis.connectionId, connectionName: analysis.name, ownerId: analysis.ownerId, ownerName: analysis.ownerName,
      platform: analysis.platform, shopName: analysis.shopDisplayName || analysis.shopName, healthScore: analysis.healthScore,
      healthStatus: analysis.healthStatus, salesGrowth: analysis.salesGrowth, visitorGrowth: analysis.visitorGrowth,
      conversionChange: analysis.conversionChange, profitGrowth: analysis.profitGrowth, problems,
      problemTitle: problems[0]?.title || "经营数据异常", discoveredAt: diagnosisEntry?.joinedAt || health?.createdAt || analysis.currentPeriod?.periodEnd || null,
      diagnosisEntry: diagnosisEntry ? { ...diagnosisEntry, anomalyReasons: entryProblems } : null,
      healthRecord: health ? { ...health, problems: healthProblems, suggestions } : null,
      improvementId: improvement?.id || null, improvementStatus: improvement?.status || null,
      treatmentPlan: suggestions[0]?.title || improvement?.title || "待制定治疗方案", actionId: improvement?.actionId || null,
      actionStatus: improvement?.actionStatus || null, actionCompletedAt: improvement?.actionCompletedAt || null,
      taskCount: Number(improvement?.taskCount || 0), completedTaskCount: Number(improvement?.completedTaskCount || 0),
    });
  }
  result.diagnosis.sort((a, b) => Number(a.healthScore ?? 101) - Number(b.healthScore ?? 101));
  result.treatment.sort((a, b) => (a.taskCount ? a.completedTaskCount / a.taskCount : 0) - (b.taskCount ? b.completedTaskCount / b.taskCount : 0));
  result.observation.sort((a, b) => String(b.actionCompletedAt || "").localeCompare(String(a.actionCompletedAt || "")));
  return { zones: result, counts: Object.fromEntries(Object.entries(result).map(([key, items]) => [key, items.length])),
    admittedConnectionIds: diagnosisEntries.map((item) => item.connectionId) };
}
