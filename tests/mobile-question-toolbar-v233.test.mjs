import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexPath = new URL("../public/index.html", import.meta.url);
const cssPath = new URL("../public/ux-v159.css", import.meta.url);

function normalizeNewlines(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${name} should end before ${nextName}`);
  return source.slice(start, end);
}

test("V233 aligns the mobile toolbar version, labels, and accessible names", async () => {
  const html = await readFile(indexPath, "utf8");
  assert.match(html, /const APP_VERSION = 239;/);
  assert.match(html, /ux-v159\.css\?v=239/);
  assert.match(html, /legacy-transfer-v232\.js\?v=239/);

  const sourceBar = html.match(/<div class="source-bar">[\s\S]*?<\/div>\s*\n\s*<div class="session-strip"/)?.[0] || "";
  assert.ok(sourceBar, "question source bar should remain a single toolbar block");
  assert.match(sourceBar, /id="nagaSourceLink"[^>]*aria-label="局面NAGAURLに移動"/);
  assert.match(sourceBar, /<span class="question-toolbar-label-full">局面NAGAURLに移動<\/span>/);
  assert.match(sourceBar, /<span class="question-toolbar-label-short" aria-hidden="true">NAGAへ移動<\/span>/);
  assert.match(sourceBar, /id="importQuestionButton"[^>]*aria-label="自分の問題集にインポート"/);
  assert.match(sourceBar, /<span class="question-toolbar-label-full">自分の問題集にインポート<\/span>/);
  assert.match(sourceBar, /<span class="question-toolbar-label-short" aria-hidden="true">インポート<\/span>/);
  assert.match(sourceBar, /id="menuButton"[^>]*aria-label="問題一覧へ戻る"/);
  assert.match(sourceBar, /<span class="question-toolbar-label-full">問題一覧へ戻る<\/span>/);
  assert.match(sourceBar, /<span class="question-toolbar-label-short" aria-hidden="true">一覧へ<\/span>/);
  const navigation = functionBlock(html, "renderBookNavigationV234", "isLegacyGeneratedQuestionCommentV220");
  assert.match(navigation, /back\.setAttribute\("aria-label", originLabel\)/);
  assert.match(navigation, /back\.querySelector\("\.question-toolbar-label-full"\)\.textContent = originLabel/);
  for (const label of ["この本の学習へ", "この本の成績へ", "アーカイブへ", "問題一覧へ戻る"]) assert.ok(navigation.includes(`"${label}"`), label);
  assert.match(html, /getElementById\("menuButton"\)\.addEventListener\("click", \(\) => showMenuV16\(questionOriginViewV234\)\)/);
  assert.match(sourceBar, /id="questionSelect" aria-label="問題を選ぶ"/);
  assert.match(sourceBar, /id="modelSelect" aria-label="正誤判定基準"/);
});

test("V233 keeps the compact mobile source bar override intact alongside later release styles", async () => {
  const css = normalizeNewlines(await readFile(cssPath, "utf8"));
  const marker = "/* V233: compact mobile question toolbar.";
  const markerIndex = css.lastIndexOf(marker);
  assert.ok(markerIndex >= 0, "V233 CSS marker should exist");
  const v233 = css.slice(markerIndex).split(/\n\/\* V\d+:/)[0];
  const previousCss = css.slice(0, markerIndex);
  assert.match(v233, /@media\s*\(max-width:\s*800px\)/);
  assert.match(v233, /\.page:not\(\.menu-active\)\s*\{[\s\S]*?padding-top:\s*4px;/);
  assert.match(v233, /\.page:not\(\.menu-active\)\s*>\s*\.header\s*\{[\s\S]*?margin-bottom:\s*4px;/);
  assert.match(v233, /\.page:not\(\.menu-active\)\s*>\s*\.source-bar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(84px,\s*1fr\)\s+minmax\(0,\s*1\.35fr\)\s+max-content;[\s\S]*?padding:\s*6px;[\s\S]*?margin-bottom:\s*4px;/);
  assert.match(previousCss, /\.page:not\(\.menu-active\)\s*>\s*\.source-bar\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*1fr\s+1fr;/);
  assert.match(css, /\.source-url\s*\{[\s\S]*?white-space:\s*nowrap;/);
  assert.match(v233, /\.page:not\(\.menu-active\)\s+\.source-url\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
  assert.match(v233, /\.page:not\(\.menu-active\)\s+\.source-link,[\s\S]*?\.import-question-button,[\s\S]*?\.menu-button\s*\{[\s\S]*?min-height:\s*30px;[\s\S]*?padding:\s*0\s+7px;[\s\S]*?font-size:\s*11px;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(v233, /\.page:not\(\.menu-active\)\s+\.question-toolbar-label-full\s*\{\s*display:\s*none;/);
  assert.match(v233, /\.page:not\(\.menu-active\)\s+\.question-toolbar-label-short\s*\{\s*display:\s*inline;/);
  assert.match(v233, /\.page:not\(\.menu-active\)\s*>\s*\.scene-card\s*\{\s*margin-top:\s*4px;/);
  assert.doesNotMatch(v233, /\.(?:hand|tile|answer|score|riichi)-[a-z-]+\s*\{/i, "V233 must not add hand or answer selectors");
});

test("V233 preserves the hand display and answer interaction contracts", async () => {
  const html = normalizeNewlines(await readFile(indexPath, "utf8"));
  assert.match(html, /<section class="scene-card"[^>]*aria-label="NAGA局面スクリーンショット">/);
  assert.match(html, /<div class="hand-layer" id="handLayer" aria-label="選択できる自分の手牌"><\/div>/);
  assert.match(html, /<div class="hand-score" id="handScoreBadge" aria-live="polite" hidden><\/div>/);
  assert.match(html, /<div class="answer-confirmation-choice" id="answerConfirmationChoice"><\/div>/);
  assert.match(html, /<button class="answer-confirm-button" id="confirmAnswerButton" type="button">この回答で確定<\/button>/);

  const tileBody = functionBlock(html, "tileButtonV16", "probabilityStackV16");
  assert.match(tileBody, /state\.selectedIndex === index/);
  assert.match(tileBody, /data-tile-index="\$\{index\}"/);
  assert.match(tileBody, /aria-label="\$\{tileLabel\(tile\)\}を選ぶ/);

  const handBody = functionBlock(html, "renderHandV16", "callActionOptionsV112");
  assert.match(handBody, /displayHandSlotsV212\(SCENE\)/);
  assert.match(handBody, /tileButtonV16\(tile, index\)/);
  assert.match(handBody, /data-tile-index/);
  assert.match(handBody, /selectTileV16\(Number\(button\.dataset\.tileIndex\)\)/);
  assert.match(handBody, /sceneFrameV16\.classList\.toggle\("is-call-decision"/);

  const scoreBody = functionBlock(html, "choiceScoreV16", "renderChoiceScoreV16");
  assert.match(scoreBody, /state\.selected/);
  assert.match(scoreBody, /score-first/);
  assert.match(scoreBody, /score-partial/);
  assert.match(scoreBody, /score-bad/);

  const renderScoreBody = functionBlock(html, "renderChoiceScoreV16", "renderAnswerConfirmationV41");
  assert.match(renderScoreBody, /handScoreBadge/);
  assert.match(renderScoreBody, /choiceScoreV16\(\)/);
  assert.match(renderScoreBody, /badge\.setAttribute\("aria-label"/);

  const selectBody = functionBlock(html, "selectTileV16", "toggleRiichiV16");
  assert.match(selectBody, /requireLoginForPlayV187\(\)/);
  assert.match(selectBody, /state\.selectedIndex = index/);
  assert.match(selectBody, /state\.selected = tiles\[index\]/);
  assert.match(selectBody, /renderHandV16\(\)/);
  assert.match(selectBody, /renderAnswerV16\(\)/);

  const resetBody = functionBlock(html, "resetV16", "handMaskMeldCountV144");
  assert.match(resetBody, /state\.selected = null/);
  assert.match(resetBody, /state\.selectedIndex = null/);
  assert.match(resetBody, /renderHandV16\(\)/);
  assert.match(resetBody, /renderAnswerV16\(\)/);

  const confirmBody = functionBlock(html, "confirmAnswerV41", "resetV16");
  assert.match(confirmBody, /requireLoginForPlayV187\(\)/);
  assert.match(confirmBody, /state\.revealed = true/);
  assert.match(confirmBody, /recordAnswerV16\(\)/);
  assert.match(confirmBody, /renderHandV16\(\)/);
  assert.match(confirmBody, /renderAnswerV16\(\)/);
});
