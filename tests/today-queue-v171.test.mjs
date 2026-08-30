import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

test("V180 replaces the daily queue entry point with recent history", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /const APP_VERSION = 213;/);
  assert.match(html, /data-menu-view="today"[^>]*title="未回答・苦手・全問題から学習を始める"/);
  assert.match(html, /<span>学習する<\/span>/);
  assert.doesNotMatch(html, /<span class="quick-start-title">今日の10問/);
  assert.match(html, /function renderRecentHistoryViewV180\(/);
  assert.match(html, /直近解答履歴/);
  assert.match(html, /data-menu-status="latest-x"><span class="menu-status-filter-label">直近 /);
  assert.doesNotMatch(html, /直近の採点が×・△の問題を優先します/);
  assert.doesNotMatch(html, /×・△を優先して復習/);
  assert.doesNotMatch(html, /直近3回に×・△あり/);
});
