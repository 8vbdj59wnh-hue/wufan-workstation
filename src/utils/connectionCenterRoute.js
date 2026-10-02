export const CONNECTION_CENTER_SECTIONS = new Set([
  "cockpit", "my-links", "connections", "goal-management", "hospital", "data-import", "sales-relation-governance",
  "sales-data-quality-governance",
]);

const sectionAliases = new Map([
  ["data_update", "data-import"],
  ["data-update", "data-import"],
]);

function decoded(value) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export function parseConnectionCenterRoute(hash = "") {
  const route = String(hash || "").replace(/^#/, "");
  if (route === "connectionCenter") return { section: "", detailId: "" };
  if (!route.startsWith("connectionCenter/")) return { section: "", detailId: "" };
  const [pathPart, queryPart = ""] = route.slice("connectionCenter/".length).split("?");
  const suffix = decoded(pathPart);
  const inspectionTaskId = new URLSearchParams(queryPart).get("inspectionTaskId") || "";
  const section = sectionAliases.get(suffix) || suffix;
  if (section.startsWith("data-import/")) {
    const importPage = section.slice("data-import/".length);
    return { section: "data-import", detailId: "", importPage: ["platform-goods", "platform-operations", "sales-profit", "owners"].includes(importPage) ? importPage : "platform-goods" };
  }
  if (section === "data-center") return { section: "", detailId: "", redirectHash: "#products" };
  if (section === "erp-usage-governance") return { section: "", detailId: "", redirectHash: "#connectionCenter/data-import" };
  return CONNECTION_CENTER_SECTIONS.has(section)
    ? { section, detailId: "", inspectionTaskId: "" }
    : { section: "", detailId: suffix, inspectionTaskId };
}

export function connectionCenterSectionHash(section = "cockpit") {
  const normalized = CONNECTION_CENTER_SECTIONS.has(section) ? section : "cockpit";
  return `#connectionCenter/${encodeURIComponent(normalized)}`;
}
