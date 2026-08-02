import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/naga-report/route.ts", import.meta.url), "utf8");

test("NAGA report proxy is fixed to the official reports host", () => {
  assert.match(source, /https:\/\/naga\.dmv\.nico\/reports\/\$\{reportId\}\.json/);
  assert.match(source, /REPORT_ID_PATTERN\.test\(reportId\)/);
  assert.doesNotMatch(source, /searchParams\.get\(["']url["']\)/);
});

test("NAGA report proxy limits payload size and cache lifetime", () => {
  assert.match(source, /MAX_REPORT_BYTES/);
  assert.match(source, /body\.byteLength > MAX_REPORT_BYTES/);
  assert.match(source, /s-maxage=3600/);
});
