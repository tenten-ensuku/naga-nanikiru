import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);
const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const identityUrl = new URL("../app/lib/appIdentity.ts", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("V188 makes learning the action-first home for the selected collection", async () => {
  const [html, css, identity, packageSource] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(identityUrl, "utf8"),
    readFile(packageUrl, "utf8")
  ]);

  assert.match(html, /const APP_VERSION = 188;/);
  assert.match(identity, /APP_VERSION = 188/);
  for (const asset of ["ux-v159\\.css", "supabase-sync-v48\\.js", "drill-ux-v44\\.js"]) {
    assert.match(html, new RegExp(`${asset}\\?v=188`));
  }

  const sidebar = html.match(/<nav class="menu-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(sidebar, /data-menu-view="today"[^>]*>[\s\S]*?<span>学習する<\/span>/);
  assert.match(sidebar, /data-menu-view="today"[\s\S]*data-menu-view="analysis"[\s\S]*data-menu-view="generator"[\s\S]*data-menu-view="settings"/);
  assert.doesNotMatch(sidebar, /data-menu-view="my"/);

  const learningView = html.match(/function renderRecentHistoryViewV180\([\s\S]*?\n      \/\/ 旧セッション/)?.[0] || "";
  for (const action of ["unanswered", "weak", "all"]) {
    assert.match(learningView, new RegExp(`data-learning-action="${action}"`));
  }
  for (const tab of ["favorites", "archive", "my", "today"]) {
    assert.match(learningView, new RegExp(`data-menu-jump="${tab}"`));
  }
  assert.match(learningView, /details class="learning-custom-settings"/);
  assert.match(learningView, /data-learning-setting="order"/);
  assert.match(learningView, /data-learning-setting="genre"/);
  assert.match(learningView, /直近×・△/);

  assert.match(html, /function learningWeakQuestionsV188\([^)]*\)/);
  assert.match(html, /\["×", "△"\]\.includes\(mark\)/);
  assert.match(html, /function startLearningSessionV188\(/);
  assert.match(html, /startSessionV44\(mode, candidates, \{ skipSharedPreparation: true \}\)/);
  assert.match(html, /function handleLearningSettingsChangeV188\(/);
  assert.match(html, /action === "weak" \|\| action === "all"/);

  assert.match(css, /V188: make learning the single, action-first home/);
  assert.match(css, /\.learning-tabs/);
  assert.match(css, /\.learning-action-grid/);
  assert.match(css, /\.learning-custom-settings/);

  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["test:drill"], /tests\/learning-home-v188\.test\.mjs/);
});
