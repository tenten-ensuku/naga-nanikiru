import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);
const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const identityUrl = new URL("../app/lib/appIdentity.ts", import.meta.url);

test("V168 exposes the daily-learning shell and synchronized release assets", async () => {
  const [html, css, identity] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(identityUrl, "utf8"),
  ]);

  assert.match(html, /const APP_VERSION = 171;/);
  assert.match(identity, /APP_VERSION = 171/);
  assert.match(html, /ux-v159\.css\?v=171/);
  assert.match(html, /data-menu-view="today"/);
  assert.match(html, /今日の10問/);
  assert.match(html, /function renderTodayViewV159\(/);
  assert.match(html, /data-today-session="\$\{startMode\}"/);
  assert.match(css, /\.today-dashboard/);
  assert.match(css, /\.today-primary-action/);
  assert.match(css, /--ux-brown-gold: #b78943/);
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

test("V165 keeps the active collection visible and opens a dedicated chooser", async () => {
  const [html, css] = await Promise.all([readFile(indexUrl, "utf8"), readFile(cssUrl, "utf8")]);
  assert.match(html, /data-open-collection-chooser/);
  assert.match(html, /data-active-collection-name/);
  assert.match(html, /class="mobile-collection-context"/);
  assert.match(html, /function renderActiveCollectionContextV165\(/);
  assert.match(html, /function renderCollectionChooserV165\(/);
  assert.match(html, /ACTIVE_COLLECTION_KEY_V165 = storageKey\("active-collection-v1"\)/);
  assert.match(html, /return collectionSlugFromUrlV165\(\) \|\| rememberedCollectionSlugV165\(\)/);
  assert.match(html, /rememberCollectionSlugV165\(shareSlug\)/);
  assert.match(html, /menuViewV16 = "collections"/);
  assert.match(css, /\.active-collection-button/);
  assert.match(css, /linear-gradient\(145deg, #5a3b22/);
  assert.match(css, /\.collection-choice-grid/);
  assert.match(css, /position: sticky;[\s\S]*?\.page\.menu-active \.mobile-collection-context|\.page\.menu-active \.mobile-collection-context[\s\S]*?position: sticky;/);
});

test("V166 puts basic sequence first, recommends sequential order, and shows ten recent questions", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /function sortCollectionRowsV166\(rows\)/);
  assert.match(html, /const leftBasic = isBasicSequenceCollectionV163\(left\) \? 0 : 1/);
  assert.match(html, /const sequentialOption = menuOrderSelect\?\.querySelector\('option\[value="sequential"\]'\)/);
  assert.match(html, /sequentialOption\.textContent = isBasicSequence \? "順番（推奨）" : "順番"/);
  assert.match(html, /const sequentialCandidates = isBasicSequenceCollectionV163\(\)/);
  const todayView = html.match(/function renderTodayViewV159\([\s\S]*?function renderMenuCardsV16\(/)?.[0] || "";
  assert.match(todayView, /\.slice\(0, 10\)/);
});

test("V167 styles the collection chooser as a three-column library with a silver basic-sequence card", async () => {
  const [html, css] = await Promise.all([readFile(indexUrl, "utf8"), readFile(cssUrl, "utf8")]);
  assert.match(html, /function collectionChooserCardClassV167\(row, current\)/);
  assert.match(html, /collectionChooserCardClassV167\(row, current\)/);
  assert.match(html, /isBasicSequenceCollectionV163\(row\)/);
  assert.match(css, /V167: present the collection chooser as a calm library/);
  assert.match(css, /\.page\.menu-active:has\(\.collection-chooser\) \.menu-heading/);
  assert.match(css, /\.page\.menu-active \.collection-choice-grid\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.page\.menu-active \.collection-choice-card\.is-basic-sequence\s*\{[\s\S]*?linear-gradient/);
  assert.match(css, /\.page\.menu-active \.collection-choice-card\.is-basic-sequence \.collection-choice-card-meta/);
});

test("V168 scopes today's resume session to the collection and repairs legacy question keys", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /function currentCollectionScopeKeyV167\(\)/);
  assert.match(html, /return String\(selectedCollectionSlugV165\(\) \|\| sharedCollectionV46\?\.share_slug/);
  assert.match(html, /function sessionQuestionIndexV167\(key\)/);
  assert.match(html, /function sessionBelongsToCurrentCollectionV167\(session\)/);
  assert.match(html, /session\.collectionSlug = currentCollectionScopeKeyV167\(\);/);

  const resumeBody = html.match(/function startSessionV44\(mode, explicitQuestions = null\) \{[\s\S]*?\n      \}/)?.[0] || "";
  assert.match(resumeBody, /if \(mode === "resume"\)/);
  assert.match(resumeBody, /sessionQuestionIndexV167\(key\)/);
  assert.match(resumeBody, /current\.questionKeys = \[\.\.\.new Set\(resolvedEntries\.map/);
  assert.match(resumeBody, /openQuestionV16\(questionIndexByKeyV44\(target\.key\), \{ preserveSession: true \}\)/);
});

test("V169 keeps question organization on the answered-question screen only", async () => {
  const html = await readFile(indexUrl, "utf8");
  const menuRender = html.match(/function renderMenuCardsV16\(\)[\s\S]*?\n      function openQuestionManageV44/)?.[0] || "";
  assert.doesNotMatch(menuRender, /menu-card-row-manage/);
  assert.doesNotMatch(menuRender, /data-menu-action="manage"/);
  const answerStrip = html.match(/<section class="answer-strip"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(answerStrip, /id="currentManageButton"/);
  const answerRender = html.match(/function renderAnswerV16\(\)[\s\S]*?\n      function selectCallV16/)?.[0] || "";
  assert.match(answerRender, /if \(!state\.revealed\)/);
  assert.match(answerRender, /answerStrip\.hidden = true/);
});
