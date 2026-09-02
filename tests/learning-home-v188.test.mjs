import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);
const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const identityUrl = new URL("../app/lib/appIdentity.ts", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("V210 keeps the learning actions usable and stable on desktop and mobile", async () => {
  const [html, css, identity, packageSource] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(identityUrl, "utf8"),
    readFile(packageUrl, "utf8")
  ]);

  assert.match(html, /const APP_VERSION = 219;/);
  assert.match(identity, /APP_VERSION = 219/);
  for (const asset of ["ux-v159\\.css", "supabase-sync-v48\\.js", "drill-ux-v44\\.js"]) {
    assert.match(html, new RegExp(`${asset}\\?v=219`));
  }
  assert.match(html, /問題集を変更する/);
  assert.doesNotMatch(html, /class="active-collection-label"/);
  assert.doesNotMatch(html, /<small>選択中の問題集<\/small>/);
  assert.match(html, /isSeriesParentCollectionV180\(sharedCollectionV46\) \? "collections" : "today"/);
  const switchCollection = html.match(/async function switchCollectionInPlaceV177\([\s\S]*?\n      function navigateToCollectionV106/)?.[0] || "";
  assert.match(switchCollection, /menuViewV16 = "today";/);
  assert.doesNotMatch(html, /COLLECTION LIBRARY/);
  assert.doesNotMatch(html, /選んだ問題集は次回も保持されます/);

  const sidebar = html.match(/<nav class="menu-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(sidebar, /data-menu-view="today"[^>]*>[\s\S]*?<span>学習する<\/span>/);
  assert.match(sidebar, /data-menu-view="today"[\s\S]*data-menu-view="analysis"[\s\S]*data-menu-view="generator"[\s\S]*data-menu-view="settings"/);
  assert.doesNotMatch(sidebar, /data-menu-view="my"/);

  const learningView = html.match(/function renderRecentHistoryViewV180\([\s\S]*?\n      \/\/ 旧セッション/)?.[0] || "";
  for (const action of ["unanswered", "weak", "all"]) {
    assert.match(html, new RegExp(`renderLearningActionButtonV194\\(\\{ mode: "${action}"`));
  }
  assert.match(learningView, /data-menu-jump="my"[\s\S]*data-menu-jump="favorites"[\s\S]*data-menu-jump="archive"/);
  assert.doesNotMatch(learningView, /data-menu-jump="today"/);
  const contextTabs = html.match(/<nav class="learning-tabs menu-context-tabs"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.ok(contextTabs, "problem-list context tabs should be present outside the learning dashboard");
  assert.match(contextTabs, /id="menuContextTabs"/);
  assert.match(contextTabs, /data-menu-jump="my"[\s\S]*data-menu-jump="favorites"[\s\S]*data-menu-jump="archive"/);
  assert.match(html, /document\.getElementById\("menuFilters"\)\.hidden = menuViewV16 !== "archive"/);
  assert.match(learningView, /class="learning-all-action"/);
  assert.doesNotMatch(learningView, /learning-hero|learning-path-note|learning-action-step|LEARNING PATH|RECENT ANSWERS|\bSTEP\b/);
  assert.match(html, /class="learning-header-progress"/);
  const customSettings = learningView.match(/<details class="learning-custom-settings"[\s\S]*?<\/details>/)?.[0] || "";
  assert.ok(customSettings, "custom settings details should be rendered");
  assert.equal((customSettings.match(/type="checkbox" data-learning-setting="order"/g) || []).length, 2);
  assert.equal((customSettings.match(/type="checkbox" data-learning-setting="genre"/g) || []).length, 3);
  assert.equal((customSettings.match(/type="checkbox" data-learning-setting="history"/g) || []).length, 5);
  assert.doesNotMatch(customSettings, /<select[^>]*data-learning-setting/);
  assert.match(customSettings, /data-learning-value="sequential"/);
  assert.match(customSettings, /data-learning-value="random"/);
  assert.doesNotMatch(customSettings, /data-learning-value="reverse"/);
  assert.match(customSettings, /複数選択可/);
  assert.match(customSettings, /この設定は「全問を解く」にのみ適用されます/);
  assert.match(learningView, /直近×・△/);

  assert.match(html, /function learningWeakQuestionsV189\([^)]*\)/);
  assert.match(html, /\["×", "△"\]\.includes\(mark\)/);
  assert.match(html, /function startLearningSessionV189\(/);
  assert.match(html, /startSessionV44\(mode, candidates, \{ skipSharedPreparation: true \}\)/);
  assert.match(html, /function handleLearningSettingsChangeV189\(/);
  assert.match(html, /learningOrderV189/);
  assert.match(html, /learningGenresV189/);
  assert.match(html, /learningHistoryFiltersV189/);
  assert.match(html, /mode === "all" && learningOrderV189 === "random"/);
  assert.match(html, /カスタム設定は「全問を解く」だけに適用し/);
  assert.match(html, /action === "weak" \|\| action === "all"/);

  assert.match(css, /V189: checkbox-based custom filters/);
  assert.match(css, /\.learning-tabs/);
  assert.match(css, /\.learning-action-grid/);
  assert.match(css, /\.learning-custom-settings/);
  assert.match(css, /\.learning-check input:checked/);
  assert.match(css, /V191: keep the list shortcuts visible after entering the problem list/);
  assert.match(css, /V193: clarify the app header and give the current collection more room/);
  assert.match(css, /V194: make the three learning entry points feel like clear, premium actions/);
  assert.match(css, /V194: recent rows now expose personal organization without nesting buttons/);
  assert.match(css, /V203: turn the learning entries into a stable three-column action rail on desktop/);
  assert.match(css, /V204: make the header identity and learning cards read as compact primary actions/);
  assert.match(css, /V205: separate the PC brand row from its account and notice controls/);
  assert.match(css, /V206: reserve separate title, status, and arrow areas in the collection switcher/);
  assert.match(css, /V207: use the supplied Min-Kiru wordmark without mixing brand and account controls/);
  assert.match(css, /\.menu-brand-logo-wrap/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 18px/);
  assert.match(css, /active-collection-button > \.active-collection-arrow \{[\s\S]*?position: static;[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1 \/ -1;/);
  assert.match(css, /grid-template-areas: "tile copy" "actions actions"/);
  assert.match(css, /\.menu-brand-actions #discordAuthButton \{[\s\S]*?width: auto;/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.learning-all-action > \.learning-custom-settings/);
  assert.match(css, /learning-custom-settings:not\(\[open\]\) > \.learning-custom-settings-body/);
  assert.match(html, /<summary aria-label="全問を解くの設定">[\s\S]*条件設定/);
  assert.match(html, /function renderLearningActionButtonV194\(/);
  assert.match(html, /プレイ/);
  assert.match(html, /class="menu-brand-logo" src="assets\/min-kiru-header\.png" alt="みん切る（みんなの何切る問題集）"/);
  assert.match(html, /class="menu-brand-actions"[\s\S]*id="discordAuthButton"/);
  assert.match(html, /id="accountStatus"/);
  const learningActionRenderer = html.match(/function renderLearningActionButtonV194\([\s\S]*?\n      \}/)?.[0] || "";
  assert.match(learningActionRenderer, /class="learning-action-link"><span>プレイ<\/span><\/span>/);
  assert.doesNotMatch(learningActionRenderer, /aria-hidden="true">→/);
  assert.match(css, /\.learning-action-card \.learning-action-link \{\s*display: none;/);
  assert.match(css, /\.learning-action-card \.learning-action-description \{[\s\S]*white-space: normal;/);
  assert.match(learningView, /data-menu-action="favorite"/);
  assert.match(learningView, /data-menu-action="archive"/);
  assert.match(learningView, /aria-label="問題\$\{escapeHtml\(String\(question\.number\)\)\}の整理"/);
  assert.match(html, /publishedAt: "2026-08-30T12:00:00\+09:00"/);
  assert.match(html, /function formatAnnouncementDateV111\(/);
  assert.ok(css.indexOf("/* V189: checkbox-based custom filters") > css.indexOf(".learning-custom-settings-body select"), "V189 checkbox styles should come after legacy select styles");

  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["test:drill"], /tests\/learning-home-v188\.test\.mjs/);
});
