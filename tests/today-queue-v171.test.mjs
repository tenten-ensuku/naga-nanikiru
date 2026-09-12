import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

test("V180 replaces the daily queue entry point with recent history", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /const APP_VERSION = 239;/);
  const navigation = html.match(/<nav class="menu-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(navigation, /data-menu-view="today"[^>]*title="選択中の本の学習に戻る"/);
  assert.match(navigation, /data-menu-view="today"[^>]*>[\s\S]*?<span>学ぶ<\/span>/);
  assert.doesNotMatch(navigation, /data-menu-view="analysis"/);
  assert.match(html, /data-book-view="analysis">この本の成績<\/button>/);
  assert.doesNotMatch(html, /<span class="quick-start-title">今日の10問/);
  assert.match(html, /function renderRecentHistoryViewV180\(/);
  assert.match(html, /直近解答履歴/);
  assert.match(html, /data-menu-status="latest-x"><span class="menu-status-filter-label">直近 /);
  assert.doesNotMatch(html, /直近の採点が×・△の問題を優先します/);
  assert.doesNotMatch(html, /×・△を優先して復習/);
  assert.doesNotMatch(html, /直近3回に×・△あり/);
});
