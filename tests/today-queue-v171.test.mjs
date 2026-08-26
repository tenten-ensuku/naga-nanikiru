import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

test("V171 shows the today's-session composition and latest-X definition", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /const APP_VERSION = 179;/);
  assert.match(html, /data-session-mode="recommended"/);
  assert.match(html, /未回答8問＋直近×2問を基本に出題/);
  assert.match(html, /未回答8問と直近の回答が×の問題を最大2問出題します/);
  assert.match(html, /直近の回答が×の問題を優先します/);
  assert.match(html, /data-menu-status="latest-x"><span class="menu-status-filter-label">直近 /);
  assert.match(html, /直近の回答が×<\/small>/);
  assert.doesNotMatch(html, /直近の採点が×・△の問題を優先します/);
  assert.doesNotMatch(html, /×・△を優先して復習/);
  assert.doesNotMatch(html, /直近3回に×・△あり/);
});
