import {
  createId,
  createPersistentResource,
  getNow,
  resolveAssetUrl,
  state,
  updatePersistentResource,
  uploadGenericFile,
  uploadImageFile,
} from "./appState.js?v=20260701-compact-standard-work-card1";
import { hasPermission } from "./permissions.js?v=20260701-compact-standard-work-card1";

const demoMethodology = {
  id: "methodology-xhs-image-guide",
  title: "小红书图文笔记配图制作说明",
  flowId: "process-content-note-publishing",
  nodeId: "node-visual-image-production",
  departmentId: "dept-visual-marketing",
  flowName: "内容笔记发布流程",
  nodeName: "视觉制作图片",
  departmentName: "视觉营销部",
  positionNames: ["视觉设计", "内容制作"],
  mediaTypes: ["文字", "图片", "视频"],
  status: "启用",
  updatedAt: "2026-06-29",
  steps: [
    {
      id: "method-step-xhs-001",
      title: "根据笔记主题确认画面情绪",
      instruction: "先阅读笔记主题、目标人群和卖点，确认画面要表达的情绪，例如松弛、精致、实用或惊喜。",
      needsImageDemo: true,
      needsVideoDemo: true,
    },
    {
      id: "method-step-xhs-002",
      title: "确认账号调性",
      instruction: "对照账号过往内容，确认色彩、构图、文字比例和生活场景是否保持一致。",
      needsImageDemo: true,
      needsVideoDemo: true,
    },
    {
      id: "method-step-xhs-003",
      title: "选择产品展示角度",
      instruction: "根据产品核心卖点选择展示角度，保证用户能快速看懂产品是什么、适合什么场景。",
      needsImageDemo: true,
      needsVideoDemo: true,
    },
    {
      id: "method-step-xhs-004",
      title: "制作配图",
      instruction: "按笔记结构制作首图和辅助图，控制画面信息密度，避免堆砌元素。",
      needsImageDemo: true,
      needsVideoDemo: true,
    },
    {
      id: "method-step-xhs-005",
      title: "对照审核标准自检",
      instruction: "提交前按完成标准和审核标准逐项检查，确认图片既好看，也服务于转化目的。",
      needsImageDemo: true,
      needsVideoDemo: true,
    },
  ],
  completionStandards: [
    "图片清晰",
    "风格统一",
    "产品表达准确",
    "符合笔记主题",
    "至少满足“喜欢 / 有用 / 有趣”中的一个",
  ],
  reviewStandards: [
    "是否符合账号调性",
    "是否自然种草",
    "是否清楚表达产品",
    "是否有审美或实用价值",
  ],
  commonMistakes: [
    "图片好看但和主题无关",
    "产品出现太硬",
    "风格和账号不一致",
    "画面信息太乱",
    "只追求美观但没有转化目的",
  ],
};

let selectedMethodologyId = demoMethodology.id;
let editingId = null;
let keyword = "";
let formError = "";
let activeUser = null;

function canCurrentUser(permissionPath) {
  return hasPermission(activeUser, permissionPath);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function canView() {
  return canCurrentUser("methods.view");
}

function canEdit() {
  return canCurrentUser("methods.edit");
}

function canCreate() {
  return canCurrentUser("methods.create");
}

function findName(items, id, fallback = "未关联") {
  if (!id) return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function getStandardWorkForTemplate(templateId) {
  return state.taskTemplates.find((template) => template.defaultProcessTemplateId === templateId) ?? null;
}

function getMethodologyNode(methodology) {
  return state.processTemplateNodes.find((node) => node.id === methodology.processNodeId) ?? null;
}

function getMethodologyTitleFromNode(nodeName) {
  return `${String(nodeName ?? "").replaceAll("+", "").trim()}操作说明`;
}

function getMethodologyByNodeId(nodeId) {
  return state.methodologies.find((methodology) => methodology.processNodeId === nodeId) ?? null;
}

export function getMethodologyLinkByNodeId(nodeId, label = "查看方法论") {
  const methodology = getMethodologyByNodeId(nodeId);
  if (methodology === null) return `<a class="text-button" href="#methods">${label}</a>`;
  return `<a class="text-button" href="#methodology-${methodology.id}">${label}</a>`;
}

export function getMethodologyLinkByStandardWorkId(standardWorkId, label = "查看方法论") {
  const methodology = state.methodologies.find((item) => item.standardWorkId === standardWorkId || item.taskTemplateId === standardWorkId) ?? null;
  if (methodology === null) return `<a class="text-button" href="#methods">${label}</a>`;
  return `<a class="text-button" href="#methodology-${methodology.id}">${label}</a>`;
}

function syncSelectedFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith("methodology-")) return;
  const id = hash.slice("methodology-".length);
  if (getMethodologies().some((item) => item.id === id)) selectedMethodologyId = id;
}

function isDetailRoute() {
  return window.location.hash.replace(/^#/, "").startsWith("methodology-");
}

function getMethodologies() {
  const hasDemo = state.methodologies.some((methodology) => methodology.id === demoMethodology.id);
  return hasDemo ? state.methodologies : [demoMethodology, ...state.methodologies];
}

function getFilteredMethodologies() {
  const text = keyword.trim().toLowerCase();
  return getMethodologies().filter((methodology) => {
    if (text === "") return true;
    const node = getMethodologyNode(methodology);
    const processTemplateName = findName(state.processTemplates, methodology.processTemplateId, "");
    const standardWorkName = findName(state.taskTemplates, methodology.standardWorkId ?? methodology.taskTemplateId, "");
    return [
      methodology.title,
      methodology.flowName,
      methodology.nodeName,
      methodology.departmentName,
      methodology.positionNames?.join(" "),
      methodology.mediaTypes?.join(" "),
      node?.name,
      processTemplateName,
      standardWorkName,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text));
  });
}

function renderStepPreview(step, index) {
  const image = step.imageUrl ? `<img class="method-media" src="${resolveAssetUrl(step.imageUrl)}" alt="${escapeHtml(step.title || `步骤${index + 1}`)}" />` : "";
  const video = step.videoUrl ? `<video class="method-media" src="${resolveAssetUrl(step.videoUrl)}" controls></video>` : "";
  const imageDemo = step.needsImageDemo || step.imageUrl ? `
    <div class="methodology-step-supplement">
      <div class="methodology-media-grid">${renderMediaPlaceholder("上传示范图")}</div>
    </div>
  ` : "";
  const videoDemo = step.needsVideoDemo || step.videoUrl ? `
    <div class="methodology-step-supplement">
      <div class="methodology-media-grid">${renderMediaPlaceholder("上传示范视频")}</div>
    </div>
  ` : "";
  return `
    <article class="method-step">
      <div class="method-step-heading">
        <span class="status-pill">步骤${index + 1}</span>
        <h4>${escapeHtml(step.title || `第${index + 1}步`)}</h4>
      </div>
      <p>${escapeHtml(step.instruction || "暂无操作说明")}</p>
      ${image}
      ${video}
      ${imageDemo}
      ${videoDemo}
      ${step.notes ? `<p class="form-note">注意事项：${escapeHtml(step.notes)}</p>` : ""}
    </article>
  `;
}

function renderMethodologyList() {
  const items = getFilteredMethodologies();
  return `
    <section class="settings-section methodology-list">
      <div class="section-heading with-actions">
        <div>
          <h2>方法论列表</h2>
          <p class="form-note">按流程节点沉淀标准操作说明，员工可在任务中查看。</p>
        </div>
        ${canCreate() ? `<button class="primary-button" type="button" data-action="create-methodology">新增方法论</button>` : ""}
      </div>
      <form class="task-filters methodology-search">
        <label>
          <span>搜索</span>
          <input name="keyword" value="${escapeHtml(keyword)}" placeholder="标题 / 流程节点 / 标准工作 / 流程" />
        </label>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>方法论标题</th><th>适用流程</th><th>适用节点</th><th>适用部门</th><th>内容形式</th><th>状态</th></tr>
          </thead>
          <tbody>
            ${items.length === 0 ? `<tr><td colspan="6">暂无方法论</td></tr>` : items
              .map((item) => {
                const filled = (item.steps ?? []).some((step) => step.instruction || step.imageUrl || step.videoUrl);
                const node = getMethodologyNode(item);
                const flowName = item.flowName ?? findName(state.processTemplates, item.processTemplateId, "未关联流程");
                const nodeName = item.nodeName ?? node?.name ?? "未关联节点";
                const departmentName = item.departmentName ?? "未设置";
                const mediaTypes = item.mediaTypes?.join(" / ") ?? "文字";
                return `
                  <tr class="${item.id === selectedMethodologyId ? "is-selected" : ""}" data-methodology-id="${item.id}">
                    <td><a class="methodology-title-link" href="#methodology-${item.id}">${escapeHtml(item.title)}</a></td>
                    <td>${escapeHtml(flowName)}</td>
                    <td>${escapeHtml(nodeName)}</td>
                    <td>${escapeHtml(departmentName)}</td>
                    <td>${escapeHtml(mediaTypes)}</td>
                    <td>${escapeHtml(item.status ?? (filled ? "已填写" : "空内容"))}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderNodeOptions(selectedId) {
  return `
    <option value="">请选择流程节点</option>
    ${state.processTemplateNodes
      .map((node) => {
        const template = state.processTemplates.find((item) => item.id === node.templateId);
        return `<option value="${node.id}" ${node.id === selectedId ? "selected" : ""}>${escapeHtml(template?.name ?? "未关联流程")} / ${escapeHtml(node.name)}</option>`;
      })
      .join("")}
  `;
}

function renderStepEditor(step = {}, index) {
  return `
    <article class="method-step-editor" data-step-index="${index}">
      <div class="section-heading with-actions">
        <h4>步骤${index + 1}</h4>
        <div class="row-actions">
          <button class="secondary-button" type="button" data-action="move-method-step-up" data-step-index="${index}" ${index === 0 ? "disabled" : ""}>上移</button>
          <button class="secondary-button" type="button" data-action="move-method-step-down" data-step-index="${index}">下移</button>
          <button class="danger-button" type="button" data-action="remove-method-step" data-step-index="${index}">删除</button>
        </div>
      </div>
      <input type="hidden" name="stepImageUrl" value="${escapeHtml(step.imageUrl ?? "")}" />
      <input type="hidden" name="stepVideoUrl" value="${escapeHtml(step.videoUrl ?? "")}" />
      <label><span>步骤标题</span><input name="stepTitle" value="${escapeHtml(step.title ?? "")}" placeholder="第一步 / 第二步 / 第三步" /></label>
      <label><span>操作说明</span><textarea name="stepInstruction">${escapeHtml(step.instruction ?? "")}</textarea></label>
      <div class="form-grid">
        <label><span>图片</span><input name="stepImageFile" type="file" accept="image/*" /></label>
        <label><span>视频</span><input name="stepVideoFile" type="file" accept="video/*" /></label>
      </div>
      ${(step.imageUrl || step.videoUrl) ? `
        <div class="method-media-grid">
          ${step.imageUrl ? `<img class="method-media" src="${resolveAssetUrl(step.imageUrl)}" alt="步骤图片" />` : ""}
          ${step.videoUrl ? `<video class="method-media" src="${resolveAssetUrl(step.videoUrl)}" controls></video>` : ""}
        </div>
      ` : ""}
      <label><span>注意事项</span><textarea name="stepNotes">${escapeHtml(step.notes ?? "")}</textarea></label>
    </article>
  `;
}

function renderMethodologyForm(methodology) {
  const steps = methodology.steps?.length ? methodology.steps : [{}];
  return `
    <form class="modal-form methodology-form">
      <div class="form-error" ${formError === "" ? "hidden" : ""}>${escapeHtml(formError)}</div>
      <label><span>关联流程节点</span><select name="processNodeId">${renderNodeOptions(methodology.processNodeId ?? "")}</select></label>
      <label><span>方法论标题</span><input name="title" value="${escapeHtml(methodology.title ?? "")}" /></label>
      <label><span>简介</span><textarea name="description">${escapeHtml(methodology.description ?? "")}</textarea></label>
      <div class="section-heading with-actions">
        <h3>步骤内容</h3>
        <button class="secondary-button" type="button" data-action="add-method-step">新增步骤</button>
      </div>
      <div class="method-step-editor-list">${steps.map(renderStepEditor).join("")}</div>
      <div class="modal-actions">
        <button class="secondary-button" type="button" data-action="cancel-methodology-edit">取消</button>
        <button class="primary-button" type="submit">保存方法论</button>
      </div>
    </form>
  `;
}

function getSelectedMethodology() {
  return getMethodologies().find((item) => item.id === selectedMethodologyId) ?? getFilteredMethodologies()[0] ?? getMethodologies()[0] ?? null;
}

function renderTextList(items) {
  return `<ul class="methodology-check-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderMediaPlaceholder(label) {
  return `
    <article class="methodology-media-placeholder">
      <strong>${escapeHtml(label)}</strong>
    </article>
  `;
}

function renderOperationalMethodology(methodology) {
  const node = getMethodologyNode(methodology);
  const flowName = methodology.flowName ?? findName(state.processTemplates, methodology.processTemplateId, "未关联流程");
  const nodeName = methodology.nodeName ?? node?.name ?? "未关联节点";
  const departmentName = methodology.departmentName ?? "未设置";
  const positions = methodology.positionNames?.join(" / ") ?? "未设置";
  const mediaTypes = methodology.mediaTypes?.join(" / ") ?? "文字";
  const completionStandards = methodology.completionStandards ?? [];
  const reviewStandards = methodology.reviewStandards ?? [];
  const commonMistakes = methodology.commonMistakes ?? [];

  return `
    <div class="detail-grid">
      <div class="detail-field"><span>适用流程</span><strong>${escapeHtml(flowName)}</strong></div>
      <div class="detail-field"><span>适用节点</span><strong>${escapeHtml(nodeName)}</strong></div>
      <div class="detail-field"><span>适用部门 / 岗位</span><strong>${escapeHtml(`${departmentName} / ${positions}`)}</strong></div>
      <div class="detail-field"><span>说明形式</span><strong>${escapeHtml(mediaTypes)}</strong></div>
      <div class="detail-field"><span>启用状态</span><strong>${escapeHtml(methodology.status ?? "启用")}</strong></div>
    </div>
    <section class="methodology-detail-section">
      <h3>操作步骤</h3>
      <div class="method-step-list">
        ${(methodology.steps ?? []).length === 0 ? `<div class="empty-note">暂未填写步骤内容</div>` : methodology.steps.map(renderStepPreview).join("")}
      </div>
    </section>
    <section class="methodology-detail-section">
      <h3>完成标准</h3>
      ${renderTextList(completionStandards)}
    </section>
    <section class="methodology-detail-section">
      <h3>审核标准</h3>
      ${renderTextList(reviewStandards)}
    </section>
    <section class="methodology-detail-section">
      <h3>常见错误</h3>
      ${renderTextList(commonMistakes)}
    </section>
  `;
}

function renderMethodologyDetail() {
  const selected = getSelectedMethodology();
  if (selected === null && !canCreate()) {
    return `<section class="settings-section"><div class="empty-note">暂无方法论</div></section>`;
  }
  const draft = selected ?? { id: "", title: "", steps: [] };
  if (editingId === draft.id || (selected === null && editingId === "new")) {
    return `
      <section class="settings-section methodology-detail">
        <div class="section-heading"><h2>${editingId === "new" ? "新增方法论" : "编辑方法论"}</h2></div>
        ${renderMethodologyForm(draft)}
      </section>
    `;
  }
  return `
    <section class="settings-section methodology-detail">
      <div class="section-heading with-actions">
        <div>
          <h2>${escapeHtml(selected.title)}</h2>
          <p class="form-note">绑定流程节点的操作说明书，用于指导员工完成具体节点任务。</p>
        </div>
        <div class="row-actions">
          <button class="secondary-button" type="button" data-action="back-to-methodology-list">返回列表</button>
          ${canEdit() && selected.id !== demoMethodology.id ? `<button class="primary-button" type="button" data-action="edit-methodology" data-methodology-id="${selected.id}">编辑方法论</button>` : ""}
        </div>
      </div>
      <div class="methodology-body">${renderOperationalMethodology(selected)}</div>
    </section>
  `;
}

function collectStepDrafts(form) {
  const titles = [...form.querySelectorAll("[name='stepTitle']")];
  return titles.map((input) => {
    const container = input.closest(".method-step-editor");
    return {
      id: createId("method-step"),
      title: input.value.trim(),
      instruction: container.querySelector("[name='stepInstruction']")?.value.trim() ?? "",
      imageUrl: container.querySelector("[name='stepImageUrl']")?.value ?? "",
      videoUrl: container.querySelector("[name='stepVideoUrl']")?.value ?? "",
      notes: container.querySelector("[name='stepNotes']")?.value.trim() ?? "",
    };
  });
}

async function uploadStepFiles(form, steps) {
  const containers = [...form.querySelectorAll(".method-step-editor")];
  for (const [index, container] of containers.entries()) {
    const imageFile = container.querySelector("[name='stepImageFile']")?.files?.[0] ?? null;
    const videoFile = container.querySelector("[name='stepVideoFile']")?.files?.[0] ?? null;
    if (imageFile !== null) steps[index].imageUrl = (await uploadImageFile(imageFile)).url;
    if (videoFile !== null) steps[index].videoUrl = (await uploadGenericFile(videoFile)).url;
  }
}

async function saveMethodology(form, rerender) {
  const nodeId = new FormData(form).get("processNodeId")?.toString() ?? "";
  const node = state.processTemplateNodes.find((item) => item.id === nodeId) ?? null;
  if (node === null) {
    formError = "请选择关联流程节点。";
    rerender();
    return;
  }
  const existing = editingId === "new" ? null : state.methodologies.find((item) => item.id === editingId) ?? null;
  const standardWork = getStandardWorkForTemplate(node.templateId);
  const now = getNow();
  const steps = collectStepDrafts(form);
  try {
    await uploadStepFiles(form, steps);
  } catch (error) {
    formError = error.message || "上传失败，请检查本地数据库服务。";
    rerender();
    return;
  }
  const rawTitle = new FormData(form).get("title")?.toString().replaceAll("+", "").trim();
  const draft = {
    id: existing?.id ?? createId("methodology"),
    title: rawTitle || getMethodologyTitleFromNode(node.name),
    processTemplateId: node.templateId,
    processNodeId: node.id,
    standardWorkId: standardWork?.id ?? "",
    taskTemplateId: standardWork?.id ?? "",
    description: new FormData(form).get("description")?.toString().trim() ?? "",
    steps,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  try {
    if (existing === null) {
      await createPersistentResource("methodologies", draft);
      state.methodologies = [draft, ...state.methodologies];
    } else {
      await updatePersistentResource("methodologies", existing.id, draft);
      state.methodologies = state.methodologies.map((item) => (item.id === existing.id ? draft : item));
    }
    selectedMethodologyId = draft.id;
    editingId = null;
    formError = "";
    window.location.hash = `methodology-${draft.id}`;
    rerender();
  } catch (error) {
    formError = error.message || "方法论保存失败，请检查本地数据库服务。";
    rerender();
  }
}

function mutateStepEditors(action, index, rerender) {
  const form = document.querySelector(".methodology-form");
  if (form === null) return;
  const selected = getSelectedMethodology() ?? { steps: [] };
  const steps = collectStepDrafts(form);
  if (action === "add") steps.push({});
  if (action === "remove" && steps.length > 1) steps.splice(index, 1);
  if (action === "up" && index > 0) [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
  if (action === "down" && index < steps.length - 1) [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]];
  const temp = { ...selected, steps };
  const list = form.querySelector(".method-step-editor-list");
  if (list !== null) list.innerHTML = temp.steps.map(renderStepEditor).join("");
}

export function bindMethodologiesPageEvents(rerender) {
  document.querySelector(".methodology-search")?.addEventListener("input", (event) => {
    keyword = event.target.form.keyword.value;
    rerender();
  });
  document.querySelector(".methodology-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveMethodology(event.target, rerender);
  });
  document.querySelector(".methodologies-page")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button === null) return;
    const action = button.dataset.action;
    if (action === "create-methodology" && canCreate()) {
      editingId = "new";
      formError = "";
      rerender();
    }
    if (action === "edit-methodology" && canEdit()) {
      editingId = button.dataset.methodologyId;
      formError = "";
      rerender();
    }
    if (action === "cancel-methodology-edit") {
      editingId = null;
      formError = "";
      rerender();
    }
    if (action === "back-to-methodology-list") {
      window.location.hash = "methods";
      rerender();
    }
    const index = Number(button.dataset.stepIndex);
    if (action === "add-method-step") mutateStepEditors("add", index, rerender);
    if (action === "remove-method-step") mutateStepEditors("remove", index, rerender);
    if (action === "move-method-step-up") mutateStepEditors("up", index, rerender);
    if (action === "move-method-step-down") mutateStepEditors("down", index, rerender);
  });
  document.querySelectorAll("[data-methodology-id]").forEach((row) => {
    row.addEventListener("click", () => {
      selectedMethodologyId = row.dataset.methodologyId;
      window.location.hash = `methodology-${selectedMethodologyId}`;
    });
  });
}

export function renderMethodologiesPage(currentUser = null) {
  activeUser = currentUser;
  syncSelectedFromHash();
  if (!hasPermission(currentUser, "methods.view")) {
    return `<div class="methodologies-page"><section class="placeholder"><h2>你没有权限访问方法论模块</h2></section></div>`;
  }
  return `
    <div class="methodologies-page">
      ${isDetailRoute() ? renderMethodologyDetail() : renderMethodologyList()}
    </div>
  `;
}
