import {
  createId,
  createPersistentResource,
  getNow,
  resolveAssetUrl,
  state,
  updatePersistentResource,
  uploadGenericFile,
  uploadImageFile,
} from "./appState.js?v=20260627-methods1";
import { hasPermission } from "./permissions.js?v=20260627-methods1";

let selectedMethodologyId = state.methodologies[0]?.id ?? null;
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
  if (state.methodologies.some((item) => item.id === id)) selectedMethodologyId = id;
}

function getFilteredMethodologies() {
  const text = keyword.trim().toLowerCase();
  return state.methodologies.filter((methodology) => {
    if (text === "") return true;
    const node = getMethodologyNode(methodology);
    const processTemplateName = findName(state.processTemplates, methodology.processTemplateId, "");
    const standardWorkName = findName(state.taskTemplates, methodology.standardWorkId ?? methodology.taskTemplateId, "");
    return [methodology.title, node?.name, processTemplateName, standardWorkName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text));
  });
}

function renderStepPreview(step, index) {
  const image = step.imageUrl ? `<img class="method-media" src="${resolveAssetUrl(step.imageUrl)}" alt="${escapeHtml(step.title || `步骤${index + 1}`)}" />` : "";
  const video = step.videoUrl ? `<video class="method-media" src="${resolveAssetUrl(step.videoUrl)}" controls></video>` : "";
  return `
    <article class="method-step">
      <div class="method-step-heading">
        <span class="status-pill">步骤${index + 1}</span>
        <h4>${escapeHtml(step.title || `第${index + 1}步`)}</h4>
      </div>
      <p>${escapeHtml(step.instruction || "暂无操作说明")}</p>
      ${image}
      ${video}
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
            <tr><th>方法论标题</th><th>关联流程</th><th>关联节点</th><th>更新时间</th><th>内容状态</th></tr>
          </thead>
          <tbody>
            ${items.length === 0 ? `<tr><td colspan="5">暂无方法论</td></tr>` : items
              .map((item) => {
                const node = getMethodologyNode(item);
                const filled = (item.steps ?? []).some((step) => step.instruction || step.imageUrl || step.videoUrl);
                return `
                  <tr class="${item.id === selectedMethodologyId ? "is-selected" : ""}" data-methodology-id="${item.id}">
                    <td><a href="#methodology-${item.id}">${escapeHtml(item.title)}</a></td>
                    <td>${escapeHtml(findName(state.processTemplates, item.processTemplateId, "未关联流程"))}</td>
                    <td>${escapeHtml(node?.name ?? "未关联节点")}</td>
                    <td>${item.updatedAt ?? "-"}</td>
                    <td>${filled ? "已填写" : "空内容"}</td>
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
  return state.methodologies.find((item) => item.id === selectedMethodologyId) ?? getFilteredMethodologies()[0] ?? state.methodologies[0] ?? null;
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
  const node = getMethodologyNode(selected);
  return `
    <section class="settings-section methodology-detail">
      <div class="section-heading with-actions">
        <div>
          <h2>${escapeHtml(selected.title)}</h2>
          <p class="form-note">${escapeHtml(selected.description || "暂无简介")}</p>
        </div>
        ${canEdit() ? `<button class="primary-button" type="button" data-action="edit-methodology" data-methodology-id="${selected.id}">编辑方法论</button>` : ""}
      </div>
      <div class="detail-grid">
        <div class="detail-field"><span>关联流程</span><strong>${escapeHtml(findName(state.processTemplates, selected.processTemplateId, "未关联流程"))}</strong></div>
        <div class="detail-field"><span>关联节点</span><strong>${escapeHtml(node?.name ?? "未关联节点")}</strong></div>
        <div class="detail-field"><span>关联标准工作</span><strong>${escapeHtml(findName(state.taskTemplates, selected.standardWorkId ?? selected.taskTemplateId, "未关联标准工作"))}</strong></div>
        <div class="detail-field"><span>更新时间</span><strong>${selected.updatedAt ?? "-"}</strong></div>
      </div>
      <div class="method-step-list">
        ${(selected.steps ?? []).length === 0 ? `<div class="empty-note">暂未填写步骤内容</div>` : selected.steps.map(renderStepPreview).join("")}
      </div>
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
      ${renderMethodologyList()}
      ${renderMethodologyDetail()}
    </div>
  `;
}
