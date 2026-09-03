import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);

test("V131 scopes personal archive and favorite state by user and collection", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /const APP_VERSION = 226/);
  assert.match(html, /function personalCollectionScopeKeyV131\(/);
  assert.match(html, /supabaseSessionV46\?\.user\?\.id/);
  assert.match(html, /sharedCollectionV46\?\.share_slug/);
  assert.match(html, /function personalCollectionStateV131\(/);
  assert.match(html, /function canUsePersonalCollectionStateV131\(/);
  assert.match(html, /personalCollectionStateV131\(\)\.archived/);
  assert.match(html, /personalCollectionStateV131\(\)\.favorites/);
});

test("V159 shows list archive action only after a recent ◎ result", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /function canArchiveFromMenuV131\(/);
  assert.match(html, /isPerfectScoreMarkV159\(latestAnswerV44\(question\)\?\.scoreMark\)/);
  assert.match(html, /data-menu-action="archive"/);
  assert.match(html, /直近の結果が◎です。問題集ごとのアーカイブに移します/);
});

test("V138 separates range selection from favorite and archive filters", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.doesNotMatch(html, /data-menu-view="favorites"/);
  assert.match(html, /const MENU_RANGE_STEP_V137 = 100/);
  assert.match(html, /id="menuRangeSelect"/);
  assert.match(html, /id="menuRangeAllButton"/);
  assert.match(html, /id="menuRangePreviousButton"/);
  assert.match(html, /id="menuRangeNextButton"/);
  assert.match(html, /id="menuFavoritesToggle"/);
  assert.match(html, /menuFavoritesOnlyV137/);
  assert.match(html, /id="menuArchiveViewButton"/);
  assert.doesNotMatch(html, /menu-range-tabs/);
  assert.doesNotMatch(html, /menu-range-tab/);
  assert.doesNotMatch(html, /data-menu-range=/);
  assert.match(html, /title="直近の結果が◎の問題だけ、ここからアーカイブに移せます"/);
  assert.doesNotMatch(html, /data-menu-action="manage"/);
  assert.match(html, /id="menuActiveFilters"/);
  assert.match(html, /function renderMenuActiveFiltersV138\(\)/);
  assert.match(html, /function clearMenuFilterV138\(filterKey\)/);
});

test("V138 keeps archive as an independent view while range remains numeric", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /const options = \[\{ key: "all", label: "すべて" \}\]/);
  assert.match(html, /function menuNumericRangeOptionsV137\(\)/);
  assert.match(html, /function renderMenuRangeControlsV137\(\)/);
  assert.match(html, /archiveButton\.innerHTML = archiveActive \? "問題一覧に戻る" : `\$\{menuArchiveIconV109\(\)\}<span>アーカイブを見る<\/span>`/);
  assert.match(html, /menuViewV16 === "archive"/);
});

test("V138 compacts the collection context without removing existing controls", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /class="collection-info-details"/);
  assert.match(html, />問題集情報<\/summary>/);
  assert.match(html, /id="collectionDirectorySelect"/);
  assert.match(html, /id="collectionCreateOpenButton"/);
  assert.doesNotMatch(html, /id="menuViewNote"/);
  assert.match(html, /<fieldset class="menu-status-filter-group">[\s\S]*<span class="sr-only">回答状態<\/span>[\s\S]*<\/fieldset>/);
  assert.doesNotMatch(html, /回答状態（複数選択可）/);
});
