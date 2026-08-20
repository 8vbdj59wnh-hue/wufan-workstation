export const V3_PROJECTION_ENV = "V3_AUTO_PROJECTION";
export const V3_RELATION_WRITE_ENV = "V3_AUTO_RELATION_WRITE";
export const V3_RELATION_READ_ENV = "V3_RELATION_READ";
export const V3_RELATION_SOURCE_TYPE = "platform_goods_v3_projection";

const clean = (value) => String(value ?? "").trim().toLowerCase();
const enabled = (value) => value === true || value === 1 || ["1", "true", "on", "yes", "enabled"].includes(clean(value));

function projectionMode(value) {
  const mode = clean(value);
  if (!mode || ["0", "false", "off", "disabled"].includes(mode)) return "off";
  if (["shadow", "compare", "dry-run", "dry_run"].includes(mode)) return "shadow";
  if (["1", "true", "on", "yes", "enabled"].includes(mode)) return "on";
  throw new Error("invalid_v3_auto_projection_flag");
}

export function readV3RelationFeatureFlags(options = {}) {
  const environment = options.environment || process.env;
  const projection = projectionMode(options.projection ?? environment[V3_PROJECTION_ENV]);
  const relationWrite = enabled(options.relationWrite ?? environment[V3_RELATION_WRITE_ENV]);
  const relationRead = enabled(options.relationRead ?? environment[V3_RELATION_READ_ENV]);
  if (relationWrite && projection !== "on") throw new Error("v3_relation_write_requires_projection");
  return {
    projection,
    relationWrite,
    relationRead,
    safeDefault: projection === "off" && !relationWrite && !relationRead,
    relationSourceType: V3_RELATION_SOURCE_TYPE,
  };
}

export default readV3RelationFeatureFlags;
