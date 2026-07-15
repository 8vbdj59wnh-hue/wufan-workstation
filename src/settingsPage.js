import { createPersistentResource, getCurrentUser, resolveAssetUrl, state, updatePersistentResource, uploadGenericFile, validateCurrentSession } from "./appState.js?v=20260705-state-singleton1";
import {
  applyPermissionTemplate,
  dataScopeOptions,
  hasPermission,
  normalizePermissions,
  permissionCount,
  permissionGroups,
  permissionTemplates,
} from "./permissions.js?v=20260705-state-singleton1";
import {
  CategoryType,
  PersonRole,
  Status,
  categoryTypeNames,
  personRoleNames,
  statusNames,
} from "./data/modelOptions.js";

const companies = state.companies;
let departments = state.departments;
let positions = state.positions;
let people = state.people;
let categories = state.categories;
let stores = state.stores;
let issuesRequirements = state.issuesRequirements;
let standardWorkForms = state.standardWorkForms;
let modalState = null;
let activeOrganizationTab = "chart";
let permissionFilters = { keyword: "", departmentId: "", loginOnly: false };
let storeFilters = { keyword: "", platform: "", status: "" };
let issueFilters = { keyword: "", type: "", status: "", module: "" };
let selectedPermissionPersonId = null;
let permissionDraft = null;
let permissionSaveMessage = "";
let draggedDepartmentId = null;
let dragOverDepartmentId = null;
let draggedPersonId = null;
let activeFormDesignStandardWorkId = "";
let activeFormDesignFieldId = "";
let draggedFormFieldId = null;
let draggedFormComponentType = null;

function replaceDepartments(nextDepartments) {
  state.departments.splice(0, state.departments.length, ...nextDepartments);
  departments = state.departments;
}

function replacePositions(nextPositions) {
  state.positions.splice(0, state.positions.length, ...nextPositions);
  positions = state.positions;
}

function replacePeople(nextPeople) {
  state.people.splice(0, state.people.length, ...nextPeople);
  people = state.people;
}

function replaceCategories(nextCategories) {
  state.categories.splice(0, state.categories.length, ...nextCategories);
  categories = state.categories;
}

function replaceStores(nextStores) {
  state.stores.splice(0, state.stores.length, ...nextStores);
  stores = state.stores;
}

function replaceIssuesRequirements(nextItems) {
  state.issuesRequirements.splice(0, state.issuesRequirements.length, ...nextItems);
  issuesRequirements = state.issuesRequirements;
}

function replaceStandardWorkForms(nextForms) {
  state.standardWorkForms.splice(0, state.standardWorkForms.length, ...nextForms);
  standardWorkForms = state.standardWorkForms;
}

const settingsResourceByEntity = {
  department: "departments",
  position: "positions",
  person: "persons",
  category: "categories",
  store: "stores",
  issueRequirement: "issues-requirements",
  standardWorkForm: "standard-work-forms",
};

function upsertItem(items, item) {
  const exists = items.some((current) => current.id === item.id);
  return exists
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item];
}

function stripSensitivePersonFields(person) {
  const { password: _password, passwordHash: _passwordHash, ...safePerson } = person;
  return safePerson;
}

async function persistSettingsEntity(entity, item, mode = "edit") {
  const resource = settingsResourceByEntity[entity];
  if (resource === undefined) throw new Error("未知设置资源，无法保存。");
  return mode === "add"
    ? createPersistentResource(resource, item)
    : updatePersistentResource(resource, item.id, item);
}

function sortByOrder(left, right) {
  return left.sortOrder - right.sortOrder;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getNow() {
  return new Date().toISOString();
}

function findName(items, id, fallback) {
  return items.find((item) => item.id === id)?.name ?? fallback;
}

const issueRequirementTypes = [
  { value: "requirement", label: "需求" },
  { value: "issue", label: "问题" },
];

const issueRequirementStatuses = [
  { value: "pending", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "verifying", label: "待验证" },
  { value: "done", label: "已完成" },
];

const issueRequirementModules = [
  { value: "目标", label: "目标" },
  { value: "优先级", label: "优先级" },
  { value: "执行任务", label: "执行任务" },
  { value: "流程/标准化", label: "流程/标准化" },
  { value: "内容排期", label: "内容排期" },
  { value: "模板中心", label: "模板中心" },
  { value: "设置", label: "设置" },
  { value: "权限", label: "权限" },
  { value: "其他", label: "其他" },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getStatusName(status) {
  return statusNames[status] ?? status;
}

function renderStatus(status) {
  const modifier = status === Status.Inactive ? " is-inactive" : "";

  return `<span class="status-pill${modifier}">${getStatusName(status)}</span>`;
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function renderOptions(items, selectedId, emptyLabel) {
  const emptyOption =
    emptyLabel === undefined
      ? ""
      : `<option value="">${emptyLabel}</option>`;

  return `
    ${emptyOption}
    ${items
      .map(
        (item) => `
          <option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>
            ${item.name}
          </option>
        `,
      )
      .join("")}
  `;
}

function renderRoleOptions(selectedRole) {
  return Object.values(PersonRole)
    .map(
      (role) => `
        <option value="${role}" ${role === selectedRole ? "selected" : ""}>
          ${personRoleNames[role]}
        </option>
      `,
    )
    .join("");
}

function renderAuthRoleOptions(selectedRole) {
  return [
    { value: "admin", label: "管理员" },
    { value: "user", label: "普通用户" },
  ]
    .map(
      (role) => `
        <option value="${role.value}" ${role.value === selectedRole ? "selected" : ""}>
          ${role.label}
        </option>
      `,
    )
    .join("");
}

function renderAuthRoleName(role) {
  return role === "admin" ? "管理员" : "普通用户";
}

const storePlatformOptions = ["淘宝", "天猫", "小红书", "抖音", "拼多多", "私域", "其他"];

function renderStorePlatformOptions(selectedPlatform, emptyLabel = "全部平台") {
  return `
    <option value="">${emptyLabel}</option>
    ${storePlatformOptions
      .map((platform) => `<option value="${platform}" ${platform === selectedPlatform ? "selected" : ""}>${platform}</option>`)
      .join("")}
  `;
}

function canCurrentUser(permissionPath) {
  return hasPermission(getCurrentUser(), permissionPath);
}

function getPersonPermissions(person) {
  return normalizePermissions(person?.permissions, person?.authRole ?? "user");
}

function hasManageablePermissionAdmin(peopleList = people) {
  return peopleList.some((person) =>
    person.canLogin === true &&
    person.status === Status.Active &&
    getPersonPermissions(person).settings.managePermissions === true
  );
}

function getPermissionStatus(person) {
  if (!person.canLogin) return "不可登录";
  return getPersonPermissions(person).settings.managePermissions ? "权限管理员" : "已配置";
}

function renderCategoryTypeOptions(selectedType) {
  return Object.values(CategoryType)
    .map(
      (type) => `
        <option value="${type}" ${type === selectedType ? "selected" : ""}>
          ${categoryTypeNames[type]}
        </option>
      `,
    )
    .join("");
}

function renderActionButton(label, action, entity, id, variant = "") {
  return `
    <button
      class="text-button ${variant}"
      type="button"
      data-action="${action}"
      data-entity="${entity}"
      data-id="${id}"
    >
      ${label}
    </button>
  `;
}

function renderSimpleValueOptions(items, selectedValue, emptyLabel) {
  const emptyOption = emptyLabel === undefined ? "" : `<option value="">${emptyLabel}</option>`;
  return `${emptyOption}${items
    .map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selectedValue ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("")}`;
}

function getIssueRequirementTypeName(type) {
  return issueRequirementTypes.find((item) => item.value === type)?.label ?? type;
}

function getIssueRequirementStatusName(status) {
  return issueRequirementStatuses.find((item) => item.value === status)?.label ?? status;
}

function renderDetailField(label, value) {
  return `
    <div class="detail-item">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function getDepartmentParentId(department) {
  return department.parentDepartmentId ?? null;
}

function getDepartmentChildren(parentDepartmentId) {
  return departments
    .filter((department) => getDepartmentParentId(department) === parentDepartmentId)
    .sort(sortByOrder);
}

function getDepartmentPeople(departmentId) {
  return people
    .filter((person) => person.departmentId === departmentId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getUnassignedPeople() {
  return people
    .filter((person) => person.departmentId === null || person.departmentId === "")
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createsDepartmentCycle(departmentId, parentDepartmentId) {
  let currentParentId = parentDepartmentId;
  const visited = new Set();

  while (currentParentId !== null) {
    if (currentParentId === departmentId) return true;
    if (visited.has(currentParentId)) return true;
    visited.add(currentParentId);
    const parent = departments.find((department) => department.id === currentParentId);
    if (parent === undefined) return false;
    currentParentId = getDepartmentParentId(parent);
  }

  return false;
}

function getRootDepartments() {
  const departmentIds = new Set(departments.map((department) => department.id));
  return departments
    .filter((department) => {
      const parentDepartmentId = getDepartmentParentId(department);
      return parentDepartmentId === null || !departmentIds.has(parentDepartmentId);
    })
    .sort(sortByOrder);
}

function renderOrganizationTabs() {
  return `
    <div class="settings-tabs organization-subtabs" aria-label="组织架构页签">
      <button class="${activeOrganizationTab === "chart" ? "is-active" : ""}" type="button" data-organization-tab="chart">组织架构图</button>
      <button class="${activeOrganizationTab === "list" ? "is-active" : ""}" type="button" data-organization-tab="list">部门/人员列表</button>
    </div>
  `;
}

function renderOrganizationPersonCard(person, department = null) {
  const positionName = findName(positions, person.positionId, "未设置岗位");
  const isLeader = department?.leaderId === person.id;

  return `
    <button
      class="organization-person-card ${person.status === Status.Inactive ? "is-inactive" : ""}"
      type="button"
      draggable="true"
      data-person-drag-id="${person.id}"
      data-action="edit"
      data-entity="person"
      data-id="${person.id}"
    >
      <span class="organization-person-name">${escapeHtml(person.name)}</span>
      <span class="organization-person-meta">
        ${escapeHtml(positionName)}
        ${isLeader ? `<strong>部门负责人</strong>` : ""}
        ${person.status === Status.Inactive ? `<strong>停用</strong>` : ""}
      </span>
    </button>
  `;
}

function renderDepartmentPeopleCards(department) {
  const departmentPeople = getDepartmentPeople(department.id);

  if (departmentPeople.length === 0) {
    return `<div class="organization-person-empty">暂无员工</div>`;
  }

  return `
    <div class="organization-person-list">
      ${departmentPeople.map((person) => renderOrganizationPersonCard(person, department)).join("")}
    </div>
  `;
}

function renderDepartmentCard(department, visited = new Set()) {
  const leaderName =
    department.leaderId === null
      ? "未设置"
      : findName(people, department.leaderId, "未设置");
  const childDepartments = visited.has(department.id)
    ? []
    : getDepartmentChildren(department.id);
  const nextVisited = new Set([...visited, department.id]);
  const personCount = getDepartmentPeople(department.id).filter((person) => person.status === Status.Active).length;

  return `
    <div
      class="organization-map-card ${department.status === Status.Inactive ? "is-inactive" : ""}"
      draggable="true"
      data-department-drag-id="${department.id}"
      data-department-drop-id="${department.id}"
    >
      <div class="organization-map-card-inner">
        <div class="organization-map-card-title">
          <h4>${escapeHtml(department.name)}</h4>
          ${renderStatus(department.status)}
        </div>
        <p>负责人：${escapeHtml(leaderName)}</p>
        <p>人员：${personCount} 人 · 排序：${department.sortOrder}</p>
        ${canCurrentUser("settings.editOrg") ? `
          <div class="row-actions">
            ${renderActionButton("编辑", "edit", "department", department.id)}
            ${renderActionButton("停用", "deactivate", "department", department.id, "danger-button")}
          </div>
        ` : ""}
        ${renderDepartmentPeopleCards(department)}
      </div>
      ${
        childDepartments.length > 0
          ? `
              <div class="organization-map-children">
                ${childDepartments.map((child) => renderDepartmentCard(child, nextVisited)).join("")}
              </div>
            `
          : ""
      }
    </div>
  `;
}

function renderUnassignedPeopleSection() {
  const unassignedPeople = getUnassignedPeople();

  if (unassignedPeople.length === 0) return "";

  return `
    <section class="organization-unassigned">
      <h4>未分配人员</h4>
      <div class="organization-person-list">
        ${unassignedPeople.map((person) => renderOrganizationPersonCard(person)).join("")}
      </div>
    </section>
  `;
}

function renderOrganizationChart() {
  const company = companies[0];
  const rootDepartments = getRootDepartments();

  return `
    <div class="organization-chart">
      <h3>${escapeHtml(company.name)}</h3>
      <div class="organization-map-scroll">
        <div class="organization-map">
          ${
            rootDepartments.length === 0
              ? `<div class="empty-detail">暂无部门</div>`
              : rootDepartments.map((department) => renderDepartmentCard(department)).join("")
          }
        </div>
      </div>
      ${renderUnassignedPeopleSection()}
    </div>
  `;
}

function renderDepartmentPeopleSummary(department) {
  const departmentPeople = getDepartmentPeople(department.id);

  if (departmentPeople.length === 0) {
    return `<p class="department-people-empty">暂无人员</p>`;
  }

  return `
    <div class="department-people-tags">
      ${departmentPeople
        .map((person) => `<span>${escapeHtml(person.name)}</span>`)
        .join("")}
    </div>
  `;
}

function renderOrganizationList() {
  const company = companies[0];
  return `
    <div class="organization">
        <h3>${escapeHtml(company.name)}</h3>
        <div class="department-list">
          ${departments
            .slice()
            .sort(sortByOrder)
            .map((department) => {
              const leaderName =
                department.leaderId === null
                  ? "未设置"
                  : findName(people, department.leaderId, "未设置");
              const departmentPositions = positions
                .filter((position) => position.departmentId === department.id)
                .sort(sortByOrder);

              return `
                <article class="department-item">
                  <div class="department-header">
                    <div>
                      <h4>${escapeHtml(department.name)}</h4>
                      <p>负责人：${escapeHtml(leaderName)} · 上级部门：${escapeHtml(findName(departments, getDepartmentParentId(department), "无"))} · 排序：${department.sortOrder}</p>
                    </div>
                    <div class="row-actions">
                      ${renderStatus(department.status)}
                      ${canCurrentUser("settings.editOrg") ? renderActionButton("编辑", "edit", "department", department.id) : ""}
                      ${canCurrentUser("settings.editOrg") ? renderActionButton("停用", "deactivate", "department", department.id, "danger-button") : ""}
                    </div>
                  </div>
                  ${renderDepartmentPeopleSummary(department)}
                  <ul class="position-list">
                    ${departmentPositions
                      .map(
                        (position) => `
                          <li>
                            <span>${escapeHtml(position.name)} · 排序：${position.sortOrder}</span>
                            <span class="row-actions">
                              ${renderStatus(position.status)}
                              ${canCurrentUser("settings.editOrg") ? renderActionButton("编辑", "edit", "position", position.id) : ""}
                              ${canCurrentUser("settings.editOrg") ? renderActionButton("停用", "deactivate", "position", position.id, "danger-button") : ""}
                            </span>
                          </li>
                        `,
                      )
                      .join("")}
                  </ul>
                </article>
              `;
            })
            .join("")}
        </div>
      </div>
  `;
}

function renderOrganizationSection() {
  const content = activeOrganizationTab === "list" ? renderOrganizationList() : renderOrganizationChart();

  return `
    <section class="settings-section" id="organization">
      <div class="section-heading with-actions">
        <h2>组织架构</h2>
        ${canCurrentUser("settings.editOrg") ? `
          <div class="section-actions">
            <button class="primary-button" type="button" data-action="add" data-entity="department">新增部门</button>
            <button class="secondary-button" type="button" data-action="add" data-entity="position">新增岗位</button>
          </div>
        ` : ""}
      </div>
      <div class="organization-inner">
        ${renderOrganizationTabs()}
        ${content}
      </div>
    </section>
  `;
}

function renderPeopleSection() {
  return `
    <section class="settings-section" id="people">
      <div class="section-heading with-actions">
        <h2>人员管理</h2>
        ${canCurrentUser("settings.createPeople") ? `<button class="primary-button" type="button" data-action="add" data-entity="person">新增人员</button>` : ""}
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>人员账号</th>
              <th>登录账号</th>
              <th>登录权限</th>
              <th>所属部门</th>
              <th>岗位</th>
              <th>直属负责人</th>
              <th>系统角色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${people
              .map((person) => {
                const managerName =
                  person.directManagerId === null
                    ? "无"
                    : findName(people, person.directManagerId, "无");

                return `
                  <tr>
                    <td>${person.name}</td>
                    <td>${person.account}</td>
                    <td>${person.username ? escapeHtml(person.username) : "-"}</td>
                    <td>${person.canLogin ? renderAuthRoleName(person.authRole) : "不允许登录"}</td>
                    <td>${findName(departments, person.departmentId, "未设置")}</td>
                    <td>${findName(positions, person.positionId, "未设置")}</td>
                    <td>${managerName}</td>
                    <td>${personRoleNames[person.role]}</td>
                    <td>${renderStatus(person.status)}</td>
                    <td>
                      <span class="row-actions">
                        ${canCurrentUser("settings.editPeople") ? renderActionButton("编辑", "edit", "person", person.id) : ""}
                        ${canCurrentUser("settings.disablePeople") ? renderActionButton("停用", "deactivate", "person", person.id, "danger-button") : ""}
                      </span>
                    </td>
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

function renderCategoryTable(type) {
  const filteredCategories = categories
    .filter((category) => category.type === type)
    .sort(sortByOrder);

  return `
    <div class="category-group">
      <h3>${categoryTypeNames[type]}</h3>
      <div class="table-wrap">
        <table class="data-table compact-table">
          <thead>
            <tr>
              <th>分类名称</th>
              <th>排序</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${filteredCategories
              .map(
                (category) => `
                  <tr>
                    <td>${category.name}</td>
                    <td>${category.sortOrder}</td>
                    <td>${renderStatus(category.status)}</td>
                    <td>
                      <span class="row-actions">
                        ${renderActionButton("编辑", "edit", "category", category.id)}
                        ${renderActionButton("停用", "deactivate", "category", category.id, "danger-button")}
                      </span>
                    </td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCategorySection() {
  return `
    <section class="settings-section" id="categories">
      <div class="section-heading with-actions">
        <h2>分类设置</h2>
        <p class="form-note">分类体系已统一为 7 大价值链模块，不再新增自定义分类。</p>
      </div>
      <div class="category-layout">
        ${renderCategoryTable(CategoryType.Task)}
        ${renderCategoryTable(CategoryType.Process)}
      </div>
    </section>
  `;
}

function getFilteredStores() {
  const keyword = storeFilters.keyword.trim().toLowerCase();
  return stores
    .filter((store) => {
      if (storeFilters.platform !== "" && store.platform !== storeFilters.platform) return false;
      if (storeFilters.status !== "" && store.status !== storeFilters.status) return false;
      if (keyword === "") return true;
      return [store.name, store.platform, store.brand, store.type, store.remark]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function renderStoreSection() {
  return `
    <section class="settings-section" id="stores">
      <div class="section-heading with-actions">
        <h2>店铺管理</h2>
        ${canCurrentUser("settings.editStores") ? `<button class="primary-button" type="button" data-action="add" data-entity="store">新增店铺</button>` : ""}
      </div>
      <form class="task-filters store-filters" aria-label="店铺筛选">
        <label>
          <span>搜索店铺</span>
          <input name="storeKeyword" value="${escapeHtml(storeFilters.keyword)}" placeholder="店铺名称、品牌、备注" />
        </label>
        <label>
          <span>所属平台</span>
          <select name="storePlatform">${renderStorePlatformOptions(storeFilters.platform)}</select>
        </label>
        <label>
          <span>状态</span>
          <select name="storeStatus">
            <option value="">全部状态</option>
            <option value="${Status.Active}" ${storeFilters.status === Status.Active ? "selected" : ""}>启用</option>
            <option value="${Status.Inactive}" ${storeFilters.status === Status.Inactive ? "selected" : ""}>停用</option>
          </select>
        </label>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>店铺名称</th>
              <th>所属平台</th>
              <th>所属品牌</th>
              <th>店铺类型</th>
              <th>负责人</th>
              <th>状态</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              getFilteredStores().length === 0
                ? `<tr><td colspan="8">暂无店铺，请点击“新增店铺”维护。</td></tr>`
                : getFilteredStores()
                    .map(
                      (store) => `
                        <tr>
                          <td>${escapeHtml(store.name)}</td>
                          <td>${escapeHtml(store.platform || "-")}</td>
                          <td>${escapeHtml(store.brand || "-")}</td>
                          <td>${escapeHtml(store.type || "-")}</td>
                          <td>${findName(people, store.ownerId, "未设置")}</td>
                          <td>${renderStatus(store.status)}</td>
                          <td>${escapeHtml(store.remark || "-")}</td>
                          <td>
                            <span class="row-actions">
                              ${canCurrentUser("settings.editStores") ? renderActionButton("编辑", "edit", "store", store.id) : ""}
                              ${
                                canCurrentUser("settings.editStores") && store.status === Status.Active
                                  ? renderActionButton("停用", "deactivate", "store", store.id, "danger-button")
                                  : ""
                              }
                              ${
                                canCurrentUser("settings.editStores") && store.status === Status.Inactive
                                  ? renderActionButton("启用", "activate", "store", store.id)
                                  : ""
                              }
                            </span>
                          </td>
                        </tr>
                      `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function getFilteredIssuesRequirements() {
  const keyword = issueFilters.keyword.trim().toLowerCase();
  return [...issuesRequirements]
    .filter((item) => item.status !== "deleted")
    .filter((item) => {
      if (issueFilters.type !== "" && item.type !== issueFilters.type) return false;
      if (issueFilters.status !== "" && item.status !== issueFilters.status) return false;
      if (issueFilters.module !== "" && item.module !== issueFilters.module) return false;
      if (keyword === "") return true;
      return [item.title, item.module, item.description, findName(people, item.submitterId, "")]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    })
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

function renderIssueAttachmentList(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return `<span class="muted-action">无附件</span>`;
  return `
    <div class="issue-attachment-list">
      ${attachments.map((attachment) => {
        const url = resolveAssetUrl(attachment.url ?? attachment.filePath ?? "");
        return `
          <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
            ${escapeHtml(attachment.originalName ?? attachment.filename ?? "附件")}
          </a>
        `;
      }).join("")}
    </div>
  `;
}

function renderIssuesRequirementsSection() {
  const items = getFilteredIssuesRequirements();
  const canEdit = canCurrentUser("settings.editStandardWorkForms");
  return `
    <section class="settings-section" id="issues-requirements">
      <div class="section-heading with-actions">
        <div>
          <h2>需求与问题中心</h2>
          <p class="form-note">用于开发阶段收集系统问题和优化需求，形成闭环管理。</p>
        </div>
        ${canEdit ? `<button class="primary-button" type="button" data-action="add" data-entity="issueRequirement">新增需求/问题</button>` : ""}
      </div>
      <form class="task-filters issue-filters" aria-label="需求与问题筛选">
        <label><span>关键词</span><input name="issueKeyword" value="${escapeHtml(issueFilters.keyword)}" placeholder="标题、描述、提交人" /></label>
        <label><span>类型</span><select name="issueType">${renderSimpleValueOptions(issueRequirementTypes, issueFilters.type, "全部类型")}</select></label>
        <label><span>所属模块</span><select name="issueModule">${renderSimpleValueOptions(issueRequirementModules, issueFilters.module, "全部模块")}</select></label>
        <label><span>状态</span><select name="issueStatus">${renderSimpleValueOptions(issueRequirementStatuses, issueFilters.status, "全部状态")}</select></label>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>类型</th>
              <th>所属模块</th>
              <th>提交人</th>
              <th>状态</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              items.length === 0
                ? `<tr><td colspan="7">暂无需求或问题。</td></tr>`
                : items.map((item) => `
                    <tr>
                      <td>${escapeHtml(item.title)}</td>
                      <td>${escapeHtml(getIssueRequirementTypeName(item.type))}</td>
                      <td>${escapeHtml(item.module ?? "-")}</td>
                      <td>${escapeHtml(findName(people, item.submitterId, "未设置"))}</td>
                      <td>${escapeHtml(getIssueRequirementStatusName(item.status))}</td>
                      <td>${escapeHtml(item.createdAt ?? "-")}</td>
                      <td>
                        <span class="row-actions">
                          <button class="text-button" type="button" data-action="view-issue" data-id="${escapeHtml(item.id)}">查看</button>
                          ${canEdit ? `<button class="text-button" type="button" data-action="edit" data-entity="issueRequirement" data-id="${escapeHtml(item.id)}">编辑</button>` : ""}
                          ${canEdit && item.status !== "done" ? `<button class="text-button" type="button" data-action="complete-issue" data-id="${escapeHtml(item.id)}">完成</button>` : ""}
                          ${canEdit ? `<button class="text-button danger-link" type="button" data-action="delete-issue" data-id="${escapeHtml(item.id)}">删除</button>` : ""}
                        </span>
                      </td>
                    </tr>
                  `).join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function getFilteredPermissionPeople() {
  const keyword = permissionFilters.keyword.trim().toLowerCase();
  return people.filter((person) => {
    if (permissionFilters.loginOnly && !person.canLogin) return false;
    if (permissionFilters.departmentId !== "" && person.departmentId !== permissionFilters.departmentId) return false;
    if (keyword === "") return true;
    return [person.name, person.username, person.account]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });
}

function ensureSelectedPermissionPerson() {
  const visiblePeople = getFilteredPermissionPeople();
  if (selectedPermissionPersonId !== null && visiblePeople.some((person) => person.id === selectedPermissionPersonId)) return;
  selectedPermissionPersonId = visiblePeople[0]?.id ?? null;
  permissionDraft = null;
}

function getSelectedPermissionPerson() {
  ensureSelectedPermissionPerson();
  return people.find((person) => person.id === selectedPermissionPersonId) ?? null;
}

function getActivePermissionDraft(person) {
  if (person === null) return normalizePermissions(null, "user");
  if (permissionDraft === null || permissionDraft.personId !== person.id) {
    permissionDraft = {
      personId: person.id,
      permissions: getPersonPermissions(person),
    };
  }
  return permissionDraft.permissions;
}

function renderPermissionPeopleList() {
  const visiblePeople = getFilteredPermissionPeople();
  ensureSelectedPermissionPerson();

  if (visiblePeople.length === 0) return `<div class="empty-detail">没有匹配的人员。</div>`;

  return `
    <div class="permission-person-list">
      ${visiblePeople
        .map((person) => `
          <button
            class="permission-person-item ${person.id === selectedPermissionPersonId ? "is-active" : ""}"
            type="button"
            data-permission-person-id="${person.id}"
          >
            <strong>${escapeHtml(person.name)}</strong>
            <span>${escapeHtml(person.username || "未设置登录账号")} · ${findName(departments, person.departmentId, "未设置部门")}</span>
            <span>${person.canLogin ? "允许登录" : "不允许登录"} · ${getPermissionStatus(person)}</span>
          </button>
        `)
        .join("")}
    </div>
  `;
}

function renderPermissionGroup(group, permissions) {
  return `
    <details class="permission-card" open>
      <summary>${group.title}</summary>
      <div class="permission-check-grid">
        ${group.permissions
          .map((item) => `
            <label class="checkbox-line">
              <input
                type="checkbox"
                name="${group.key}.${item.key}"
                ${permissions[group.key]?.[item.key] ? "checked" : ""}
              />
              <span>${item.label}</span>
            </label>
          `)
          .join("")}
      </div>
    </details>
  `;
}

function renderPermissionEditor() {
  const person = getSelectedPermissionPerson();
  if (!canCurrentUser("settings.managePermissions")) {
    return `<div class="empty-detail">你没有权限管理权限。</div>`;
  }
  if (person === null) return `<div class="empty-detail">请选择一个人员。</div>`;

  const permissions = getActivePermissionDraft(person);
  return `
    <form class="permission-editor-form">
      <div class="permission-editor-heading">
        <div>
          <h3>${escapeHtml(person.name)}</h3>
          <p>${escapeHtml(person.username || "未设置登录账号")} · ${person.canLogin ? "允许登录" : "不允许登录"}</p>
        </div>
        <div class="section-actions">
          ${Object.entries(permissionTemplates)
            .map(([key, template]) => `<button class="secondary-button" type="button" data-permission-template="${key}">${template.label}</button>`)
            .join("")}
        </div>
      </div>
      <section class="permission-card data-scope-card">
        <h4>数据范围</h4>
        <div class="permission-radio-list">
          ${dataScopeOptions
            .map((option) => `
              <label class="checkbox-line">
                <input type="radio" name="dataScope" value="${option.value}" ${permissions.dataScope === option.value ? "checked" : ""} />
                <span>${option.label}</span>
              </label>
            `)
            .join("")}
        </div>
      </section>
      ${permissionGroups.map((group) => renderPermissionGroup(group, permissions)).join("")}
      <div class="permission-footer">
        <span>${permissionCount} 个权限项</span>
        <span class="form-error" ${permissionSaveMessage === "" ? "hidden" : ""}>${permissionSaveMessage}</span>
        <button class="primary-button" type="submit">保存权限</button>
      </div>
    </form>
  `;
}

function renderPermissionSection() {
  return `
    <section class="settings-section" id="permissions">
      <div class="section-heading with-actions">
        <h2>权限管理</h2>
      </div>
      <div class="permission-layout">
        <aside class="permission-sidebar">
          <div class="permission-filters">
            <input name="permissionKeyword" value="${escapeHtml(permissionFilters.keyword)}" placeholder="搜索姓名或账号" />
            <select name="permissionDepartmentId">
              ${renderOptions(departments, permissionFilters.departmentId, "全部部门")}
            </select>
            <label class="checkbox-line">
              <input name="permissionLoginOnly" type="checkbox" ${permissionFilters.loginOnly ? "checked" : ""} />
              <span>只看可登录账号</span>
            </label>
          </div>
          ${renderPermissionPeopleList()}
        </aside>
        <div class="permission-editor">
          ${renderPermissionEditor()}
        </div>
      </div>
    </section>
  `;
}

function getModalTitle() {
  if (modalState.mode === "view") return "查看需求/问题";
  if (modalState.mode === "complete") return "完成需求/问题";
  const actionName = modalState.mode === "add" ? "新增" : "编辑";
  const entityNames = {
    department: "部门",
    position: "岗位",
    person: "人员",
    category: "分类",
    store: "店铺",
    issueRequirement: "需求/问题",
  };

  return `${actionName}${entityNames[modalState.entity]}`;
}

function renderDepartmentForm() {
  const department =
    modalState.mode === "edit"
      ? departments.find((item) => item.id === modalState.id)
      : null;

  return `
    <label>
      <span>部门名称</span>
      <input name="name" value="${department?.name ?? ""}" autocomplete="off" />
    </label>
    <label>
      <span>部门负责人</span>
      <select name="leaderId">
        ${renderOptions(people, department?.leaderId ?? "", "未设置")}
      </select>
    </label>
    <label>
      <span>排序</span>
      <input name="sortOrder" value="${department?.sortOrder ?? departments.length + 1}" inputmode="numeric" />
    </label>
  `;
}

function renderPositionForm() {
  const position =
    modalState.mode === "edit"
      ? positions.find((item) => item.id === modalState.id)
      : null;

  return `
    <label>
      <span>岗位名称</span>
      <input name="name" value="${position?.name ?? ""}" autocomplete="off" />
    </label>
    <label>
      <span>所属部门</span>
      <select name="departmentId">
        ${renderOptions(departments, position?.departmentId ?? "", "请选择部门")}
      </select>
    </label>
    <label>
      <span>排序</span>
      <input name="sortOrder" value="${position?.sortOrder ?? positions.length + 1}" inputmode="numeric" />
    </label>
  `;
}

function renderPersonForm() {
  const person =
    modalState.mode === "edit"
      ? people.find((item) => item.id === modalState.id)
      : null;
  const canManageAccounts = canCurrentUser("settings.manageAccounts");

  return `
    <label>
      <span>姓名</span>
      <input name="name" value="${person?.name ?? ""}" autocomplete="off" />
    </label>
    <label>
      <span>人员账号</span>
      <input name="account" value="${person?.account ?? ""}" autocomplete="off" />
    </label>
    <label>
      <span>所属部门</span>
      <select name="departmentId">
        ${renderOptions(departments, person?.departmentId ?? "", "请选择部门")}
      </select>
    </label>
    <label>
      <span>岗位</span>
      <select name="positionId">
        ${renderOptions(positions, person?.positionId ?? "", "请选择岗位")}
      </select>
    </label>
    <label>
      <span>直属负责人</span>
      <select name="directManagerId">
        ${renderOptions(
          people.filter((item) => item.id !== person?.id),
          person?.directManagerId ?? "",
          "无",
        )}
      </select>
    </label>
    <label>
      <span>系统角色</span>
      <select name="role">
        <option value="">请选择角色</option>
        ${renderRoleOptions(person?.role ?? "")}
      </select>
    </label>
    ${
      canManageAccounts
        ? `
          <div class="form-subsection">
            <h3>账号登录设置</h3>
            <label class="checkbox-label">
              <input name="canLogin" type="checkbox" ${person?.canLogin ? "checked" : ""} />
              <span>允许登录</span>
            </label>
            <label>
              <span>登录账号</span>
              <input name="username" value="${escapeHtml(person?.username ?? "")}" autocomplete="username" />
            </label>
            <label>
              <span>设置新密码</span>
              <input name="password" type="password" autocomplete="new-password" placeholder="${modalState.mode === "edit" ? "留空则不修改密码" : ""}" />
            </label>
            <label>
              <span>登录角色</span>
              <select name="authRole">
                ${renderAuthRoleOptions(person?.authRole ?? "user")}
              </select>
            </label>
          </div>
        `
        : ""
    }
  `;
}

function renderCategoryForm() {
  const category =
    modalState.mode === "edit"
      ? categories.find((item) => item.id === modalState.id)
      : null;

  return `
    <label>
      <span>分类名称</span>
      <input name="name" value="${category?.name ?? ""}" autocomplete="off" />
    </label>
    <label>
      <span>分类类型</span>
      <select name="type" ${modalState.mode === "edit" ? "disabled" : ""}>
        <option value="">请选择分类类型</option>
        ${renderCategoryTypeOptions(category?.type ?? "")}
      </select>
    </label>
    <label>
      <span>排序</span>
      <input name="sortOrder" value="${category?.sortOrder ?? categories.length + 1}" inputmode="numeric" />
    </label>
  `;
}

function renderStoreForm() {
  const store =
    modalState.mode === "edit"
      ? stores.find((item) => item.id === modalState.id)
      : null;

  return `
    <label>
      <span>店铺名称</span>
      <input name="name" value="${escapeHtml(store?.name ?? "")}" autocomplete="off" />
    </label>
    <label>
      <span>所属平台</span>
      <select name="platform">
        ${renderStorePlatformOptions(store?.platform ?? "", "请选择平台")}
      </select>
    </label>
    <label>
      <span>所属品牌</span>
      <input name="brand" value="${escapeHtml(store?.brand ?? "")}" autocomplete="off" />
    </label>
    <label>
      <span>店铺类型</span>
      <input name="type" value="${escapeHtml(store?.type ?? "")}" autocomplete="off" />
    </label>
    <label>
      <span>负责人</span>
      <select name="ownerId">
        ${renderOptions(people, store?.ownerId ?? "", "未设置")}
      </select>
    </label>
    <label>
      <span>备注</span>
      <textarea name="remark" rows="3">${escapeHtml(store?.remark ?? "")}</textarea>
    </label>
    <label>
      <span>状态</span>
      <select name="status">
        <option value="${Status.Active}" ${store?.status !== Status.Inactive ? "selected" : ""}>启用</option>
        <option value="${Status.Inactive}" ${store?.status === Status.Inactive ? "selected" : ""}>停用</option>
      </select>
    </label>
  `;
}

const formDesignerFieldTypes = [
  ["text", "文本"],
  ["textarea", "多行文本"],
  ["number", "数字"],
  ["date", "日期"],
  ["datetime_hour", "截止时间"],
  ["person", "人员选择"],
  ["image", "图片上传"],
  ["file", "文件上传"],
  ["table", "表格"],
  ["select", "下拉选择"],
  ["multi_select", "多选"],
];

const formDesignerFieldTypeMeta = Object.freeze({
  text: { label: "文本", width: 6 },
  textarea: { label: "多行文本", width: 12 },
  number: { label: "数字", width: 4 },
  date: { label: "日期", width: 6 },
  datetime_hour: { label: "截止时间", width: 6 },
  person: { label: "人员", width: 6 },
  image: { label: "图片", width: 12 },
  file: { label: "附件", width: 12 },
  table: { label: "表格", width: 12 },
  select: { label: "下拉", width: 6 },
  multi_select: { label: "多选", width: 6 },
});

function getDefaultFieldWidth(type) {
  return formDesignerFieldTypeMeta[type]?.width ?? 6;
}

function resolveFormDesignerFieldType(typeOrLabel) {
  const value = String(typeOrLabel ?? "").trim();
  if (formDesignerFieldTypeMeta[value] !== undefined) return value;
  return formDesignerFieldTypes.find(([type, label]) => type === value || label === value)?.[0] ?? "text";
}

function getFormDesignerFieldTypeLabel(type) {
  const normalizedType = resolveFormDesignerFieldType(type);
  return formDesignerFieldTypeMeta[normalizedType]?.label
    ?? formDesignerFieldTypes.find(([fieldType]) => fieldType === normalizedType)?.[1]
    ?? "新字段";
}

function isBlankFormDesignerLabel(label) {
  const value = String(label ?? "").trim();
  return value === "" || value === "undefined" || value === "null";
}

function normalizeFieldWidth(field) {
  const width = Number(field.width ?? field.gridSpan);
  return [4, 6, 12].includes(width) ? width : getDefaultFieldWidth(field.type);
}

function getValueChainCategories() {
  const valueChainNames = ["基础设施维护", "人力资产管理", "产品开发与淘汰", "供应链管理", "品牌营销", "渠道销售", "客户维护"];
  return valueChainNames
    .map((name) => categories.find((category) => category.type === CategoryType.Task && category.name === name))
    .filter(Boolean);
}

function getStandardWorksForFormDesign() {
  return [...state.taskTemplates]
    .filter((template) => template.status !== Status.Inactive)
    .sort((left, right) => {
      const leftCategory = categories.find((category) => category.id === left.categoryId)?.sortOrder ?? 999;
      const rightCategory = categories.find((category) => category.id === right.categoryId)?.sortOrder ?? 999;
      if (leftCategory !== rightCategory) return leftCategory - rightCategory;
      return String(left.name ?? "").localeCompare(String(right.name ?? ""), "zh-Hans-CN");
    });
}

function getSelectedFormDesignStandardWork() {
  const standardWorks = getStandardWorksForFormDesign();
  if (standardWorks.length === 0) return null;
  if (activeFormDesignStandardWorkId === "" || !standardWorks.some((item) => item.id === activeFormDesignStandardWorkId)) {
    activeFormDesignStandardWorkId = standardWorks[0].id;
  }
  return standardWorks.find((item) => item.id === activeFormDesignStandardWorkId) ?? standardWorks[0];
}

function findStandardWorkForm(standardWorkId) {
  return standardWorkForms.find((form) => form.standardWorkId === standardWorkId) ?? null;
}

function normalizeFormDesignerFields(fields = []) {
  return [...fields]
    .map((field, index) => {
      const type = resolveFormDesignerFieldType(field.type);
      return {
        fieldId: field.fieldId || field.id || createId("form-field"),
        label: isBlankFormDesignerLabel(field.label) ? getFormDesignerFieldTypeLabel(type) : field.label,
        type,
        required: field.required === true,
        order: Number.isFinite(Number(field.order ?? field.sortOrder)) ? Number(field.order ?? field.sortOrder) : index + 1,
        defaultValue: field.defaultValue ?? "",
        placeholder: field.placeholder ?? "",
        width: normalizeFieldWidth({ ...field, type }),
        options: Array.isArray(field.options) ? field.options : [],
      };
    })
    .sort((left, right) => left.order - right.order)
    .map((field, index) => ({ ...field, order: index + 1 }));
}

function getFormDesignDraftFields() {
  const standardWork = getSelectedFormDesignStandardWork();
  if (standardWork === null) return [];
  const form = findStandardWorkForm(standardWork.id);
  return normalizeFormDesignerFields(form?.formSchema?.fields ?? standardWork.formFields ?? []);
}

function renderFormFieldTypeOptions(selectedType) {
  return formDesignerFieldTypes
    .map(([value, label]) => `<option value="${value}" ${selectedType === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderUnifiedFormControl(field, mode, value = "") {
  const readonly = mode === "readonly";
  const preview = mode === "design";
  const disabled = readonly || preview ? "disabled" : "";
  const placeholder = escapeHtml(field.placeholder ?? "");
  const currentValue = value || field.defaultValue || "";
  if (field.type === "textarea") return `<textarea placeholder="${placeholder}" ${disabled}>${escapeHtml(currentValue)}</textarea>`;
  if (field.type === "number") return `<input type="number" value="${escapeHtml(currentValue)}" placeholder="${placeholder}" ${disabled} />`;
  if (field.type === "date") return `<input type="date" value="${escapeHtml(currentValue)}" ${disabled} />`;
  if (field.type === "datetime_hour") return `<div class="form-renderer-datetime"><input type="date" ${disabled} /><select ${disabled}>${Array.from({ length: 24 }, (_, hour) => {
    const value = `${String(hour).padStart(2, "0")}:00`;
    return `<option value="${value}">${value}</option>`;
  }).join("")}</select></div>`;
  if (field.type === "person") return `<select ${disabled}>${renderOptions(people, currentValue, "请选择人员")}</select>`;
  if (field.type === "select") {
    return `<select ${disabled}><option value="">请选择</option>${field.options.map((option) => `<option value="${escapeHtml(option)}" ${option === currentValue ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  }
  if (field.type === "multi_select") {
    const values = Array.isArray(value) ? value : String(currentValue).split(",").map((item) => item.trim()).filter(Boolean);
    return `<div class="form-renderer-choice-list">${field.options.map((option) => `<label><input type="checkbox" ${values.includes(option) ? "checked" : ""} ${disabled} /> <span>${escapeHtml(option)}</span></label>`).join("") || `<span class="form-note">请在右侧配置选项</span>`}</div>`;
  }
  if (field.type === "image") {
    return readonly && currentValue
      ? `<img class="form-renderer-image-preview" src="${escapeHtml(resolveAssetUrl(currentValue))}" alt="${escapeHtml(field.label)}" />`
      : `<input type="file" accept="image/*" ${disabled} />`;
  }
  if (field.type === "file") {
    return readonly && currentValue
      ? `<a href="${escapeHtml(resolveAssetUrl(currentValue))}" target="_blank" rel="noreferrer">查看附件</a>`
      : `<input type="file" ${disabled} />`;
  }
  if (field.type === "table") return `<div class="form-renderer-table-placeholder">表格字段</div>`;
  return `<input type="text" value="${escapeHtml(currentValue)}" placeholder="${placeholder}" ${disabled} />`;
}

function renderUnifiedFormRenderer(fields, { mode = "design", values = {} } = {}) {
  const normalizedFields = normalizeFormDesignerFields(fields);
  if (normalizedFields.length === 0) return `<div class="empty-detail form-renderer-empty">从左侧字段组件库拖入字段，开始搭建表单。</div>`;
  return `
    <div class="form-renderer form-renderer-${mode}">
      ${normalizedFields.map((field) => `
        <div
          class="form-renderer-field is-width-${field.width} ${mode === "design" && field.fieldId === activeFormDesignFieldId ? "is-selected" : ""}"
          data-form-field-id="${escapeHtml(field.fieldId)}"
          draggable="${mode === "design" ? "true" : "false"}"
        >
          ${
            mode === "design"
              ? `<div class="form-renderer-field-actions">
                  <button class="text-button" type="button" data-action="select-form-field" data-field-id="${escapeHtml(field.fieldId)}">编辑</button>
                  <button class="text-button" type="button" data-action="copy-form-field" data-field-id="${escapeHtml(field.fieldId)}">复制</button>
                  <button class="text-button" type="button" data-action="move-form-field-up" data-field-id="${escapeHtml(field.fieldId)}">上移</button>
                  <button class="text-button" type="button" data-action="move-form-field-down" data-field-id="${escapeHtml(field.fieldId)}">下移</button>
                  <button class="text-button danger-link" type="button" data-action="remove-form-field" data-field-id="${escapeHtml(field.fieldId)}">删除</button>
                </div>`
              : ""
          }
          <label>
            <span>${escapeHtml(field.label || "未命名字段")}${field.required ? `<em>*</em>` : ""}</span>
            ${renderUnifiedFormControl(field, mode, values[field.fieldId] ?? values[field.key] ?? "")}
          </label>
        </div>
      `).join("")}
    </div>
  `;
}

function renderFormDesignStandardWorkOptions() {
  const standardWorks = getStandardWorksForFormDesign();
  const grouped = getValueChainCategories().map((category) => ({
    category,
    works: standardWorks.filter((work) => work.categoryId === category.id),
  }));
  const uncategorized = standardWorks.filter((work) => !grouped.some((group) => group.works.some((item) => item.id === work.id)));
  const groups = uncategorized.length > 0 ? [...grouped, { category: { id: "uncategorized", name: "未分类" }, works: uncategorized }] : grouped;
  return groups.map(({ category, works }) => `
    <optgroup label="${escapeHtml(category.name)}">
      ${works.map((work) => `<option value="${escapeHtml(work.id)}" ${work.id === activeFormDesignStandardWorkId ? "selected" : ""}>${escapeHtml(work.name)}</option>`).join("")}
    </optgroup>
  `).join("");
}

function renderFormComponentLibrary() {
  return `
    <div class="form-component-library" aria-label="字段组件库">
      <h3>字段组件</h3>
      <div class="form-component-card-list">
        ${formDesignerFieldTypes.map(([type, label]) => `
          <button class="form-component-card" type="button" draggable="true" data-action="add-form-field-type" data-component-type="${escapeHtml(type)}">
            <span>${escapeHtml(label)}</span>
            <em>${getDefaultFieldWidth(type) === 12 ? "单排" : getDefaultFieldWidth(type) === 6 ? "双排" : "三排"}</em>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderFormDesignEditor() {
  const standardWork = getSelectedFormDesignStandardWork();
  if (standardWork === null) return `<div class="empty-detail">暂无标准工作，请先维护标准工作库。</div>`;
  const fields = getFormDesignRenderFields();
  const selectedField = fields.find((field) => field.fieldId === activeFormDesignFieldId) ?? fields[0] ?? null;
  if (selectedField !== null && activeFormDesignFieldId === "") activeFormDesignFieldId = selectedField.fieldId;
  return `
    <form class="form-designer-editor" data-standard-work-id="${escapeHtml(standardWork.id)}">
      <div class="form-designer-context">
        <div>
          <h3>${escapeHtml(standardWork.name)}</h3>
          <p class="form-note">${escapeHtml(categories.find((category) => category.id === standardWork.categoryId)?.name ?? "未分类")}</p>
        </div>
        <label class="form-designer-work-select">
          <span>标准工作</span>
          <select name="formDesignStandardWorkId">${renderFormDesignStandardWorkOptions()}</select>
        </label>
      </div>
      <div class="form-designer-workspace">
        ${renderFormComponentLibrary()}
        <div class="form-designer-preview">
          ${renderUnifiedFormRenderer(fields, { mode: "design" })}
        </div>
        <aside class="form-designer-property-panel">
          ${renderFormDesignPropertyPanel(selectedField)}
        </aside>
      </div>
      <div class="modal-actions">
        <button class="primary-button" type="submit">保存表单结构</button>
      </div>
    </form>
  `;
}

function renderFormDesignPropertyPanel(field) {
  if (field === null) {
    return `
      <h3>字段属性</h3>
      <p class="form-note">请选择字段，或点击“添加字段”。</p>
    `;
  }
  return `
    <h3>字段属性</h3>
    <input type="hidden" name="activeFieldId" value="${escapeHtml(field.fieldId)}" />
    <label><span>字段名称</span><input name="propertyLabel" value="${escapeHtml(field.label)}" autocomplete="off" /></label>
    <label><span>字段类型</span><select name="propertyType">${renderFormFieldTypeOptions(field.type)}</select></label>
    <label><span>是否必填</span><select name="propertyRequired"><option value="false" ${field.required ? "" : "selected"}>否</option><option value="true" ${field.required ? "selected" : ""}>是</option></select></label>
    <label><span>默认值</span><input name="propertyDefaultValue" value="${escapeHtml(field.defaultValue ?? "")}" autocomplete="off" /></label>
    <label><span>提示文字</span><input name="propertyPlaceholder" value="${escapeHtml(field.placeholder ?? "")}" autocomplete="off" /></label>
    <label><span>字段宽度</span><select name="propertyWidth"><option value="12" ${field.width === 12 ? "selected" : ""}>单排（12）</option><option value="6" ${field.width === 6 ? "selected" : ""}>双排（6）</option><option value="4" ${field.width === 4 ? "selected" : ""}>三排（4）</option></select></label>
    <label><span>选项内容</span><textarea name="propertyOptions" rows="5" placeholder="下拉、多选使用，每行或逗号分隔">${escapeHtml((field.options ?? []).join("\n"))}</textarea></label>
  `;
}

function renderFormDesignSection() {
  return `
    <section class="settings-section" id="form-design">
      <div class="section-heading">
        <div>
          <h2>表单设计</h2>
          <p class="form-note">为每一个标准工作维护独立执行表单，后续执行任务可逐步接入。</p>
        </div>
      </div>
      <div class="form-designer-layout">
        <div class="form-designer-panel">
          ${renderFormDesignEditor()}
        </div>
      </div>
    </section>
  `;
}

function getEditingIssueRequirement() {
  return issuesRequirements.find((item) => item.id === modalState?.id) ?? null;
}

function renderIssueAttachmentUpload(currentAttachments = []) {
  return `
    <div class="issue-attachment-upload">
      <label>
        <span>附件</span>
        <input name="issueAttachments" type="file" multiple />
      </label>
      <div class="selected-attachment-list">
        ${renderIssueAttachmentList(currentAttachments)}
      </div>
    </div>
  `;
}

function renderIssueRequirementForm() {
  const item = getEditingIssueRequirement();
  const isView = modalState.mode === "view";
  const isComplete = modalState.mode === "complete";
  const attachments = modalState.attachments ?? item?.attachments ?? [];

  if (isView) {
    return `
      <div class="detail-grid">
        ${renderDetailField("标题", escapeHtml(item?.title ?? ""))}
        ${renderDetailField("类型", escapeHtml(getIssueRequirementTypeName(item?.type ?? "")))}
        ${renderDetailField("所属模块", escapeHtml(item?.module ?? "-"))}
        ${renderDetailField("提交人", escapeHtml(findName(people, item?.submitterId, "未设置")))}
        ${renderDetailField("状态", escapeHtml(getIssueRequirementStatusName(item?.status ?? "")))}
        ${renderDetailField("创建时间", escapeHtml(item?.createdAt ?? "-"))}
      </div>
      <div class="detail-block"><h3>描述</h3><p>${escapeHtml(item?.description ?? "无")}</p></div>
      <div class="detail-block"><h3>附件</h3>${renderIssueAttachmentList(item?.attachments ?? [])}</div>
      <div class="detail-block"><h3>处理方案</h3><p>${escapeHtml(item?.solution ?? "未填写")}</p></div>
    `;
  }

  if (isComplete) {
    return `
      <div class="detail-block"><h3>${escapeHtml(item?.title ?? "")}</h3><p>${escapeHtml(item?.description ?? "")}</p></div>
      <label><span>解决方案</span><textarea name="solution" rows="5">${escapeHtml(item?.solution ?? "")}</textarea></label>
      <label><span>完成人</span><select name="completedBy">${renderOptions(people, item?.completedBy ?? getCurrentUser()?.id ?? "", "请选择完成人")}</select></label>
    `;
  }

  return `
    <label><span>标题</span><input name="title" value="${escapeHtml(item?.title ?? "")}" autocomplete="off" /></label>
    <label><span>类型</span><select name="type">${renderSimpleValueOptions(issueRequirementTypes, item?.type ?? "requirement")}</select></label>
    <label><span>所属模块</span><select name="module">${renderSimpleValueOptions(issueRequirementModules, item?.module ?? "", "请选择模块")}</select></label>
    <label><span>提交人</span><select name="submitterId">${renderOptions(people, item?.submitterId ?? getCurrentUser()?.id ?? "", "请选择提交人")}</select></label>
    <label><span>状态</span><select name="status">${renderSimpleValueOptions(issueRequirementStatuses, item?.status ?? "pending")}</select></label>
    <label><span>描述</span><textarea name="description" rows="5">${escapeHtml(item?.description ?? "")}</textarea></label>
    ${renderIssueAttachmentUpload(attachments)}
  `;
}

function renderModalFields() {
  if (modalState.entity === "department") return renderDepartmentForm();
  if (modalState.entity === "position") return renderPositionForm();
  if (modalState.entity === "person") return renderPersonForm();
  if (modalState.entity === "category") return renderCategoryForm();
  if (modalState.entity === "store") return renderStoreForm();
  if (modalState.entity === "issueRequirement") return renderIssueRequirementForm();

  return "";
}

function renderModal() {
  if (modalState === null || modalState.kind === "formDesignerDraft") return "";
  const isReadonly = modalState.mode === "view";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="${getModalTitle()}">
        <div class="modal-header">
          <h2>${getModalTitle()}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-modal">取消</button>
            ${isReadonly ? "" : `<button class="primary-button" type="button" data-action="submit-modal-form">保存</button>`}
            <button class="icon-button" type="button" data-action="close-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form" data-form-entity="${modalState.entity}">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          ${renderModalFields()}
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-modal">取消</button>
            ${isReadonly ? "" : `<button class="primary-button" type="submit">保存</button>`}
          </div>
        </form>
      </div>
    </div>
  `;
}

function parseSortOrder(value) {
  if (value === "") return 0;
  const sortOrder = Number(value);

  return Number.isFinite(sortOrder) ? sortOrder : null;
}

function setModalError(error) {
  modalState = { ...modalState, error };
  const errorElement = document.querySelector(".modal-form .form-error");
  if (errorElement !== null) {
    errorElement.textContent = error;
    errorElement.hidden = error === "";
  }
}

async function saveDepartment(form, rerender) {
  const name = getFormValue(form, "name");
  const leaderId = getFormValue(form, "leaderId") || null;
  const sortOrder = parseSortOrder(getFormValue(form, "sortOrder"));

  if (sortOrder === null) return setModalError("排序必须是数字。", rerender);

  const now = getNow();
  const item =
    modalState.mode === "add"
      ? {
          id: createId("dept"),
          companyId: companies[0].id,
          name,
          leaderId,
          parentDepartmentId: null,
          sortOrder,
          status: Status.Active,
          createdAt: now,
          updatedAt: now,
        }
      : {
          ...(departments.find((department) => department.id === modalState.id) ?? {}),
          id: modalState.id,
          name,
          leaderId,
          sortOrder,
          updatedAt: now,
        };

  try {
    const savedDepartment = await persistSettingsEntity("department", item, modalState.mode);
    replaceDepartments(upsertItem(departments, savedDepartment));
    modalState = null;
    rerender();
  } catch (error) {
    setModalError(error.message || "部门保存失败，请检查本地数据库服务。", rerender);
  }
}

async function savePosition(form, rerender) {
  const name = getFormValue(form, "name");
  const departmentId = getFormValue(form, "departmentId");
  const sortOrder = parseSortOrder(getFormValue(form, "sortOrder"));

  if (sortOrder === null) return setModalError("排序必须是数字。", rerender);

  const now = getNow();
  const item =
    modalState.mode === "add"
      ? {
          id: createId("pos"),
          departmentId,
          name,
          sortOrder,
          status: Status.Active,
          createdAt: now,
          updatedAt: now,
        }
      : {
          ...(positions.find((position) => position.id === modalState.id) ?? {}),
          id: modalState.id,
          departmentId,
          name,
          sortOrder,
          updatedAt: now,
        };

  try {
    const savedPosition = await persistSettingsEntity("position", item, modalState.mode);
    replacePositions(upsertItem(positions, savedPosition));
    modalState = null;
    rerender();
  } catch (error) {
    setModalError(error.message || "岗位保存失败，请检查本地数据库服务。", rerender);
  }
}

async function savePerson(form, rerender) {
  const name = getFormValue(form, "name");
  const account = getFormValue(form, "account");
  const departmentId = getFormValue(form, "departmentId");
  const positionId = getFormValue(form, "positionId");
  const directManagerId = getFormValue(form, "directManagerId") || null;
  const role = getFormValue(form, "role");
  const editingPerson = modalState.mode === "edit" ? people.find((person) => person.id === modalState.id) : null;
  const canManageAccounts = canCurrentUser("settings.manageAccounts");
  const username = canManageAccounts ? getFormValue(form, "username") : editingPerson?.username ?? "";
  const password = canManageAccounts ? getFormValue(form, "password") : "";
  const canLogin = canManageAccounts ? new FormData(form).has("canLogin") : editingPerson?.canLogin ?? false;
  const authRole = canManageAccounts ? getFormValue(form, "authRole") || "user" : editingPerson?.authRole ?? "user";
  const duplicatedAccount = people.some(
    (person) => person.account === account && person.id !== modalState.id,
  );
  const duplicatedUsername = username !== "" && people.some(
    (person) => person.username === username && person.id !== modalState.id,
  );

  if (account !== "" && duplicatedAccount) return setModalError("人员账号不能和已有人员重复。", rerender);
  if (duplicatedUsername) return setModalError("登录账号不能和已有人员重复。", rerender);
  if (canLogin && username === "") return setModalError("允许登录时必须填写登录账号。", rerender);
  if (canLogin && modalState.mode === "add" && password === "") return setModalError("新增可登录人员必须设置密码。", rerender);
  if (canLogin && editingPerson?.canLogin !== true && password === "") return setModalError("启用登录时必须设置新密码。", rerender);

  const now = getNow();
  const item =
    modalState.mode === "add"
      ? {
          id: createId("person"),
          name,
          account,
          departmentId,
          positionId,
          directManagerId,
          role,
          username,
          canLogin,
          authRole,
          lastLoginAt: null,
          mustChangePassword: false,
          status: Status.Active,
          createdAt: now,
          updatedAt: now,
          ...(password === "" ? {} : { password }),
        }
      : {
          ...(editingPerson ?? {}),
          id: modalState.id,
          name,
          account,
          departmentId,
          positionId,
          directManagerId,
          role,
          username,
          canLogin,
          authRole,
          ...(password === "" ? {} : { password }),
          mustChangePassword: password === "" ? editingPerson?.mustChangePassword ?? false : false,
          updatedAt: now,
        };

  const safeDraft = stripSensitivePersonFields(item);
  const nextPeople = upsertItem(people, safeDraft);
  if (!hasManageablePermissionAdmin(nextPeople)) {
    return setModalError("系统至少需要保留一个权限管理员。", rerender);
  }

  try {
    const savedPerson = await persistSettingsEntity("person", item, modalState.mode);
    replacePeople(upsertItem(people, stripSensitivePersonFields(savedPerson)));
    modalState = null;
    rerender();
  } catch (error) {
    setModalError(error.message || "账号保存失败，请检查本地数据库服务。", rerender);
  }
}

async function saveCategory(form, rerender) {
  const category = categories.find((item) => item.id === modalState.id);
  const name = getFormValue(form, "name");
  const type =
    modalState.mode === "edit" && category !== undefined
      ? category.type
      : getFormValue(form, "type");
  const sortOrder = parseSortOrder(getFormValue(form, "sortOrder"));

  if (sortOrder === null) return setModalError("排序必须是数字。", rerender);

  const now = getNow();
  const item =
    modalState.mode === "add"
      ? {
          id: createId("cat"),
          type,
          name,
          sortOrder,
          status: Status.Active,
          createdAt: now,
          updatedAt: now,
        }
      : {
          ...(category ?? {}),
          id: modalState.id,
          name,
          sortOrder,
          updatedAt: now,
        };

  try {
    const savedCategory = await persistSettingsEntity("category", item, modalState.mode);
    replaceCategories(upsertItem(categories, savedCategory));
    modalState = null;
    rerender();
  } catch (error) {
    setModalError(error.message || "分类保存失败，请检查本地数据库服务。", rerender);
  }
}

async function saveStore(form, rerender) {
  const name = getFormValue(form, "name");
  const platform = getFormValue(form, "platform");
  const brand = getFormValue(form, "brand");
  const type = getFormValue(form, "type");
  const ownerId = getFormValue(form, "ownerId") || null;
  const remark = getFormValue(form, "remark");
  const status = getFormValue(form, "status") || Status.Active;

  if (name === "") return setModalError("店铺名称不能为空。", rerender);
  if (platform === "") return setModalError("请选择所属平台。", rerender);

  const now = getNow();
  const item =
    modalState.mode === "add"
      ? {
          id: createId("store"),
          name,
          platform,
          brand,
          type,
          ownerId,
          status,
          remark,
          createdAt: now,
          updatedAt: now,
        }
      : {
          ...(stores.find((store) => store.id === modalState.id) ?? {}),
          id: modalState.id,
          name,
          platform,
          brand,
          type,
          ownerId,
          status,
          remark,
          updatedAt: now,
        };

  try {
    const savedStore = await persistSettingsEntity("store", item, modalState.mode);
    replaceStores(upsertItem(stores, savedStore));
    modalState = null;
    rerender();
  } catch (error) {
    setModalError(error.message || "店铺保存失败，请检查本地数据库服务。", rerender);
  }
}

async function uploadIssueAttachments(files = []) {
  const uploaded = [];
  for (const file of files) {
    const result = await uploadGenericFile(file);
    uploaded.push({
      originalName: result.originalName ?? result.filename ?? file.name,
      filename: result.filename ?? "",
      filePath: result.filePath ?? result.url ?? "",
      url: result.url ?? result.filePath ?? "",
      mimeType: result.mimeType ?? file.type,
      uploadedAt: result.uploadedAt ?? getNow(),
    });
  }
  return uploaded;
}

async function saveIssueRequirement(form, rerender) {
  const current = getEditingIssueRequirement();
  const now = getNow();

  if (modalState.mode === "complete") {
    const solution = getFormValue(form, "solution");
    const completedBy = getFormValue(form, "completedBy");
    if (solution === "") return setModalError("请填写解决方案。", rerender);
    if (completedBy === "") return setModalError("请选择完成人。", rerender);
    const item = {
      ...(current ?? {}),
      id: modalState.id,
      solution,
      completedBy,
      completedAt: now,
      status: "done",
      updatedAt: now,
    };
    try {
      const saved = await persistSettingsEntity("issueRequirement", item);
      replaceIssuesRequirements(upsertItem(issuesRequirements, saved));
      modalState = null;
      rerender();
    } catch (error) {
      setModalError(error.message || "需求/问题保存失败，请检查本地数据库服务。", rerender);
    }
    return;
  }

  const title = getFormValue(form, "title");
  const type = getFormValue(form, "type");
  const module = getFormValue(form, "module");
  const submitterId = getFormValue(form, "submitterId");
  const status = getFormValue(form, "status") || "pending";
  const description = getFormValue(form, "description");

  if (title === "") return setModalError("标题不能为空。", rerender);
  if (!["requirement", "issue"].includes(type)) return setModalError("请选择类型。", rerender);
  if (module === "") return setModalError("请选择所属模块。", rerender);
  if (submitterId === "") return setModalError("请选择提交人。", rerender);
  if (!issueRequirementStatuses.some((item) => item.value === status)) return setModalError("状态无效。", rerender);

  let uploadedAttachments = [];
  const input = form.elements.issueAttachments;
  const files = input?.files === undefined ? [] : Array.from(input.files);
  try {
    uploadedAttachments = await uploadIssueAttachments(files);
  } catch (error) {
    return setModalError(error.message || "附件上传失败。", rerender);
  }

  const item =
    modalState.mode === "add"
      ? {
          id: createId("issue"),
          title,
          type,
          module,
          description,
          attachments: [...(modalState.attachments ?? []), ...uploadedAttachments],
          submitterId,
          status,
          solution: "",
          completedBy: "",
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        }
      : {
          ...(current ?? {}),
          id: modalState.id,
          title,
          type,
          module,
          description,
          attachments: [...(modalState.attachments ?? current?.attachments ?? []), ...uploadedAttachments],
          submitterId,
          status,
          updatedAt: now,
        };

  try {
    const saved = await persistSettingsEntity("issueRequirement", item, modalState.mode);
    replaceIssuesRequirements(upsertItem(issuesRequirements, saved));
    modalState = null;
    rerender();
  } catch (error) {
    setModalError(error.message || "需求/问题保存失败，请检查本地数据库服务。", rerender);
  }
}

async function softDeleteIssueRequirement(id, rerender) {
  const item = issuesRequirements.find((issue) => issue.id === id);
  if (item === undefined) return;
  const updated = { ...item, status: "deleted", updatedAt: getNow() };
  try {
    const saved = await persistSettingsEntity("issueRequirement", updated);
    replaceIssuesRequirements(upsertItem(issuesRequirements, saved));
    rerender();
  } catch (error) {
    window.alert(error.message || "删除失败，请检查本地数据库服务。");
  }
}

function validateDepartmentDrop(draggedDepartmentId, targetDepartmentId) {
  if (draggedDepartmentId === targetDepartmentId) return "部门不能调整为自己的下级。";
  if (createsDepartmentCycle(draggedDepartmentId, targetDepartmentId)) return "不能形成循环部门关系。";
  return "";
}

async function alignDepartmentToParent(draggedDepartmentId, targetDepartmentId, rerender) {
  const draggedDepartment = departments.find((department) => department.id === draggedDepartmentId);
  const targetDepartment = departments.find((department) => department.id === targetDepartmentId);
  if (draggedDepartment === undefined || targetDepartment === undefined) return;

  const error = validateDepartmentDrop(draggedDepartmentId, targetDepartmentId);
  if (error !== "") {
    window.alert(error);
    return;
  }

  if (!window.confirm(`确定将「${draggedDepartment.name}」调整为「${targetDepartment.name}」的下级部门吗？`)) return;

  const now = getNow();
  const item = {
    ...draggedDepartment,
    parentDepartmentId: targetDepartmentId,
    updatedAt: now,
  };

  try {
    const savedDepartment = await persistSettingsEntity("department", item);
    replaceDepartments(upsertItem(departments, savedDepartment));
    rerender();
  } catch (saveError) {
    window.alert(saveError.message || "部门调整保存失败，请检查本地数据库服务。");
  }
}

async function alignPersonToDepartment(personId, targetDepartmentId, rerender) {
  const person = people.find((item) => item.id === personId);
  const targetDepartment = departments.find((department) => department.id === targetDepartmentId);
  if (person === undefined || targetDepartment === undefined) return;

  if (person.departmentId === targetDepartmentId) {
    window.alert("该员工已在当前部门。");
    return;
  }

  if (!window.confirm(`确定将「${person.name}」调整到「${targetDepartment.name}」吗？`)) return;

  const now = getNow();
  const item = {
    ...person,
    departmentId: targetDepartmentId,
    updatedAt: now,
  };

  try {
    const savedPerson = await persistSettingsEntity("person", item);
    replacePeople(upsertItem(people, stripSensitivePersonFields(savedPerson)));
    rerender();
  } catch (saveError) {
    window.alert(saveError.message || "人员部门调整保存失败，请检查本地数据库服务。");
  }
}

async function deactivateEntity(entity, id, rerender) {
  const now = getNow();
  const collectionByEntity = {
    department: departments,
    position: positions,
    person: people,
    category: categories,
    store: stores,
  };
  const replaceByEntity = {
    department: replaceDepartments,
    position: replacePositions,
    person: replacePeople,
    category: replaceCategories,
    store: replaceStores,
  };
  const item = collectionByEntity[entity]?.find((current) => current.id === id);
  if (item === undefined) return;

  const nextItem = { ...item, status: Status.Inactive, updatedAt: now };
  if (entity === "person") {
    const nextPeople = people.map((person) => (person.id === id ? nextItem : person));
    if (!hasManageablePermissionAdmin(nextPeople)) {
      window.alert("系统至少需要保留一个权限管理员。");
      return;
    }
  }

  try {
    const savedItem = await persistSettingsEntity(entity, nextItem);
    const stateItem = entity === "person" ? stripSensitivePersonFields(savedItem) : savedItem;
    replaceByEntity[entity](upsertItem(collectionByEntity[entity], stateItem));
    rerender();
  } catch (error) {
    window.alert(error.message || "停用保存失败，请检查本地数据库服务。");
  }
}

async function activateEntity(entity, id, rerender) {
  const now = getNow();
  if (entity !== "store") return;
  const store = stores.find((item) => item.id === id);
  if (store === undefined) return;

  try {
    const savedStore = await persistSettingsEntity("store", { ...store, status: Status.Active, updatedAt: now });
    replaceStores(upsertItem(stores, savedStore));
  } catch (error) {
    window.alert(error.message || "店铺状态保存失败，请检查本地数据库服务。");
  }
  rerender();
}

function handleDepartmentDragStart(event) {
  const personCard = event.target.closest(".organization-person-card[data-person-drag-id]");
  if (personCard !== null) {
    event.stopPropagation();
    draggedPersonId = personCard.dataset.personDragId;
    draggedDepartmentId = null;
    dragOverDepartmentId = null;
    personCard.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-workstation-drag-type", "person");
    event.dataTransfer.setData("text/plain", draggedPersonId);
    return;
  }

  const card = event.target.closest(".organization-map-card[data-department-drag-id]");
  if (card === null) return;
  event.stopPropagation();
  draggedDepartmentId = card.dataset.departmentDragId;
  draggedPersonId = null;
  dragOverDepartmentId = null;
  card.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-workstation-drag-type", "department");
  event.dataTransfer.setData("text/plain", draggedDepartmentId);
}

function handleDepartmentDragEnter(event) {
  const dropCard = event.target.closest(".organization-map-card[data-department-drop-id]");
  if (dropCard === null || (draggedDepartmentId === null && draggedPersonId === null)) return;
  event.preventDefault();
}

function handleDepartmentDragOver(event) {
  const dropCard = event.target.closest(".organization-map-card[data-department-drop-id]");
  if (dropCard === null || (draggedDepartmentId === null && draggedPersonId === null)) return;
  const targetDepartmentId = dropCard.dataset.departmentDropId;
  if (draggedDepartmentId !== null && targetDepartmentId === draggedDepartmentId) return;
  event.preventDefault();
  const draggedPerson = draggedPersonId === null ? null : people.find((person) => person.id === draggedPersonId);
  const canDrop =
    draggedDepartmentId !== null
      ? validateDepartmentDrop(draggedDepartmentId, targetDepartmentId) === ""
      : draggedPerson !== undefined && draggedPerson?.departmentId !== targetDepartmentId;
  event.dataTransfer.dropEffect = "move";
  if (dragOverDepartmentId !== targetDepartmentId) {
    document.querySelectorAll(".organization-map-card.is-drag-over").forEach((card) => card.classList.remove("is-drag-over"));
    dragOverDepartmentId = canDrop ? targetDepartmentId : null;
    if (canDrop) dropCard.classList.add("is-drag-over");
  }
}

function handleDepartmentDragLeave(event) {
  const dropCard = event.target.closest(".organization-map-card[data-department-drop-id]");
  if (dropCard === null || dropCard.dataset.departmentDropId !== dragOverDepartmentId) return;
  const nextTarget = event.relatedTarget?.closest?.(".organization-map-card[data-department-drop-id]");
  if (nextTarget === dropCard) return;
  dragOverDepartmentId = null;
  dropCard.classList.remove("is-drag-over");
}

async function handleDepartmentDrop(event, rerender) {
  const dropCard = event.target.closest(".organization-map-card[data-department-drop-id]");
  if (dropCard === null) return;
  event.preventDefault();
  event.stopPropagation();
  const dragType = event.dataTransfer.getData("application/x-workstation-drag-type");
  const droppedId = event.dataTransfer.getData("text/plain");
  const droppedDepartmentId = dragType === "department" ? droppedId || draggedDepartmentId : draggedDepartmentId;
  const droppedPersonId = dragType === "person" ? droppedId || draggedPersonId : draggedPersonId;
  const targetDepartmentId = dropCard.dataset.departmentDropId;
  draggedDepartmentId = null;
  draggedPersonId = null;
  dragOverDepartmentId = null;
  document.querySelectorAll(".organization-map-card.is-dragging, .organization-map-card.is-drag-over, .organization-person-card.is-dragging").forEach((card) => {
    card.classList.remove("is-dragging", "is-drag-over");
  });
  if (droppedPersonId !== null && droppedPersonId !== "") {
    await alignPersonToDepartment(droppedPersonId, targetDepartmentId, rerender);
    return;
  }
  if (droppedDepartmentId === null || droppedDepartmentId === "" || targetDepartmentId === droppedDepartmentId) return;
  await alignDepartmentToParent(droppedDepartmentId, targetDepartmentId, rerender);
}

function handleDepartmentDragEnd() {
  draggedDepartmentId = null;
  draggedPersonId = null;
  dragOverDepartmentId = null;
  document.querySelectorAll(".organization-map-card.is-dragging, .organization-map-card.is-drag-over, .organization-person-card.is-dragging").forEach((card) => {
    card.classList.remove("is-dragging", "is-drag-over");
  });
}

function getDeactivateMessage(entity) {
  const entityNames = {
    department: "部门",
    position: "岗位",
    person: "人员",
    category: "分类",
    store: "店铺",
  };

  return `确定要停用该${entityNames[entity]}吗？停用后历史数据仍会保留。`;
}

async function handleFormSubmit(event, rerender) {
  event.preventDefault();

  if (modalState.entity === "department") return await saveDepartment(event.target, rerender);
  if (modalState.entity === "position") return await savePosition(event.target, rerender);
  if (modalState.entity === "person") return await savePerson(event.target, rerender);
  if (modalState.entity === "category") return await saveCategory(event.target, rerender);
  if (modalState.entity === "store") return await saveStore(event.target, rerender);
  if (modalState.entity === "issueRequirement") return await saveIssueRequirement(event.target, rerender);
}

function collectPermissionDraft(form, currentPermissions) {
  const permissions = normalizePermissions(currentPermissions);
  permissions.dataScope = getFormValue(form, "dataScope") || "department";
  for (const group of permissionGroups) {
    for (const item of group.permissions) {
      permissions[group.key][item.key] = new FormData(form).has(`${group.key}.${item.key}`);
    }
  }
  return permissions;
}

async function savePermissions(form, rerender) {
  const person = getSelectedPermissionPerson();
  if (person === null) return;
  if (!canCurrentUser("settings.managePermissions")) {
    permissionSaveMessage = "你没有权限保存权限。";
    rerender();
    return;
  }

  const nextPermissions = collectPermissionDraft(form, getActivePermissionDraft(person));
  const nextPerson = { ...person, permissions: nextPermissions, updatedAt: getNow() };
  const nextPeople = people.map((item) => (item.id === person.id ? nextPerson : item));

  if (!hasManageablePermissionAdmin(nextPeople)) {
    permissionSaveMessage = "系统至少需要保留一个权限管理员。";
    rerender();
    return;
  }

  try {
    const savedPerson = await persistSettingsEntity("person", nextPerson);
    replacePeople(upsertItem(people, stripSensitivePersonFields(savedPerson)));
    permissionDraft = { personId: person.id, permissions: nextPermissions };
    permissionSaveMessage = "权限已保存";
    if (person.id === getCurrentUser()?.id) await validateCurrentSession();
  } catch (error) {
    permissionSaveMessage = error.message || "权限保存失败，请检查本地数据库服务。";
  }
  rerender();
}

function parseFieldOptions(value) {
  return String(value ?? "")
    .split(/,|，|\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyFormDesignerPropertyPanel(fields) {
  const panel = document.querySelector(".form-designer-property-panel");
  const activeFieldId = panel?.querySelector("[name='activeFieldId']")?.value ?? "";
  if (panel === null || activeFieldId === "") return fields;
  return fields.map((field) =>
    field.fieldId === activeFieldId
      ? {
          ...field,
          label: panel.querySelector("[name='propertyLabel']")?.value.trim() ?? field.label,
          type: panel.querySelector("[name='propertyType']")?.value || field.type,
          required: panel.querySelector("[name='propertyRequired']")?.value === "true",
          defaultValue: panel.querySelector("[name='propertyDefaultValue']")?.value ?? "",
          placeholder: panel.querySelector("[name='propertyPlaceholder']")?.value ?? "",
          width: Number(panel.querySelector("[name='propertyWidth']")?.value ?? field.width),
          options: parseFieldOptions(panel.querySelector("[name='propertyOptions']")?.value ?? ""),
        }
      : field,
  );
}

function getCurrentFormDesignFields() {
  return normalizeFormDesignerFields(applyFormDesignerPropertyPanel(getFormDesignRenderFields()));
}

function setFormDesignDraftFields(fields, activeFieldId = activeFormDesignFieldId) {
  modalState = {
    kind: "formDesignerDraft",
    standardWorkId: activeFormDesignStandardWorkId,
    draftFields: normalizeFormDesignerFields(fields),
  };
  activeFormDesignFieldId = activeFieldId;
}

function getFormDesignRenderFields() {
  if (modalState?.kind === "formDesignerDraft" && modalState.standardWorkId === activeFormDesignStandardWorkId) {
    return normalizeFormDesignerFields(modalState.draftFields);
  }
  return getFormDesignDraftFields();
}

function selectFormDesignerField(fieldId) {
  const fields = getCurrentFormDesignFields();
  const selectedFieldId = fields.some((field) => field.fieldId === fieldId)
    ? fieldId
    : fields[0]?.fieldId ?? "";
  setFormDesignDraftFields(fields, selectedFieldId);
}

async function saveStandardWorkForm(form, rerender) {
  if (!canCurrentUser("settings.editStandardWorkForms")) return;
  const standardWorkId = form.dataset.standardWorkId ?? "";
  const standardWork = state.taskTemplates.find((template) => template.id === standardWorkId);
  if (standardWork === undefined) return;
  const fields = getCurrentFormDesignFields();
  const existingForm = findStandardWorkForm(standardWorkId);
  const now = getNow();
  const item = {
    ...(existingForm ?? {}),
    id: existingForm?.id ?? createId("standard-work-form"),
    standardWorkId,
    formSchema: { fields },
    createdAt: existingForm?.createdAt ?? now,
    updatedAt: now,
  };

  try {
    const savedForm = existingForm === null
      ? await createPersistentResource("standard-work-forms", item)
      : await updatePersistentResource("standard-work-forms", item.id, item);
    replaceStandardWorkForms(upsertItem(standardWorkForms, savedForm));
    modalState = null;
  } catch (error) {
    window.alert(error.message || "表单结构保存失败，请检查本地数据库服务。");
  }
  rerender();
}

function updateFormDesignerFields(transform) {
  setFormDesignDraftFields(transform(getCurrentFormDesignFields()));
}

function createFormDesignerField(type = "text", order = 1) {
  const normalizedType = resolveFormDesignerFieldType(type);
  const fieldId = createId("form-field");
  return {
    fieldId,
    label: getFormDesignerFieldTypeLabel(normalizedType),
    type: normalizedType,
    required: false,
    order,
    defaultValue: "",
    placeholder: "",
    width: getDefaultFieldWidth(normalizedType),
    options: [],
  };
}

function addFormDesignerField(type = "text") {
  let fieldId = "";
  updateFormDesignerFields((fields) => [
    ...fields,
    (() => {
      const field = createFormDesignerField(type, fields.length + 1);
      fieldId = field.fieldId;
      return field;
    })(),
  ]);
  activeFormDesignFieldId = fieldId;
}

function copyFormDesignerField(fieldId) {
  let copiedFieldId = "";
  updateFormDesignerFields((fields) => {
    const index = fields.findIndex((field) => field.fieldId === fieldId);
    if (index < 0) return fields;
    copiedFieldId = createId("form-field");
    const copiedField = {
      ...fields[index],
      fieldId: copiedFieldId,
      label: `${fields[index].label || "未命名字段"} 副本`,
      order: index + 2,
    };
    const nextFields = [...fields];
    nextFields.splice(index + 1, 0, copiedField);
    return nextFields;
  });
  if (copiedFieldId !== "") activeFormDesignFieldId = copiedFieldId;
}

function removeFormDesignerField(fieldId) {
  updateFormDesignerFields((fields) => {
    const nextFields = fields.filter((field) => field.fieldId !== fieldId);
    if (activeFormDesignFieldId === fieldId) activeFormDesignFieldId = nextFields[0]?.fieldId ?? "";
    return nextFields;
  });
}

function moveFormDesignerField(fieldId, direction) {
  updateFormDesignerFields((fields) => {
    const index = fields.findIndex((field) => field.fieldId === fieldId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= fields.length) return fields;
    const nextFields = [...fields];
    [nextFields[index], nextFields[targetIndex]] = [nextFields[targetIndex], nextFields[index]];
    return nextFields;
  });
}

function reorderFormDesignerField(draggedId, targetId) {
  updateFormDesignerFields((fields) => {
    const draggedIndex = fields.findIndex((field) => field.fieldId === draggedId);
    const targetIndex = fields.findIndex((field) => field.fieldId === targetId);
    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return fields;
    const nextFields = [...fields];
    const [dragged] = nextFields.splice(draggedIndex, 1);
    nextFields.splice(targetIndex, 0, dragged);
    return nextFields;
  });
}

export function bindSettingsPageEvents(rerender) {
  const settingsPage = document.querySelector(".settings-page");
  const form = document.querySelector(".modal-form");
  const permissionForm = document.querySelector(".permission-editor-form");
  const formDesignerForm = document.querySelector(".form-designer-editor");

  if (settingsPage === null) return;

  settingsPage.addEventListener("click", async (event) => {
    const organizationTab = event.target.closest("[data-organization-tab]");

    if (organizationTab !== null) {
      activeOrganizationTab = organizationTab.dataset.organizationTab;
      rerender();
      return;
    }

    const permissionPerson = event.target.closest("[data-permission-person-id]");
    if (permissionPerson !== null) {
      selectedPermissionPersonId = permissionPerson.dataset.permissionPersonId;
      permissionDraft = null;
      permissionSaveMessage = "";
      rerender();
      return;
    }

    const permissionTemplate = event.target.closest("[data-permission-template]");
    if (permissionTemplate !== null) {
      const person = getSelectedPermissionPerson();
      if (person !== null) {
        permissionDraft = {
          personId: person.id,
          permissions: applyPermissionTemplate(permissionTemplate.dataset.permissionTemplate),
        };
        permissionSaveMessage = "";
        rerender();
      }
      return;
    }

    const button = event.target.closest("[data-action]");

    const formFieldCard = event.target.closest(".form-renderer-field[data-form-field-id]");
    if (button === null && formFieldCard !== null) {
      selectFormDesignerField(formFieldCard.dataset.formFieldId ?? "");
      rerender();
      return;
    }

    if (button === null) return;

    const action = button.dataset.action;
    const entity = button.dataset.entity;
    const id = button.dataset.id;
    const isFormDesignerAction = button.closest(".form-designer-editor") !== null;

    if (isFormDesignerAction) {
      event.preventDefault();
    }

    if (action === "select-form-standard-work") {
      activeFormDesignStandardWorkId = button.dataset.standardWorkId ?? "";
      modalState = null;
      rerender();
      return;
    }

    if (action === "add-form-field") {
      addFormDesignerField();
      rerender();
      return;
    }

    if (action === "add-form-field-type") {
      addFormDesignerField(button.dataset.componentType ?? "text");
      rerender();
      return;
    }

    if (action === "select-form-field") {
      selectFormDesignerField(button.dataset.fieldId ?? "");
      rerender();
      return;
    }

    if (action === "remove-form-field") {
      removeFormDesignerField(button.dataset.fieldId ?? "");
      rerender();
      return;
    }

    if (action === "copy-form-field") {
      copyFormDesignerField(button.dataset.fieldId ?? "");
      rerender();
      return;
    }

    if (action === "move-form-field-up") {
      moveFormDesignerField(button.dataset.fieldId ?? "", -1);
      rerender();
      return;
    }

    if (action === "move-form-field-down") {
      moveFormDesignerField(button.dataset.fieldId ?? "", 1);
      rerender();
      return;
    }

    if (action === "close-modal") {
      modalState = null;
      rerender();
      return;
    }

    if (action === "view-issue") {
      modalState = { mode: "view", entity: "issueRequirement", id, error: "" };
      rerender();
      return;
    }

    if (action === "complete-issue") {
      modalState = { mode: "complete", entity: "issueRequirement", id, error: "" };
      rerender();
      return;
    }

    if (action === "delete-issue" && window.confirm("确定要删除该记录吗？删除后列表将不再显示。")) {
      await softDeleteIssueRequirement(id, rerender);
      return;
    }

    if (action === "add" || action === "edit") {
      const issueRequirement = entity === "issueRequirement" ? issuesRequirements.find((item) => item.id === id) : null;
      modalState = {
        mode: action,
        entity,
        id,
        error: "",
        ...(entity === "issueRequirement" ? { attachments: issueRequirement?.attachments ?? [] } : {}),
      };
      rerender();
      return;
    }

    if (action === "activate") {
      await activateEntity(entity, id, rerender);
      return;
    }

    if (action === "deactivate" && window.confirm(getDeactivateMessage(entity))) {
      await deactivateEntity(entity, id, rerender);
    }
  });
  settingsPage.addEventListener("dragstart", handleDepartmentDragStart);
  settingsPage.addEventListener("dragenter", handleDepartmentDragEnter);
  settingsPage.addEventListener("dragover", handleDepartmentDragOver);
  settingsPage.addEventListener("dragleave", handleDepartmentDragLeave);
  settingsPage.addEventListener("drop", (event) => handleDepartmentDrop(event, rerender));
  settingsPage.addEventListener("dragend", handleDepartmentDragEnd);
  settingsPage.addEventListener("dragstart", (event) => {
    const componentCard = event.target.closest(".form-component-card[data-component-type]");
    if (componentCard !== null) {
      draggedFormComponentType = componentCard.dataset.componentType ?? "text";
      draggedFormFieldId = null;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", draggedFormComponentType);
      return;
    }

    const fieldRow = event.target.closest(".form-renderer-field[data-form-field-id]");
    if (fieldRow === null) return;
    setFormDesignDraftFields(getCurrentFormDesignFields(), fieldRow.dataset.formFieldId ?? "");
    draggedFormFieldId = fieldRow.dataset.formFieldId;
    draggedFormComponentType = null;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedFormFieldId);
  });
  settingsPage.addEventListener("dragover", (event) => {
    if (draggedFormComponentType !== null) {
      if (event.target.closest(".form-designer-preview") === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      return;
    }

    if (draggedFormFieldId === null) return;
    if (event.target.closest(".form-renderer-field[data-form-field-id]") === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  settingsPage.addEventListener("drop", (event) => {
    if (draggedFormComponentType !== null) {
      if (event.target.closest(".form-designer-preview") === null) return;
      event.preventDefault();
      addFormDesignerField(draggedFormComponentType);
      draggedFormComponentType = null;
      rerender();
      return;
    }

    if (draggedFormFieldId === null) return;
    const fieldRow = event.target.closest(".form-renderer-field[data-form-field-id]");
    if (fieldRow === null) return;
    event.preventDefault();
    reorderFormDesignerField(draggedFormFieldId, fieldRow.dataset.formFieldId ?? "");
    draggedFormFieldId = null;
    rerender();
  });
  settingsPage.addEventListener("dragend", () => {
    draggedFormFieldId = null;
    draggedFormComponentType = null;
  });

  if (form !== null) {
    form.addEventListener("submit", (event) => handleFormSubmit(event, rerender));
  }

  if (formDesignerForm !== null) {
    formDesignerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveStandardWorkForm(event.currentTarget, rerender);
    });

    formDesignerForm.querySelector("[name='formDesignStandardWorkId']")?.addEventListener("change", (event) => {
      activeFormDesignStandardWorkId = event.target.value;
      activeFormDesignFieldId = "";
      modalState = null;
      rerender();
    });
  }

  settingsPage.querySelectorAll("[name='permissionKeyword'], [name='permissionDepartmentId'], [name='permissionLoginOnly']").forEach((input) => {
    input.addEventListener("input", () => {
      const keyword = settingsPage.querySelector("[name='permissionKeyword']");
      const department = settingsPage.querySelector("[name='permissionDepartmentId']");
      const loginOnly = settingsPage.querySelector("[name='permissionLoginOnly']");
      permissionFilters = {
        keyword: keyword?.value ?? "",
        departmentId: department?.value ?? "",
        loginOnly: Boolean(loginOnly?.checked),
      };
      selectedPermissionPersonId = null;
      permissionDraft = null;
      permissionSaveMessage = "";
      rerender();
    });
  });

  settingsPage.querySelectorAll("[name='storeKeyword'], [name='storePlatform'], [name='storeStatus']").forEach((input) => {
    input.addEventListener("input", () => {
      storeFilters = {
        keyword: settingsPage.querySelector("[name='storeKeyword']")?.value ?? "",
        platform: settingsPage.querySelector("[name='storePlatform']")?.value ?? "",
        status: settingsPage.querySelector("[name='storeStatus']")?.value ?? "",
      };
      rerender();
    });
    input.addEventListener("change", () => {
      storeFilters = {
        keyword: settingsPage.querySelector("[name='storeKeyword']")?.value ?? "",
        platform: settingsPage.querySelector("[name='storePlatform']")?.value ?? "",
        status: settingsPage.querySelector("[name='storeStatus']")?.value ?? "",
      };
      rerender();
    });
  });

  settingsPage.querySelectorAll("[name='issueKeyword'], [name='issueType'], [name='issueModule'], [name='issueStatus']").forEach((input) => {
    const updateIssueFilters = () => {
      issueFilters = {
        keyword: settingsPage.querySelector("[name='issueKeyword']")?.value ?? "",
        type: settingsPage.querySelector("[name='issueType']")?.value ?? "",
        module: settingsPage.querySelector("[name='issueModule']")?.value ?? "",
        status: settingsPage.querySelector("[name='issueStatus']")?.value ?? "",
      };
      rerender();
    };
    input.addEventListener("input", updateIssueFilters);
    input.addEventListener("change", updateIssueFilters);
  });

  if (permissionForm !== null) {
    permissionForm.addEventListener("submit", (event) => {
      event.preventDefault();
      savePermissions(event.currentTarget, rerender);
    });
  }
}

export function renderSettingsPage() {
  return `
    <div class="settings-page">
      <div class="settings-tabs" aria-label="设置分区">
        ${canCurrentUser("settings.viewOrg") ? `<a href="#organization">组织架构</a>` : ""}
        ${canCurrentUser("settings.viewPeople") ? `<a href="#people">人员管理</a>` : ""}
        ${canCurrentUser("settings.managePermissions") ? `<a href="#permissions">权限管理</a>` : ""}
        ${canCurrentUser("settings.viewStores") ? `<a href="#stores">店铺管理</a>` : ""}
        ${canCurrentUser("settings.viewStandardWorks") || canCurrentUser("settings.editStandardWorkForms") ? `<a href="#form-design">表单设计</a>` : ""}
        ${canCurrentUser("settings.editStandardWorkForms") ? `<a href="#issues-requirements">需求与问题中心</a>` : ""}
        <a href="#categories">分类设置</a>
      </div>
      ${canCurrentUser("settings.viewOrg") ? renderOrganizationSection() : ""}
      ${canCurrentUser("settings.viewPeople") ? renderPeopleSection() : ""}
      ${canCurrentUser("settings.managePermissions") ? renderPermissionSection() : ""}
      ${canCurrentUser("settings.viewStores") ? renderStoreSection() : ""}
      ${canCurrentUser("settings.viewStandardWorks") || canCurrentUser("settings.editStandardWorkForms") ? renderFormDesignSection() : ""}
      ${canCurrentUser("settings.editStandardWorkForms") ? renderIssuesRequirementsSection() : ""}
      ${renderCategorySection()}
      ${renderModal()}
    </div>
  `;
}
