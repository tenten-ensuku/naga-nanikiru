import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const moduleUrl = new URL("../public/drill-ux-v44.js", import.meta.url);
const source = await readFile(moduleUrl, "utf8");
const NOW = "2026-09-10T00:00:00Z";

function loadApi() {
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: moduleUrl.pathname });
  return context.DrillUxV44;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture() {
  return {
    questions: [
      { key: "book-a::shared-id", questionId: "shared-id", number: 1, decisionType: "call" },
      { id: "book-a::riichi", number: 2, decisionType: "discard", reach: [1, 0, 0] }
    ],
    state: {
      studyDates: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"],
      answerHistory: [
        { questionKey: "book-b::shared-id", questionId: "shared-id", number: 1, scoreMark: "×", responseTimeMs: 8000, answeredAt: "2026-09-08T00:00:00Z" },
        { questionKey: "book-a::shared-id", questionId: "shared-id", scoreMark: "×", responseTimeMs: 1000, answeredAt: "2026-09-09T00:00:00Z" },
        { questionKey: "book-a::shared-id", scoreMark: "〇", responseTimeMs: 2000, answeredAt: NOW, decisionType: "discard" },
        { questionKey: "book-a::riichi", scoreMark: "◎", responseTimeMs: 3000, answeredAt: NOW, decisionType: "call" },
        { questionKey: "book-b::shared-id", questionId: "shared-id", scoreMark: "×", responseTimeMs: 10000, answeredAt: NOW },
        { questionKey: "deleted-question", scoreMark: "△", responseTimeMs: 12000, answeredAt: NOW }
      ]
    },
    now: NOW
  };
}

test("collection scope excludes other books from all attempt statistics and uses current question metadata", () => {
  const api = loadApi();
  const options = fixture();
  const result = api.analytics({ ...options, scope: "collection" });
  assert.equal(result.totalAttempts, 3);
  assert.equal(result.uniqueAnswered, 2);
  for (const key of ["avgResponseMs", "averageResponseMs", "averageResponseTimeMs"]) {
    assert.equal(result[key], 2000);
  }
  assert.deepEqual(plain(result.scoreCounts), { "×": 1, "△": 0, "〇": 1, "◎": 1 });
  assert.deepEqual(plain(result.rates), { "×": 1 / 3, "△": 0, "〇": 1 / 3, "◎": 1 / 3 });
  assert.deepEqual(plain(result.scoreRates), plain(result.rates));
  assert.equal(result.breakdowns.discard.totalAttempts, 0);
  assert.equal(result.breakdowns.call.totalAttempts, 2);
  assert.equal(result.breakdowns.call.safeRate, 50);
  assert.equal(result.breakdowns.call.averageResponseMs, 1500);
  assert.equal(result.breakdowns.riichi.totalAttempts, 1);
  assert.equal(result.breakdowns.riichi.safeRate, 100);
  assert.equal(result.breakdowns.riichi.averageResponseMs, 3000);
  assert.equal(result.streakDays, 2);
  assert.equal(result.studyStreakDays, 2);
  assert.equal(result.masteredCount, 2);

  // Adding any outside history must leave the entire collection result intact.
  const ownOnly = { ...options.state, answerHistory: options.state.answerHistory.slice(1, 4) };
  assert.deepEqual(plain(result), plain(api.analytics({ ...options, state: ownOnly, scope: "collection" })));
});

test("omitted or non-collection scope preserves legacy global totals, fallback types, and study dates", () => {
  const api = loadApi();
  const options = fixture();
  const result = api.analytics(options);
  assert.equal(result.totalAttempts, 6);
  assert.equal(result.uniqueAnswered, 4);
  assert.equal(result.averageResponseMs, 6000);
  assert.deepEqual(plain(result.scoreCounts), { "×": 3, "△": 1, "〇": 1, "◎": 1 });
  assert.equal(result.rates["×"], 0.5);
  assert.equal(result.breakdowns.discard.totalAttempts, 3);
  assert.equal(result.breakdowns.call.totalAttempts, 2);
  assert.equal(result.breakdowns.riichi.totalAttempts, 1);
  assert.equal(result.masteredCount, 2);
  assert.equal(result.streakDays, 4);
  for (const scope of [undefined, "global", "all", "unknown"]) {
    assert.deepEqual(plain(api.analytics({ ...options, scope, period: { from: NOW } })), plain(result));
  }
});

test("full canonical key precedence prevents raw questionId collisions and retains legacy key aliases", () => {
  const api = loadApi();
  const questions = [{ key: "book-a::same", id: "same", questionId: "same", number: 1, decisionType: "call" }];
  const answerHistory = [
    { questionKey: "book-b::same", questionId: "book-a::same", scoreMark: "×" },
    { questionId: "same", number: 1, scoreMark: "×" },
    { questionKey: "book-a::same", questionId: "same", scoreMark: "〇" },
    { questionId: "book-a::same", scoreMark: "〇" },
    { key: "book-a::same", scoreMark: "〇" },
    { question: { key: "book-a::same", id: "same" }, scoreMark: "〇" }
  ];
  const result = api.analytics({ scope: "collection", questions, state: { answerHistory }, now: NOW });
  assert.equal(result.totalAttempts, 4);
  assert.equal(result.uniqueAnswered, 1);
  assert.equal(result.scoreCounts["×"], 0);
  assert.equal(result.breakdowns.call.safeRate, 100);
  assert.equal(result.masteredCount, 1);
  assert.equal(result.streakDays, 0);
});

test("empty or unmatched collection cannot inherit global answers or study dates", () => {
  const api = loadApi();
  const options = fixture();
  for (const questions of [undefined, [], [{ id: "unanswered", decisionType: "call" }], [null, {}]]) {
    const result = api.analytics({ ...options, questions, scope: "collection", masteredKeys: ["book-b::shared-id"] });
    assert.equal(result.totalAttempts, 0);
    assert.equal(result.uniqueAnswered, 0);
    assert.equal(result.avgResponseMs, 0);
    assert.equal(result.streakDays, 0);
    assert.equal(result.masteredCount, 0);
    assert.deepEqual(plain(result.scoreCounts), { "×": 0, "△": 0, "〇": 0, "◎": 0 });
    for (const value of Object.values(result.breakdowns)) {
      assert.equal(value.totalAttempts, 0);
      assert.equal(value.safeRate, 0);
    }
  }
});

test("period windows are applied within the collection with inclusive start and exclusive end", () => {
  const api = loadApi();
  const options = { ...fixture(), scope: "collection" };
  options.state.answerHistory.push({ questionKey: "book-a::shared-id", scoreMark: "△", responseTimeMs: 50000 });
  const previous = api.analytics({ ...options, period: { from: "2026-09-09T00:00:00Z", to: NOW } });
  const current = api.analytics({ ...options, period: { from: NOW, to: "2026-09-11T00:00:00Z" } });
  assert.equal(previous.totalAttempts, 1);
  assert.equal(previous.avgResponseMs, 1000);
  assert.equal(previous.breakdowns.call.safeRate, 0);
  assert.equal(previous.streakDays, 1);
  assert.equal(current.totalAttempts, 2);
  assert.equal(current.avgResponseMs, 2500);
  assert.equal(current.breakdowns.call.safeRate, 100);
  assert.equal(current.breakdowns.riichi.safeRate, 100);
  assert.equal(current.breakdowns.discard.totalAttempts, 0);
  assert.equal(current.streakDays, 1);
  assert.equal(api.analytics(options).totalAttempts, 4, "undated in-scope history is retained without a period");

  assert.equal(api.analytics({ ...options, period: { from: Date.parse(NOW) } }).totalAttempts, 2);
  assert.equal(api.analytics({ ...options, period: { to: NOW } }).totalAttempts, 1);
  for (const period of [
    { from: "invalid" }, { to: "invalid" },
    { from: NOW, to: NOW }, { from: NOW, to: "2026-09-08T00:00:00Z" }
  ]) {
    assert.equal(api.analytics({ ...options, period }).totalAttempts, 0);
  }
  assert.equal(api.analytics({ ...options, period: { from: null, to: "" } }).totalAttempts, 4);
});

test("period parsing retains supported answer timestamp aliases", () => {
  const api = loadApi();
  const answerHistory = ["answeredAt", "completedAt", "createdAt", "timestamp", "time"].map(field => ({
    questionKey: "book-a::one", scoreMark: "◎", [field]: NOW
  }));
  const result = api.analytics({
    scope: "collection", questions: [{ id: "book-a::one" }], state: { answerHistory }, now: NOW,
    period: { from: NOW, to: Date.parse(NOW) + 1 }
  });
  assert.equal(result.totalAttempts, 5);
  assert.equal(result.uniqueAnswered, 1);
  assert.equal(result.breakdowns.discard.safeRate, 100);
});

test("mastery remains current latest-safe-or-archived status over unique collection question keys", () => {
  const api = loadApi();
  const options = fixture();
  options.questions.push(options.questions[0], { id: "archived" }, { id: "unanswered" });
  const result = api.analytics({
    ...options, scope: "collection", masteredKeys: ["archived", "book-b::shared-id"],
    period: { to: NOW }
  });
  assert.equal(result.totalAttempts, 1);
  assert.equal(result.masteredCount, 3, "period does not rewind current mastery or duplicate its count");
  assert.equal(result.uniqueAnswered, 1, "attempt counts are not a question-total/mastery denominator");
});

test("scoped analytics does not mutate caller state, questions, mastery markers, or period", () => {
  const api = loadApi();
  const options = {
    ...fixture(), scope: "collection", masteredKeys: ["book-a::shared-id"], period: { from: NOW }
  };
  Object.assign(options.state, {
    favorites: ["book-b::shared-id"], collectionPersonal: { "user::book-a": { archived: ["book-a::riichi"] } },
    sessions: { saved: { questionKeys: ["book-b::shared-id"] } }, settings: { keep: true }
  });
  const before = plain(options);
  function freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(options);
  const result = api.analytics(options);
  assert.equal(result.totalAttempts, 2);
  result.scoreCounts["×"] = 999;
  assert.deepEqual(plain(options), before);
  assert.equal(api.analytics({ ...options, scope: "global" }).totalAttempts, 6);
});
