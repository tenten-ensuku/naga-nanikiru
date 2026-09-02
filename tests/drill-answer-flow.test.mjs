import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../public/index.html", import.meta.url);

async function source() {
  return readFile(sourceUrl, "utf8");
}

function functionBody(html, name, nextName) {
  const pattern = new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n      function ${nextName}\\(`);
  const match = pattern.exec(html);
  assert.ok(match, `${name} should be present before ${nextName}`);
  return match[1];
}

test("requires explicit confirmation before revealing or recording an answer", async () => {
  const html = await source();
  assert.match(html, /id="confirmAnswerButton"[^>]*>この回答で確定<\/button>/);

  const callBody = functionBody(html, "selectCallV16", "selectTileV16");
  assert.doesNotMatch(callBody, /state\.revealed\s*=\s*true/);
  assert.doesNotMatch(callBody, /recordAnswerV16\(\)/);

  const tileBody = functionBody(html, "selectTileV16", "toggleRiichiV16");
  assert.doesNotMatch(tileBody, /state\.revealed\s*=\s*true/);
  assert.doesNotMatch(tileBody, /recordAnswerV16\(\)/);

  const confirmBody = functionBody(html, "confirmAnswerV41", "resetV16");
  assert.match(confirmBody, /state\.revealed\s*=\s*true/);
  assert.match(confirmBody, /recordAnswerV16\(\)/);
});

test("records answer timing and exposes the synchronized drill version", async () => {
  const html = await source();
  assert.match(html, /const APP_VERSION = 220;/);
  assert.match(html, /const MODEL_PRIORITY = \["ニシキ", "ヒバカリ", "カガシ", "ガンマ", "オメガ"\];/);
  assert.match(html, /const HAND_BAR_MODEL_NAMES = \["ニシキ", "ヒバカリ", "カガシ"\];/);
  assert.match(html, /const topCallModelIndices = priorityIndicesV16\(3\);/);
  assert.match(html, /const topModelIndices = priorityIndicesV16\(3\);/);
  assert.match(html, /indices\.sort\(\(a, b\) => modelPriorityRank\(a\) - modelPriorityRank\(b\)\)/);
  assert.match(html, /id="answerPollPanel"/);
  assert.match(html, /void refreshQuestionPollStatsV110\(\)/);
  assert.match(html, /archiveCurrentQuestionV110/);
  assert.match(html, /function nextFilteredQuestionV87\(\)/);
  assert.match(html, /id="nextQuestionBottomButton"/);
  assert.match(html, /function latestAnswerV44\(question\)[\s\S]*?\.sort\(/);
  assert.match(html, /const unansweredOnly = mode === "unanswered" \|\| mode === "range-unanswered"/);
  assert.match(html, /responseTimeMs:\s*Math\.max\(0, confirmedAt - startedAt\)/);
  assert.match(html, /startedAt:\s*new Date\(startedAt\)\.toISOString\(\)/);
  assert.match(html, /const historicalCard = SCENE\.actualDiscard \?/);
  assert.match(html, /function callActionProbabilityV112\(action, index\) \{[\s\S]*?return questionCallProbabilityV112\(SCENE, action, index\);/);
  assert.doesNotMatch(html, /questionCallActionProbabilityV112/);
});

test("uses pass-through wording and a call recommendation percentage for every call result", async () => {
  const html = await source();
  assert.match(html, /function callActionLabelV112\(action\)[\s\S]*?return "スルー";/);
  assert.match(html, /function callRecommendationProbabilityV112\(index\)/);
  assert.match(html, /副露推奨度 \$\{value\.toFixed\(1\)\}%/);
  assert.doesNotMatch(html, /副露推奨度50％以下はスルー推奨/);
  assert.doesNotMatch(html, /answer-choice-reach-label">\$\{selectedLabel\}/);
});

test("detects self-meld hand masks from dark-blue panels and image-bottom panels", async () => {
  const html = await source();
  const body = functionBody(html, "detectHandMaskV17", "clearHandMaskV17");
  assert.match(body, /backgroundBlue/);
  assert.match(body, /backgroundBlue\(y\) - rgb\[2\] >= 18/);
  assert.match(body, /if \(top >= 0 && bottom < 0\) bottom = height - 1/);
  assert.match(html, /const IMMEDIATE_CALL_TYPES_V132 = new Set\(\["chi", "pon", "daiminkan", "minkan", "ankan", "kakan"\]\)/);
  assert.match(html, /function isImmediateCallDiscardV132\(/);
  assert.match(html, /const isLegacyImmediate = question\?\.decisionType === "discard"[\s\S]*?handBeforeDraw\.length < 13[\s\S]*?question\?\.actualDiscard != null/);
  assert.match(html, /function displayConcealedHandV143\(/);
  assert.match(html, /generator\.displayConcealedHand\(question\)/);
  assert.match(html, /const displaySlots = displayHandSlotsV212\(SCENE\)/);
  assert.match(html, /displaySlots\.filter\(Boolean\)/);
  assert.match(html, /displaySlots\.map\(\(tile, index\) => tile == null \? emptyHandSlotV146\(\) : tileButtonV16\(tile, index\)\)/);
  assert.match(html, /sortHandV20\(displayHand\)/);
  assert.match(html, /const closedCount = displaySlots \? displaySlots\.length : displayConcealedHandV143\(question\)\.length/);
  assert.match(html, /const tileCount = closedCount \+ \(hasDraw \? 1 : 0\);/);
  assert.doesNotMatch(html, /immediate-meld-layer/);
  assert.doesNotMatch(html, /renderImmediateMeldsV132/);
  assert.doesNotMatch(html, /immediateMeldTileCountV132/);
  assert.match(html, /function handMaskMeldCountV144\(question\)/);
  const maskFallbackBody = functionBody(html, "handMaskFallbackV17", "rgbHexV17");
  assert.match(html, /function immediateCallPreviousMeldCountV152\(question\)/);
  assert.match(html, /function handMaskMeldCountForDisplayV152\(question\)/);
  assert.match(maskFallbackBody, /HAND_MASK_PRESETS_V128\[handMaskMeldCountForDisplayV152\(question\)\]/);
  assert.match(html, /0: \{ left: 11\.5, top: 79\.3, width: 67\.8, height: 20\.7/);
  assert.match(html, /const handMaskV18 = handMaskFallbackV17\(question\);/);
  assert.match(html, /sceneFrameV16\.classList\.toggle\("is-immediate-call-discard", isImmediateCallDiscard\)/);
  assert.match(html, /hasSelfMeldsV17 && !isImmediateCallDiscard \? detectHandMaskV17/);
});

test("derives riichi controls from NAGA reach data", async () => {
  const html = await source();
  const body = functionBody(html, "hasReachV16", "recommendedRiichiV16");
  assert.match(body, /Array\.isArray\(SCENE\.reach\)/);
  assert.match(body, /reach\.some\(value => Number\(value\) > 0\)/);
  assert.match(body, /SCENE\.hasRiichiJudgment === true/);

  const questions = JSON.parse(await readFile(new URL("../public/question-data/selected-questions.json", import.meta.url), "utf8"));
  const riichiNumbers = questions
    .filter(question => question.decisionType === "discard" && question.reach.some(value => Number(value) > 0))
    .map(question => question.number);
  assert.deepEqual(riichiNumbers, [41, 47, 138, 141, 151, 156, 165, 179, 198]);
  assert.ok(questions.filter(question => question.hasRiichiJudgment)
    .every(question => question.actualReach === true || riichiNumbers.includes(question.number)));

  const question158 = questions.find(question => question.number === 158);
  assert.equal(question158?.decisionType, "call");
  assert.equal(question158?.nagaUrl, "https://naga.dmv.nico/htmls/acd736f52c73f007190f3e9f8391be6ca1693750a555b6a66bb18b2e174ca8ccv2_2.html?tw=0&ts=4&tv=24");
  assert.equal(question158?.image, "question-images/q158.webp");
  assert.equal(question158?.callTile, "pin1");
  assert.deepEqual(question158?.callRecommended, [true, true, true]);
  assert.deepEqual(question158?.callProbabilities?.call, [91.11, 84.83, 53.76]);
});
