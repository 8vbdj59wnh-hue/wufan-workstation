export const CONNECTION_CENTER_SECTIONS = new Set([
  "cockpit", "my-links", "connections", "hospital", "data-import", "sales-relation-governance",
  "sales-data-quality-governance", "erp-usage-governance", "data-center",
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
  const suffix = decoded(route.slice("connectionCenter/".length));
  const section = sectionAliases.get(suffix) || suffix;
  return CONNECTION_CENTER_SECTIONS.has(section) ? { section, detailId: "" } : { section: "", detailId: suffix };
}

export function connectionCenterSectionHash(section = "cockpit") {
  const normalized = CONNECTION_CENTER_SECTIONS.has(section) ? section : "cockpit";
  return `#connectionCenter/${encodeURIComponent(normalized)}`;
}
