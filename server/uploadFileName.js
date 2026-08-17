export function normalizeUploadedFileName(value = "") {
  const name = String(value ?? "");
  if (!name || /[\u3400-\u9fff]/.test(name)) return name;

  const decoded = Buffer.from(name, "latin1").toString("utf8");
  const decodedHasCjk = /[\u3400-\u9fff]/.test(decoded);
  return decodedHasCjk && !decoded.includes("\uFFFD") ? decoded : name;
}
