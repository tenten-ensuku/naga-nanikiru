import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);
const generatorUrl = new URL("../public/naga-generator-v44.js", import.meta.url);
const questionsUrl = new URL("../public/question-data/selected-questions.json", import.meta.url);

async function loadGenerator() {
  const source = await readFile(generatorUrl, "utf8");
  const sandbox = { URL, URLSearchParams, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "naga-generator-v44.js" });
  assert.ok(sandbox.NagaGeneratorV44);
  return sandbox.NagaGeneratorV44;
}

function functionBody(source, functionName, nextFunctionName) {
  return source.match(new RegExp(`function ${functionName}\\([\\s\\S]*?\\n      function ${nextFunctionName}\\(`))?.[0] || "";
}

test("V212 reuses the canonical call-slot layout after answer confirmation", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /const APP_VERSION = 220;/);
  assert.match(html, /function displayHandSlotsV212\(question = SCENE\)/);
  assert.match(html, /const displaySlots = displayHandSlotsV212\(SCENE\)/);
  assert.match(html, /const displaySlots = displayHandSlotsV212\(question\)/);

  const displayBody = functionBody(html, "displayHandSlotsV212", "emptyHandSlotV146");
  assert.match(displayBody, /displayConcealedHandSlots/);
  assert.doesNotMatch(displayBody, /state\.revealed/);

  const maskBody = functionBody(html, "handMaskMeldCountForDisplayV152", "handMaskFallbackV17");
  assert.match(maskBody, /if \(isImmediateCallDiscardV132\(question\)\)/);
  assert.doesNotMatch(maskBody, /state\.revealed/);
  assert.match(html, /sceneFrameV16\.classList\.toggle\("is-immediate-call-discard", true\)/);
  assert.match(html, /class="auth-gate-logo" src="assets\/min-kiru-header\.png"/);
});

test("all local immediate-call questions keep their holes for the answer view", async () => {
  const api = await loadGenerator();
  const questions = JSON.parse(await readFile(questionsUrl, "utf8"));
  const immediateQuestions = questions.filter(question => question.decisionType === "discard"
    && Array.isArray(question.melds)
    && question.melds.length > 0
    && (question.draw == null || question.draw === "")
    && Array.isArray(question.handBeforeDraw)
    && question.handBeforeDraw.length < 13
    && question.actualDiscard != null);

  assert.equal(immediateQuestions.length, 8);
  for (const question of immediateQuestions) {
    const beforeAnswer = api.displayConcealedHandSlots(question, tiles => [...tiles]);
    const afterAnswer = api.displayConcealedHandSlots(question, tiles => [...tiles]);
    assert.ok(Array.isArray(beforeAnswer), `question ${question.number} must have display slots`);
    assert.deepEqual(afterAnswer, beforeAnswer, `question ${question.number} must preserve display slots`);
    assert.ok(beforeAnswer.length >= 1 && beforeAnswer.length <= 13);
    assert.ok(beforeAnswer.some(tile => tile == null), `question ${question.number} must keep consumed-tile holes`);
  }
});

test("preserves the same mask rule for chi, daiminkan, and ankan", async () => {
  const api = await loadGenerator();
  const normalSort = tiles => [...tiles];

  const legacyChi = {
    decisionType: "discard",
    actualDiscard: "sou7",
    handBeforeDraw: ["man1", "man2", "man3", "man4", "man5", "pin1", "pin2", "pin3", "sou1", "sou2", "sou7"],
    melds: [{ type: "chi", pai: "sou2", consumed: ["sou3", "sou4"] }]
  };
  const chiSlots = api.displayConcealedHandSlots(legacyChi, normalSort);
  assert.equal(chiSlots.length, 13);
  assert.equal(chiSlots.filter(tile => tile == null).length, 2);

  const daiminkanSlots = api.displayConcealedHandSlots({
    decisionType: "discard",
    predictionType: "daiminkan",
    handBeforeMeld: ["sou9", "sou9", "sou9", "man1", "man2", "man3", "man4", "man5", "man6", "pin1", "pin2", "pin3", "ji1"],
    melds: [{ type: "daiminkan", pai: "sou9", consumed: ["sou9", "sou9", "sou9"] }]
  }, normalSort);
  assert.equal(daiminkanSlots.filter(tile => tile == null).length, 3);

  const ankanSlots = api.displayConcealedHandSlots({
    decisionType: "discard",
    predictionType: "ankan",
    handBeforeMeld: ["ji5", "ji5", "ji5", "ji5", "man1", "man2", "man3", "pin1", "pin2", "pin3", "sou1", "sou2", "sou3"],
    melds: [{ type: "ankan", pai: "ji5", consumed: ["ji5", "ji5", "ji5", "ji5"] }]
  }, normalSort);
  assert.equal(ankanSlots.filter(tile => tile == null).length, 4);

  const ordinaryPostCall = {
    decisionType: "discard",
    predictionType: "tsumo",
    handBeforeDraw: ["man1", "man2", "man3", "pin1", "pin2", "pin3", "sou1"],
    draw: "pin4",
    actualDiscard: "man1",
    melds: [
      { type: "chi", pai: "sou2", consumed: ["sou3", "sou4"] },
      { type: "daiminkan", pai: "ji5", consumed: ["ji5", "ji5", "ji5"] }
    ]
  };
  assert.equal(api.displayConcealedHandSlots(ordinaryPostCall, normalSort), null);
  assert.equal(api.displayConcealedHand(ordinaryPostCall).includes("ji5"), false);
});
