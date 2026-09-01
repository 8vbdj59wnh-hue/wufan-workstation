import assert from "node:assert/strict";
import test from "node:test";

import { readXlsxWorkbook } from "../server/workbookReader.js";

test("xlsx archive warnings are summarized once with their business context", () => {
  const forwardedErrors = [];
  const summaries = [];
  const previousError = console.error;
  const captureError = (...args) => forwardedErrors.push(args.join(" "));
  console.error = captureError;
  try {
    const workbook = readXlsxWorkbook(Buffer.from("test"), {}, {
      context: "test-import",
      logger: { warn: (message) => summaries.push(message) },
      reader: () => {
        console.error("Bad uncompressed size: 433 != 0");
        console.error("Bad uncompressed size: 433 != 0");
        console.error("Bad compressed size: 100 != 0");
        console.error("unrelated parser error");
        return { SheetNames: ["Sheet1"] };
      },
    });

    assert.deepEqual(workbook.SheetNames, ["Sheet1"]);
    assert.deepEqual(forwardedErrors, ["unrelated parser error"]);
    assert.deepEqual(summaries, ["[xlsx:test-import] archive size metadata mismatch: 3 warning(s), 2 unique"]);
    assert.equal(console.error, captureError);
  } finally {
    console.error = previousError;
  }
});

test("console error handling is restored when workbook parsing fails", () => {
  const previousError = console.error;
  const captureError = () => {};
  console.error = captureError;
  try {
    assert.throws(() => readXlsxWorkbook(Buffer.from("test"), {}, {
      context: "failed-import",
      logger: { warn: () => {} },
      reader: () => {
        console.error("Bad uncompressed size: 10 != 0");
        throw new Error("invalid workbook");
      },
    }), /invalid workbook/);
    assert.equal(console.error, captureError);
  } finally {
    console.error = previousError;
  }
});
