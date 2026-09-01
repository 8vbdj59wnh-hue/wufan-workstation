import * as XLSX from "xlsx";

const archiveSizeWarning = /^Bad (?:un)?compressed size:/u;

export function readXlsxWorkbook(buffer, options, {
  context = "unknown",
  reader = XLSX.read,
  logger = console,
} = {}) {
  const originalError = console.error;
  const archiveWarnings = [];
  console.error = (...args) => {
    const message = args.map((value) => String(value)).join(" ");
    if (archiveSizeWarning.test(message)) {
      archiveWarnings.push(message);
      return;
    }
    originalError.apply(console, args);
  };

  try {
    return reader(buffer, options);
  } finally {
    console.error = originalError;
    if (archiveWarnings.length > 0) {
      const uniqueWarnings = [...new Set(archiveWarnings)];
      logger.warn?.(
        `[xlsx:${context}] archive size metadata mismatch: ${archiveWarnings.length} warning(s), ${uniqueWarnings.length} unique`,
      );
    }
  }
}
