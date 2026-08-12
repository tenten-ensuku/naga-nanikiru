import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionSource = await readFile(new URL("../supabase/functions/naga-capture/index.ts", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../client/supabase-sync.ts", import.meta.url), "utf8");

test("NAGA capture is authenticated and bound to the caller generation job", () => {
  assert.match(functionSource, /supabase\.auth\.getUser\(\)/);
  assert.match(functionSource, /\.from\("generation_jobs"\)/);
  assert.match(functionSource, /\.eq\("requested_by", authData\.user\.id\)/);
  assert.match(functionSource, /\.eq\("source_report_id", reportId\)/);
  assert.match(functionSource, /job\.status !== "completed"/);
});

test("NAGA capture only opens an official canonical scene URL", () => {
  assert.match(functionSource, /new URL\("https:\/\/naga\.dmv\.nico\/htmls\/report_viewer\.html"\)/);
  assert.match(functionSource, /REPORT_ID_PATTERN\.test\(reportId\)/);
  assert.doesNotMatch(functionSource, /input\.sourceUrl/);
});

test("NAGA capture preserves the full generated board including the bottom hand", () => {
  assert.match(functionSource, /\.column\.is-three-quarter img/);
  assert.match(functionSource, /data:image\/png;base64/);
  assert.match(functionSource, /width: 1400, height: 1300/);
  assert.match(functionSource, /height:1300px/);
  assert.match(functionSource, /type: "webp"/);
  assert.match(functionSource, /MAX_IMAGE_BYTES/);
});

test("NAGA capture always finishes with the official hidden-hands setting enabled", () => {
  assert.match(functionSource, /data-off-label="伏牌"/);
  assert.match(functionSource, /setOtherHandsHidden\(false\)/);
  assert.match(functionSource, /setOtherHandsHidden\(true\)/);
  assert.match(functionSource, /checkbox\.click\(\)/);
  assert.match(functionSource, /checkbox\?\.checked === expected/);
});

test("NAGA capture accepts Browserless binary and JSON-wrapped screenshots", () => {
  assert.match(functionSource, /decodeBrowserlessJson/);
  assert.match(functionSource, /upstreamContentType === "application\/json"/);
  assert.match(functionSource, /detectImageType\(image\)/);
  assert.match(functionSource, /String\.fromCharCode\(\.\.\.bytes\.slice\(8, 12\)\) === "WEBP"/);
  assert.match(functionSource, /return await page\.screenshot/);
});

test("capture provider token stays server-side and the browser receives a binary image", () => {
  assert.match(functionSource, /Deno\.env\.get\("BROWSERLESS_API_TOKEN"\)/);
  assert.doesNotMatch(clientSource, /BROWSERLESS_API_TOKEN/);
  assert.match(clientSource, /\/functions\/v1\/naga-capture/);
  assert.match(clientSource, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(clientSource, /response\.blob\(\)/);
});
