const enabledValues = new Set(["1", "true", "on"]);
const disabledValues = new Set(["0", "false", "off"]);

export function areBackgroundJobsEnabled(environment = process.env) {
  const configured = String(environment.WUFAN_BACKGROUND_JOBS ?? "").trim().toLowerCase();
  if (configured === "") return true;
  if (enabledValues.has(configured)) return true;
  if (disabledValues.has(configured)) return false;

  const error = new Error("WUFAN_BACKGROUND_JOBS must be one of: on, off, true, false, 1, 0");
  error.code = "wufan_background_jobs_invalid";
  throw error;
}
