import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);

test("V131 scopes personal archive and favorite state by user and collection", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /const APP_VERSION = 134/);
  assert.match(html, /function personalCollectionScopeKeyV131\(/);
  assert.match(html, /supabaseSessionV46\?\.user\?\.id/);
  assert.match(html, /sharedCollectionV46\?\.share_slug/);
  assert.match(html, /function personalCollectionStateV131\(/);
  assert.match(html, /function canUsePersonalCollectionStateV131\(/);
  assert.match(html, /personalCollectionStateV131\(\)\.archived/);
  assert.match(html, /personalCollectionStateV131\(\)\.favorites/);
});

test("V131 shows list archive action only after a recent 💮 result", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /function canArchiveFromMenuV131\(/);
  assert.match(html, /latestAnswerV44\(question\)\?\.scoreMark === "💮"/);
  assert.match(html, /data-menu-action="archive"/);
  assert.match(html, /直近の結果が💮です。問題集ごとのアーカイブに移します/);
});

test("V131 adds hover explanations to the main navigation and archive column", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /data-menu-view="favorites"[^>]*title="この問題集でお気に入りに登録した問題を見る"/);
  assert.match(html, /title="直近の結果が💮の問題だけ、ここからアーカイブに移せます"/);
  assert.match(html, /title="問題を整理する"/);
});
