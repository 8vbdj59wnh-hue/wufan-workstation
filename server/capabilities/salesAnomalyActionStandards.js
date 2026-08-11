const definitions = Object.freeze({
  sales_drop: { id: "action-standard-sales-drop-recovery", name: "链接销售恢复分析标准", processId: "process-template-sales-drop-recovery", goal: "识别销售下降范围并形成经人工确认的恢复动作。", steps: ["分析销售下降范围", "确认销售恢复动作"] },
  profit_drop: { id: "action-standard-profit-drop-improvement", name: "链接利润改善标准", processId: "process-template-profit-drop-improvement", goal: "核对利润变化事实并形成经人工确认的改善动作。", steps: ["分析利润下降结构", "确认利润改善动作"] },
  sales_gap: { id: "action-standard-sales-gap-investigation", name: "链接销售恢复排查标准", processId: "process-template-sales-gap-investigation", goal: "排查销售断档事实并形成经人工确认的恢复动作。", steps: ["排查销售断档范围", "确认销售恢复动作"] },
  data_quality_issue: { id: "action-standard-sales-data-governance", name: "经营数据治理标准", processId: "process-template-sales-data-governance", goal: "核对数据质量问题并形成经人工确认的治理动作。", steps: ["核对数据质量问题", "确认数据治理动作"] },
});

export function getSalesAnomalyActionStandardDefinition(anomalyType) { return definitions[anomalyType] ?? null; }
export function listSalesAnomalyActionStandardDefinitions() { return Object.entries(definitions).map(([anomalyType, value]) => ({ anomalyType, ...value })); }

export function ensureSalesAnomalyActionStandards(database) {
  const owner = database.prepare("SELECT id,departmentId FROM persons WHERE status<>'inactive' ORDER BY CASE WHEN authRole='admin' THEN 0 ELSE 1 END,id LIMIT 1").get();
  if (!owner) return { created: 0 };
  const departmentId = owner.departmentId || database.prepare("SELECT id FROM departments ORDER BY id LIMIT 1").get()?.id;
  const categoryId = database.prepare("SELECT id FROM categories WHERE type='task' ORDER BY CASE WHEN id LIKE '%value-chain%' THEN 0 ELSE 1 END,id LIMIT 1").get()?.id || null;
  const processCategoryId = database.prepare("SELECT id FROM categories WHERE type='process' ORDER BY id LIMIT 1").get()?.id || categoryId;
  if (!departmentId) return { created: 0 };
  const now = new Date().toISOString(); let created = 0;
  database.transaction(() => {
    for (const definition of Object.values(definitions)) {
      const existing = database.prepare("SELECT id,defaultProcessTemplateId FROM task_templates WHERE name=? AND status='active' ORDER BY id LIMIT 1").get(definition.name);
      const actionStandardId = existing?.id || definition.id;
      const processId = existing?.defaultProcessTemplateId || definition.processId;
      if (!database.prepare("SELECT 1 FROM process_templates WHERE id=?").get(processId)) {
        database.prepare(`INSERT INTO process_templates(id,businessCode,name,categoryId,purpose,applicableDepartmentIds,ownerId,startCondition,completionCondition,overallStandard,status,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(processId, `SAP-${definition.id.slice(-12).toUpperCase()}`, `${definition.name}流程`, processCategoryId, definition.goal, JSON.stringify([departmentId]), owner.id, "用户确认启动关键行动。", "标准步骤完成并保留结果记录。", "只基于销售事实开展人工分析，不自动判断原因或执行经营动作。", "active", 1, now, now);
        definition.steps.forEach((name, index) => database.prepare(`INSERT INTO process_template_nodes(id,templateId,stepType,stepOrder,departmentId,ownerId,executorId,stageName,stageOrder,nodeOrder,name,ownerRule,ownerDepartmentId,ownerPositionId,defaultOwnerId,durationDays,durationMinutes,description,completionStandard,reviewStandard,defaultImportance,defaultUrgency,needAcceptance,accepterRule,defaultAccepterId,outputRequirement,submitType,submitDescription,submitFields,requireFile,requireLink,reviewerId,reviewTargetType,returnToNodeId,requireRejectionReason,waveEnabled,waveSize,waveUnlimited,waveTemplatePriority,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`${processId}-node-${index + 1}`, processId, "execution", index + 1, departmentId, owner.id, "initiator", index === 0 ? "经营分析" : "行动确认", index + 1, 1, name, "fixed_person", departmentId, null, owner.id, 1, 60, definition.goal, index === 0 ? "事实范围和证据清晰。" : "后续动作由经营人员明确确认。", null, "medium", "medium", 0, "none", null, "分析记录", "text", "记录分析证据和人工结论。", "[]", 0, 0, null, null, null, 0, 0, 10, 0, 1, "active", now, now));
      }
      if (!existing) {
        const template = { id: actionStandardId, businessCode: `SAA-${definition.id.slice(-12).toUpperCase()}`, name: definition.name, categoryId, defaultProcessTemplateId: processId, departmentId, ownerId: owner.id, description: definition.goal, completionStandard: "完成标准流程并保留人工判断依据。", importance: "medium", urgency: "medium", needAcceptance: 0, accepterId: null, status: "active", formFields: "[]", createdAt: now, updatedAt: now };
        const availableColumns = new Set(database.prepare("PRAGMA table_info(task_templates)").all().map((column) => column.name));
        const columns = Object.keys(template).filter((column) => availableColumns.has(column));
        database.prepare(`INSERT INTO task_templates(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((column) => template[column]));
        created += 1;
      } else if (!existing.defaultProcessTemplateId) {
        database.prepare("UPDATE task_templates SET defaultProcessTemplateId=?,updatedAt=? WHERE id=?").run(processId, now, existing.id);
      }
    }
  })();
  return { created };
}
