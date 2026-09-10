const persistentDataRouteAliases = {
  "dashboard-operation": "dashboard",
  operationDashboard: "dashboard",
  "operation-dashboard": "dashboard",
  "dashboard-management": "dashboardManagement",
  assessment: "dashboardManagement",
  "assessment-stats": "dashboardManagement",
  "assessment-reports": "dashboardManagement",
  "assessment-problems": "dashboardManagement",
  "assessment-rectifications": "dashboardManagement",
  "assessment-person-profiles": "dashboardManagement",
  "task-list": "tasks",
  "task-waves": "tasks",
  clearance: "tasks",
  "process-progress": "tasks",
  "schedule-board": "scheduleBoard",
  "task-schedule-board": "scheduleBoard",
  "content-schedule": "scheduleBoard",
  contentSchedule: "scheduleBoard",
  contentSchedules: "scheduleBoard",
  "process-templates": "processes",
  "started-processes": "processes",
  methodologies: "processes",
  methods: "processes",
  "task-library": "processes",
  "template-center": "templateCenter",
  organization: "settings",
  people: "settings",
  permissions: "settings",
  stores: "settings",
  categories: "settings",
  "publishing-accounts": "settings",
  "form-design": "settings",
  "template-tags": "settings",
  "issues-requirements": "settings",
  "finance-center": "financeCenter",
  "content-center": "contentCenter",
};

export function resolvePersistentDataRoute(fullRoute = "") {
  if (fullRoute === "settings/admin-data-center") return "adminDataCenter";
  if (fullRoute.startsWith("templateCenter/")) return "templateCenter";
  if (fullRoute.startsWith("products/")) return "products";
  const route = fullRoute.split("/")[0];
  if (route.startsWith("process-template-") || route.startsWith("methodology-")) return "processes";
  return persistentDataRouteAliases[route] ?? (route || "dashboard");
}
