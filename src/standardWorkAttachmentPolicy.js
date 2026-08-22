export const standardWorkAttachmentAccept = ".xlsx,.xls,.csv,.xmind";
export const maxStandardWorkAttachmentSize = 20 * 1024 * 1024;

const standardWorkAttachmentExtensions = new Set(standardWorkAttachmentAccept.split(","));

function getFileExtension(filename = "") {
  const dotIndex = String(filename).lastIndexOf(".");
  return dotIndex === -1 ? "" : String(filename).slice(dotIndex).toLowerCase();
}

export function validateStandardWorkAttachmentFiles(files) {
  for (const file of files) {
    if (!standardWorkAttachmentExtensions.has(getFileExtension(file.name))) {
      return "附件只支持 .xlsx、.xls、.csv、.xmind。";
    }
    if (file.size > maxStandardWorkAttachmentSize) return "单个附件不能超过 20MB。";
  }
  return "";
}
