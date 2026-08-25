import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);
const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const identityUrl = new URL("../app/lib/appIdentity.ts", import.meta.url);

test("V161 exposes the daily-learning shell and synchronized release assets", async () => {
  const [html, css, identity] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(identityUrl, "utf8"),
  ]);

  assert.match(html, /const APP_VERSION = 164;/);
  assert.match(identity, /APP_VERSION = 164/);
  assert.match(html, /ux-v159\.css\?v=164/);
  assert.match(html, /data-menu-view="today"/);
  assert.match(html, /今日の10問/);
  assert.match(html, /function renderTodayViewV159\(/);
  assert.match(html, /data-today-session="\$\{startMode\}"/);
  assert.match(css, /\.today-dashboard/);
  assert.match(css, /\.today-primary-action/);
  assert.doesNotMatch(css, /gradient\s*\(/i);
});

test("V161 keeps account actions compact and removes the obsolete share-copy control", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.doesNotMatch(html, /id="copyShareUrlButton"/);
  assert.doesNotMatch(html, /copyShareUrlButton/);
  assert.match(html, /data-menu-view="settings"/);
  assert.match(html, /id="discordAuthButton"/);
});

test("V161 keeps generator input and destination in a persistent staged workflow", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /const GENERATOR_DRAFT_KEY_V159 = "naga-nanikiru-generator-draft-v159";/);
  assert.match(html, /sessionStorage\.getItem\(GENERATOR_DRAFT_KEY_V159\)/);
  assert.match(html, /sessionStorage\.setItem\(GENERATOR_DRAFT_KEY_V159, JSON\.stringify\(draft\)\)/);
  assert.match(html, /function persistGeneratorFormDraftV157\(\)/);
  assert.match(html, /generatorForm\?\.addEventListener\("input", persistGeneratorFormDraftV157\)/);
  assert.match(html, /generatorForm\?\.addEventListener\("change", persistGeneratorFormDraftV157\)/);
  assert.match(html, /generator-progress/);
  for (const label of ["URLを入力", "解析", "候補を確認", "追加完了"]) assert.match(html, new RegExp(label));
  assert.match(html, /data-generator-capture-all/);
  assert.match(html, /data-generator-add-selected/);
  const generatorView = html.match(/function renderGeneratorViewV44\(\)[\s\S]*?function generatorCandidateChoiceMarkupV158/)?.[0] || "";
  assert.doesNotMatch(generatorView, /type="file"/);
});

test("V161 displays the canonical perfect mark while accepting legacy history", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /function normalizeScoreMarkV159\(value\)/);
  assert.match(html, /replaceAll\("💮", "◎"\)/);
  assert.match(html, /return normalizeScoreMarkV159\(value\) === "◎"/);
  assert.match(html, /直近2回連続で◎/);
});

test("V161 removes decorative outer rings while preserving result glyph styling", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /V160: keep the result glyphs, but remove the decorative outer rings/);
  assert.match(css, /\.page\.menu-active \.menu-card-latest-mark,\s*\.page\.menu-active \.today-recent-mark \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0;/);
  assert.match(css, /\.page\.menu-active \.menu-card-latest-mark\.is-excellent\s*\{[\s\S]*#ffcf5b/);
  assert.match(css, /\.page\.menu-active \.menu-card-latest-mark\.is-miss\s*\{[\s\S]*var\(--ux-coral\)/);
});

test("V161 keeps the archive action stable after saving", async () => {
  const html = await readFile(indexUrl, "utf8");
  const css = await readFile(cssUrl, "utf8");
  const archiveFlow = html.match(/function archiveCurrentQuestionV110\(\)[\s\S]*?\n      function applyQuestionV16\(/)?.[0] || "";
  assert.match(html, /let archiveActionStateV161 = \{ questionKey: "", phase: "idle" \};/);
  assert.match(html, /archiveButton\.textContent = actionState === "saving"[\s\S]*?"アーカイブ済み"/);
  assert.match(archiveFlow, /archiveActionStateV161 = \{ questionKey, phase: "saving" \};/);
  assert.match(archiveFlow, /archiveActionStateV161 = \{ questionKey, phase: "archived" \};/);
  assert.doesNotMatch(archiveFlow, /renderQuestionOptionsV16\(\);/);
  assert.doesNotMatch(archiveFlow, /renderMenuCardsV16\(\);/);
  assert.match(css, /V161: archive feedback stays in the action column/);
});

test("V163 keeps the basic-sequence collection in the South-seat viewpoint", async () => {
  const html = await readFile(indexUrl, "utf8");
  const builder = await readFile(new URL("../scripts/build-basic-sequence-source.mjs", import.meta.url), "utf8");
  const importer = await readFile(new URL("../scripts/import-basic-sequence.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(html, /tablePlayerNamesOverlay|table-player-name-replacement/);
  assert.match(html, /function isBasicSequenceCollectionV163\(/);
  assert.match(html, /function syncBasicSequenceThemeV163\(/);
  assert.match(html, /is-basic-sequence-collection/);
  assert.match(builder, /const REPORT_ID = "27ade94f05bb9ee180ccfaadb3ec85e45553cc8c7709913fb4a385b476351cdev2_2"/);
  assert.match(builder, /const VIEWER_TW = 1/);
  assert.match(builder, /rawPlayerSeat: RAW_PLAYER_SEAT/);
  assert.match(builder, /if \(questions\.length !== 89\)/);
  assert.match(builder, /actualDiscard !== question\.models\?\.\[0\]\?\.recommendation/);
  assert.doesNotMatch(builder, /tablePlayerNames|アンチョビ|ター子|順子さん/);
  assert.doesNotMatch(importer, /tablePlayerNames|アンチョビ|ター子|順子さん/);
  assert.match(importer, /title: "基本序列問題集"/);
});

test("V164 makes the collection targeted by visibility settings explicit", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /collection-management-context/);
  assert.match(html, /対象の問題集/);
  assert.match(html, /collectionDisplayNameV101\(collection\)/);
  assert.match(html, /aria-label="公開範囲の対象問題集"/);
  assert.match(html, /作成する問題集の公開範囲/);
});
