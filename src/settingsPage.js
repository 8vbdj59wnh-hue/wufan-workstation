import { getCurrentUser, savePersistentData, state, validateCurrentSession } from "./appState.js?v=20260627-methods1";
import {
  applyPermissionTemplate,
  dataScopeOptions,
  hasPermission,
  normalizePermissions,
  permissionCount,
  permissionGroups,
  permissionTemplates,
} from "./permissions.js?v=20260627-methods1";
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
let modalState = null;
let activeOrganizationTab = "chart";
let permissionFilters = { keyword: "", departmentId: "", loginOnly: false };
let storeFilters = { keyword: "", platform: "", status: "" };
let selectedPermissionPersonId = null;
let permissionDraft = null;
let permissionSaveMessage = "";
let draggedDepartmentId = null;
let dragOverDepartmentId = null;
let draggedPersonId = null;

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
        ${canCurrentUser("settings.editCategories") ? `<button class="primary-button" type="button" data-action="add" data-entity="category">新增分类</button>` : ""}
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
  const actionName = modalState.mode === "add" ? "新增" : "编辑";
  const entityNames = {
    department: "部门",
    position: "岗位",
    person: "人员",
    category: "分类",
    store: "店铺",
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

function renderModalFields() {
  if (modalState.entity === "department") return renderDepartmentForm();
  if (modalState.entity === "position") return renderPositionForm();
  if (modalState.entity === "person") return renderPersonForm();
  if (modalState.entity === "category") return renderCategoryForm();
  if (modalState.entity === "store") return renderStoreForm();

  return "";
}

function renderModal() {
  if (modalState === null) return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="${getModalTitle()}">
        <div class="modal-header">
          <h2>${getModalTitle()}</h2>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="关闭">×</button>
        </div>
        <form class="modal-form" data-form-entity="${modalState.entity}">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          ${renderModalFields()}
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-modal">取消</button>
            <button class="primary-button" type="submit">保存</button>
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

function saveDepartment(form, rerender) {
  const name = getFormValue(form, "name");
  const leaderId = getFormValue(form, "leaderId") || null;
  const sortOrder = parseSortOrder(getFormValue(form, "sortOrder"));

  if (sortOrder === null) return setModalError("排序必须是数字。", rerender);

  if (modalState.mode === "add") {
    const now = getNow();
    replaceDepartments([
      ...departments,
      {
        id: createId("dept"),
        companyId: companies[0].id,
        name,
        leaderId,
        parentDepartmentId: null,
        sortOrder,
        status: Status.Active,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  } else {
    const now = getNow();
    replaceDepartments(
      departments.map((department) =>
        department.id === modalState.id
          ? { ...department, name, leaderId, sortOrder, updatedAt: now }
          : department,
      ),
    );
  }

  modalState = null;
  rerender();
}

function savePosition(form, rerender) {
  const name = getFormValue(form, "name");
  const departmentId = getFormValue(form, "departmentId");
  const sortOrder = parseSortOrder(getFormValue(form, "sortOrder"));

  if (sortOrder === null) return setModalError("排序必须是数字。", rerender);

  if (modalState.mode === "add") {
    const now = getNow();
    replacePositions([
      ...positions,
      {
        id: createId("pos"),
        departmentId,
        name,
        sortOrder,
        status: Status.Active,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  } else {
    const now = getNow();
    replacePositions(
      positions.map((position) =>
        position.id === modalState.id
          ? { ...position, departmentId, name, sortOrder, updatedAt: now }
          : position,
      ),
    );
  }

  modalState = null;
  rerender();
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

  const previousPeople = people.map((person) => ({ ...person }));

  if (modalState.mode === "add") {
    const now = getNow();
    const person = {
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
    };
    if (password !== "") person.password = password;
    replacePeople([
      ...people,
      person,
    ]);
  } else {
    const now = getNow();
    replacePeople(
      people.map((person) =>
        person.id === modalState.id
          ? {
              ...person,
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
              mustChangePassword: password === "" ? person.mustChangePassword : false,
              updatedAt: now,
            }
          : person,
      ),
    );
  }

  if (!hasManageablePermissionAdmin()) {
    replacePeople(previousPeople);
    return setModalError("系统至少需要保留一个权限管理员。", rerender);
  }

  const saved = await savePersistentData();
  if (!saved) {
    replacePeople(previousPeople);
    return setModalError("账号保存失败，请检查本地数据库服务。", rerender);
  }

  replacePeople(people.map((person) => {
    const { password: _password, ...safePerson } = person;
    return safePerson;
  }));
  modalState = null;
  rerender();
}

function saveCategory(form, rerender) {
  const category = categories.find((item) => item.id === modalState.id);
  const name = getFormValue(form, "name");
  const type =
    modalState.mode === "edit" && category !== undefined
      ? category.type
      : getFormValue(form, "type");
  const sortOrder = parseSortOrder(getFormValue(form, "sortOrder"));

  if (sortOrder === null) return setModalError("排序必须是数字。", rerender);

  if (modalState.mode === "add") {
    const now = getNow();
    replaceCategories([
      ...categories,
      {
        id: createId("cat"),
        type,
        name,
        sortOrder,
        status: Status.Active,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  } else {
    const now = getNow();
    replaceCategories(
      categories.map((item) =>
        item.id === modalState.id ? { ...item, name, sortOrder, updatedAt: now } : item,
      ),
    );
  }

  modalState = null;
  rerender();
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

  const previousStores = stores.map((store) => ({ ...store }));
  const now = getNow();

  if (modalState.mode === "add") {
    replaceStores([
      ...stores,
      {
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
      },
    ]);
  } else {
    replaceStores(
      stores.map((store) =>
        store.id === modalState.id
          ? { ...store, name, platform, brand, type, ownerId, status, remark, updatedAt: now }
          : store,
      ),
    );
  }

  const saved = await savePersistentData();
  if (!saved) {
    replaceStores(previousStores);
    return setModalError("店铺保存失败，请检查本地数据库服务。", rerender);
  }

  modalState = null;
  rerender();
}

function validateDepartmentDrop(draggedDepartmentId, targetDepartmentId) {
  if (draggedDepartmentId === targetDepartmentId) return "部门不能调整为自己的下级。";
  if (createsDepartmentCycle(draggedDepartmentId, targetDepartmentId)) return "不能形成循环部门关系。";
  return "";
}

function alignDepartmentToParent(draggedDepartmentId, targetDepartmentId, rerender) {
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
  replaceDepartments(
    departments.map((department) =>
      department.id === draggedDepartmentId
        ? {
            ...department,
            parentDepartmentId: targetDepartmentId,
            updatedAt: now,
          }
        : department,
    ),
  );
  rerender();
}

function alignPersonToDepartment(personId, targetDepartmentId, rerender) {
  const person = people.find((item) => item.id === personId);
  const targetDepartment = departments.find((department) => department.id === targetDepartmentId);
  if (person === undefined || targetDepartment === undefined) return;

  if (person.departmentId === targetDepartmentId) {
    window.alert("该员工已在当前部门。");
    return;
  }

  if (!window.confirm(`确定将「${person.name}」调整到「${targetDepartment.name}」吗？`)) return;

  const now = getNow();
  replacePeople(
    people.map((item) =>
      item.id === personId
        ? {
            ...item,
            departmentId: targetDepartmentId,
            updatedAt: now,
          }
        : item,
    ),
  );
  rerender();
}

function deactivateEntity(entity, id) {
  const now = getNow();

  if (entity === "department") {
    replaceDepartments(
      departments.map((department) =>
        department.id === id
          ? { ...department, status: Status.Inactive, updatedAt: now }
          : department,
      ),
    );
  }

  if (entity === "position") {
    replacePositions(
      positions.map((position) =>
        position.id === id ? { ...position, status: Status.Inactive, updatedAt: now } : position,
      ),
    );
  }

  if (entity === "person") {
    const nextPeople = people.map((person) =>
      person.id === id ? { ...person, status: Status.Inactive, updatedAt: now } : person,
    );
    if (!hasManageablePermissionAdmin(nextPeople)) {
      window.alert("系统至少需要保留一个权限管理员。");
      return;
    }
    replacePeople(
      nextPeople,
    );
  }

  if (entity === "category") {
    replaceCategories(
      categories.map((category) =>
        category.id === id ? { ...category, status: Status.Inactive, updatedAt: now } : category,
      ),
    );
  }

  if (entity === "store") {
    replaceStores(
      stores.map((store) =>
        store.id === id ? { ...store, status: Status.Inactive, updatedAt: now } : store,
      ),
    );
  }
}

async function activateEntity(entity, id, rerender) {
  const now = getNow();
  if (entity !== "store") return;
  const previousStores = stores.map((store) => ({ ...store }));
  replaceStores(stores.map((store) => (store.id === id ? { ...store, status: Status.Active, updatedAt: now } : store)));
  const saved = await savePersistentData();
  if (!saved) {
    replaceStores(previousStores);
    window.alert("店铺状态保存失败，请检查本地数据库服务。");
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

function handleDepartmentDrop(event, rerender) {
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
    alignPersonToDepartment(droppedPersonId, targetDepartmentId, rerender);
    return;
  }
  if (droppedDepartmentId === null || droppedDepartmentId === "" || targetDepartmentId === droppedDepartmentId) return;
  alignDepartmentToParent(droppedDepartmentId, targetDepartmentId, rerender);
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

  if (modalState.entity === "department") return saveDepartment(event.target, rerender);
  if (modalState.entity === "position") return savePosition(event.target, rerender);
  if (modalState.entity === "person") return savePerson(event.target, rerender);
  if (modalState.entity === "category") return saveCategory(event.target, rerender);
  if (modalState.entity === "store") return saveStore(event.target, rerender);
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
  const previousPeople = people.map((item) => ({ ...item }));
  replacePeople(
    people.map((item) =>
      item.id === person.id
        ? { ...item, permissions: nextPermissions, updatedAt: getNow() }
        : item,
    ),
  );

  if (!hasManageablePermissionAdmin()) {
    replacePeople(previousPeople);
    permissionSaveMessage = "系统至少需要保留一个权限管理员。";
    rerender();
    return;
  }

  const saved = await savePersistentData();
  if (!saved) {
    replacePeople(previousPeople);
    permissionSaveMessage = "权限保存失败，请检查本地数据库服务。";
    rerender();
    return;
  }

  permissionDraft = { personId: person.id, permissions: nextPermissions };
  permissionSaveMessage = "权限已保存";
  if (person.id === getCurrentUser()?.id) await validateCurrentSession();
  rerender();
}

export function bindSettingsPageEvents(rerender) {
  const settingsPage = document.querySelector(".settings-page");
  const form = document.querySelector(".modal-form");
  const permissionForm = document.querySelector(".permission-editor-form");

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

    if (button === null) return;

    const action = button.dataset.action;
    const entity = button.dataset.entity;
    const id = button.dataset.id;

    if (action === "close-modal") {
      modalState = null;
      rerender();
      return;
    }

    if (action === "add" || action === "edit") {
      modalState = { mode: action, entity, id, error: "" };
      rerender();
      return;
    }

    if (action === "activate") {
      await activateEntity(entity, id, rerender);
      return;
    }

    if (action === "deactivate" && window.confirm(getDeactivateMessage(entity))) {
      const previousStores = stores.map((store) => ({ ...store }));
      deactivateEntity(entity, id);
      if (entity === "store") {
        const saved = await savePersistentData();
        if (!saved) {
          replaceStores(previousStores);
          window.alert("店铺状态保存失败，请检查本地数据库服务。");
        }
      }
      rerender();
    }
  });
  settingsPage.addEventListener("dragstart", handleDepartmentDragStart);
  settingsPage.addEventListener("dragenter", handleDepartmentDragEnter);
  settingsPage.addEventListener("dragover", handleDepartmentDragOver);
  settingsPage.addEventListener("dragleave", handleDepartmentDragLeave);
  settingsPage.addEventListener("drop", (event) => handleDepartmentDrop(event, rerender));
  settingsPage.addEventListener("dragend", handleDepartmentDragEnd);

  if (form !== null) {
    form.addEventListener("submit", (event) => handleFormSubmit(event, rerender));
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
        <a href="#categories">分类设置</a>
      </div>
      ${canCurrentUser("settings.viewOrg") ? renderOrganizationSection() : ""}
      ${canCurrentUser("settings.viewPeople") ? renderPeopleSection() : ""}
      ${canCurrentUser("settings.managePermissions") ? renderPermissionSection() : ""}
      ${canCurrentUser("settings.viewStores") ? renderStoreSection() : ""}
      ${renderCategorySection()}
      ${renderModal()}
    </div>
  `;
}
