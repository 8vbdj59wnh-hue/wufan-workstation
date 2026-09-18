import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/contentSchedulePage.js", import.meta.url), "utf8");

test("content note import renders processing feedback before awaiting upload parsing", () => {
  const start = source.indexOf("async function handleImportFile(file, rerender)");
  const end = source.indexOf("async function confirmImport", start);
  const handler = source.slice(start, end);
  const processingState = handler.indexOf('phase: "processing"');
  const firstRerender = handler.indexOf("rerender();");
  const parseAwait = handler.indexOf("await parseContentNoteImport(file)");

  assert.ok(processingState >= 0);
  assert.ok(firstRerender > processingState);
  assert.ok(parseAwait > firstRerender);
  assert.match(source, /modalState\.phase === "processing"/u);
  assert.match(source, /role="status" aria-live="polite" aria-busy="true"/u);
  assert.match(source, /正在上传并解析文件/u);
});
