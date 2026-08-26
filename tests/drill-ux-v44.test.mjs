import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const moduleUrl = new URL("../public/drill-ux-v44.js", import.meta.url);
const MARK_X = "\u00d7";
const MARK_TRIANGLE = "\u25b3";
const MARK_CIRCLE = "\u3007";
const MARK_MASTERED = "\u25ce";
const LEGACY_MARK_MASTERED = "\ud83d\udcae";

async function loadApi(storage) {
  const source = await readFile(moduleUrl, "utf8");
  const context = { console };
  context.globalThis = context;
  if (storage) context.localStorage = storage;
  vm.runInNewContext(source, context, { filename: moduleUrl.pathname });
  return context.DrillUxV44;
}

function storageWith(value) {
  const values = new Map(value === undefined ? [] : [["naga-nanikiru-user-state-v1", JSON.stringify(value)]]);
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, next) { values.set(key, String(next)); },
    read(key = "naga-nanikiru-user-state-v1") { return JSON.parse(values.get(key)); }
  };
}

function hostValue(value) {
  return JSON.parse(JSON.stringify(value));
}

const NOW = "2026-08-03T00:00:00.000Z";

test("migrates v1 state without losing existing collections", async () => {
  const api = await loadApi();
  const oldState = {
    schemaVersion: 1,
    favorites: ["001", "001"],
    trashed: ["002"],
    hidden: ["003"],
    answerHistory: [{ questionKey: "001", scoreMark: MARK_TRIANGLE, answeredAt: NOW }],
    unrelatedLegacyValue: "keep me"
  };
  const migrated = api.migrateState(oldState);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(hostValue(migrated.favorites), ["001"]);
  assert.deepEqual(hostValue(migrated.trashed), ["002"]);
  assert.deepEqual(hostValue(migrated.hidden), ["003"]);
  assert.deepEqual(hostValue(migrated.answerHistory), oldState.answerHistory);
  assert.equal(migrated.unrelatedLegacyValue, "keep me");
  assert.deepEqual(hostValue(migrated.snoozed), {});
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "reviewSchedule"), false);
  assert.deepEqual(hostValue(migrated.studyDates), []);
  assert.deepEqual(hostValue(migrated.sessions), {});
  assert.equal(migrated.activeSessionId, null);
  assert.equal(migrated.lastSessionResult, null);
  assert.deepEqual(hostValue(migrated.customQuestions), []);
  assert.deepEqual(hostValue(migrated.pendingGenerated), []);
  assert.deepEqual(hostValue(migrated.settings), {});

  const storage = storageWith(oldState);
  const loaded = api.loadState(storage);
  assert.equal(loaded.schemaVersion, 2);
  assert.deepEqual(hostValue(loaded.favorites), ["001"]);
  api.saveState(loaded, storage);
  assert.equal(storage.read().schemaVersion, 2);
});

test("recognizes expired, active, and forever snoozes", async () => {
  const api = await loadApi();
  const state = {
    snoozed: {
      expired: "2026-08-02T23:59:59.000Z",
      active: "2026-08-04T00:00:00.000Z",
      forever: "forever",
      objectForever: { forever: true }
    }
  };
  assert.equal(api.isSnoozed(state, "expired", NOW), false);
  assert.equal(api.isSnoozed(state, "active", NOW), true);
  assert.equal(api.isSnoozed(state, "forever", NOW), true);
  assert.equal(api.isSnoozed(state, "objectForever", NOW), true);
  assert.equal(api.isSnoozed(state, "missing", NOW), false);
  assert.equal(api.isPlayable({ ...state, trashed: ["trash"] }, { id: "active" }, NOW), false);
  assert.equal(api.isPlayable({ ...state, trashed: ["trash"] }, { id: "trash" }, NOW), false);
  assert.equal(api.isPlayable({ ...state }, { id: "open" }, NOW), true);
});

test("builds today's queue with unanswered questions before latest-X reviews", async () => {
  const api = await loadApi();
  const questions = [
    { id: "future", decisionType: "discard" },
    { id: "new", decisionType: "discard" },
    { id: "weak", decisionType: "discard" },
    { id: "due", decisionType: "discard" },
    { id: "due", decisionType: "discard" },
    { id: "riichi", decisionType: "discard", reach: [0, 2, 0] },
    { id: "call", decisionType: "call", callOptions: ["pon"] }
  ];
  const state = {
    answerHistory: [
      { questionKey: "future", scoreMark: MARK_MASTERED, answeredAt: "2026-07-01T00:00:00Z" },
      { questionKey: "weak", scoreMark: MARK_X, answeredAt: "2026-08-02T00:00:00Z" },
      { questionKey: "riichi", scoreMark: MARK_CIRCLE, answeredAt: "2026-08-02T00:00:00Z" },
      { questionKey: "call", scoreMark: MARK_CIRCLE, answeredAt: "2026-08-02T00:00:00Z" }
    ],
  };
  assert.deepEqual(hostValue(api.buildQueue({ questions, state, mode: "recommended", now: NOW }).map(api.questionKey)), ["new", "due", "weak"]);
  assert.deepEqual(hostValue(api.buildQueue({ questions, state, mode: "recommended", limit: 2, now: NOW }).map(api.questionKey)), ["new", "due"]);
  assert.deepEqual(hostValue(api.buildQueue({ questions, state, mode: "unanswered", now: NOW }).map(api.questionKey)), ["new", "due"]);
  assert.deepEqual(hostValue(api.buildQueue({ questions, state, mode: "weak", now: NOW }).map(api.questionKey)), ["weak"]);
  assert.deepEqual(hostValue(api.buildQueue({ questions, state, mode: "riichi", now: NOW }).map(api.questionKey)), ["riichi"]);
  assert.deepEqual(hostValue(api.buildQueue({ questions, state, mode: "call", now: NOW }).map(api.questionKey)), ["call"]);
  assert.deepEqual(hostValue(api.buildQueue({ questions, state: { ...state, favorites: ["future", "new"] }, mode: "favorites", now: NOW }).map(api.questionKey)), ["new", "future"]);
});

test("uses an eight-unanswered plus two latest-X composition for ten-question sessions", async () => {
  const api = await loadApi();
  const questions = [
    ...Array.from({ length: 9 }, (_, index) => ({ id: `new-${index + 1}`, decisionType: "discard" })),
    { id: "weak-1", decisionType: "discard" },
    { id: "weak-2", decisionType: "discard" },
    { id: "weak-3", decisionType: "discard" },
    { id: "triangle", decisionType: "discard" },
    { id: "old-x-now-good", decisionType: "discard" }
  ];
  const state = {
    answerHistory: [
      { questionKey: "weak-1", scoreMark: MARK_X, answeredAt: "2026-08-01T00:00:00Z" },
      { questionKey: "weak-2", scoreMark: MARK_X, answeredAt: "2026-08-01T00:01:00Z" },
      { questionKey: "weak-3", scoreMark: MARK_X, answeredAt: "2026-08-01T00:02:00Z" },
      { questionKey: "triangle", scoreMark: MARK_X, answeredAt: "2026-08-01T00:03:00Z" },
      { questionKey: "triangle", scoreMark: MARK_TRIANGLE, answeredAt: "2026-08-02T00:03:00Z" },
      { questionKey: "old-x-now-good", scoreMark: MARK_X, answeredAt: "2026-08-01T00:04:00Z" },
      { questionKey: "old-x-now-good", scoreMark: MARK_CIRCLE, answeredAt: "2026-08-02T00:04:00Z" }
    ]
  };
  assert.deepEqual(
    hostValue(api.buildQueue({ questions, state, mode: "today", limit: 10, now: NOW }).map(api.questionKey)),
    ["new-1", "new-2", "new-3", "new-4", "new-5", "new-6", "new-7", "new-8", "weak-1", "weak-2"]
  );
  assert.deepEqual(
    hostValue(api.buildQueue({ questions, state, mode: "recommended", limit: 10, now: NOW }).map(api.questionKey)),
    ["new-1", "new-2", "new-3", "new-4", "new-5", "new-6", "new-7", "new-8", "weak-1", "weak-2"]
  );
  assert.deepEqual(hostValue(api.buildQueue({ questions, state, mode: "weak", limit: 10, now: NOW }).map(api.questionKey)), ["weak-1", "weak-2", "weak-3"]);
});

test("fills today's queue gracefully when one side of the composition is short", async () => {
  const api = await loadApi();
  const questions = [
    { id: "only-new", decisionType: "discard" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `weak-${index + 1}`, decisionType: "discard" }))
  ];
  const state = {
    answerHistory: Array.from({ length: 12 }, (_, index) => ({
      questionKey: `weak-${index + 1}`,
      scoreMark: MARK_X,
      answeredAt: `2026-08-01T00:${String(index).padStart(2, "0")}:00Z`
    }))
  };
  assert.deepEqual(
    hostValue(api.buildQueue({ questions, state, mode: "today", limit: 10, now: NOW }).map(api.questionKey)),
    ["only-new", "weak-1", "weak-2", "weak-3", "weak-4", "weak-5", "weak-6", "weak-7", "weak-8", "weak-9"]
  );

  const noUnanswered = questions.slice(1);
  assert.deepEqual(
    hostValue(api.buildQueue({ questions: noUnanswered, state, mode: "today", limit: 10, now: NOW }).map(api.questionKey)),
    ["weak-1", "weak-2", "weak-3", "weak-4", "weak-5", "weak-6", "weak-7", "weak-8", "weak-9", "weak-10"]
  );
});

test("returns latest history, analytics math, streak, and type breakdowns", async () => {
  const api = await loadApi();
  const questions = [
    { id: "discard", decisionType: "discard" },
    { id: "call", decisionType: "call" },
    { id: "riichi", decisionType: "discard", reach: [1, 0, 0] }
  ];
  const state = {
    studyDates: ["2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03"],
    answerHistory: [
      { questionKey: "discard", scoreMark: MARK_X, responseTimeMs: 1000, answeredAt: "2026-08-01T00:00:00Z" },
      { questionKey: "discard", scoreMark: MARK_CIRCLE, responseTimeMs: 2000, answeredAt: "2026-08-02T00:00:00Z" },
      { questionKey: "call", scoreMark: MARK_TRIANGLE, responseTimeMs: 3000, answeredAt: "2026-08-02T00:00:00Z" },
      { questionKey: "riichi", scoreMark: LEGACY_MARK_MASTERED, responseTimeMs: 4000, answeredAt: "2026-08-03T00:00:00Z" }
    ]
  };
  const latest = api.latestAnswerMap(state);
  assert.equal(latest.discard.scoreMark, MARK_CIRCLE);
  assert.equal(api.history(state, "discard").length, 2);
  const result = api.analytics({ questions, state, now: NOW });
  assert.equal(result.totalAttempts, 4);
  assert.equal(result.uniqueAnswered, 3);
  assert.equal(result.avgResponseMs, 2500);
  assert.deepEqual(hostValue(result.scoreCounts), { [MARK_X]: 1, [MARK_TRIANGLE]: 1, [MARK_CIRCLE]: 1, [MARK_MASTERED]: 1 });
  assert.equal(result.rates[MARK_CIRCLE], 0.25);
  assert.equal(result.streakDays, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "dueCount"), false);
  assert.equal(result.masteredCount, 2);
  assert.equal(result.breakdowns.discard.totalAttempts, 2);
  assert.equal(result.breakdowns.call.totalAttempts, 1);
  assert.equal(result.breakdowns.riichi.totalAttempts, 1);
});

test("defines weak questions by the latest answer being exactly X", async () => {
  const api = await loadApi();
  const questions = [
    { id: "latest-weak", decisionType: "discard" },
    { id: "latest-triangle", decisionType: "discard" },
    { id: "old-x-now-good", decisionType: "discard" },
    { id: "one-mastered", decisionType: "discard" },
    { id: "mastered", decisionType: "discard" }
  ];
  const state = {
    answerHistory: [
      { questionKey: "latest-weak", scoreMark: MARK_CIRCLE, answeredAt: "2026-08-01T00:00:00Z" },
      { questionKey: "latest-weak", scoreMark: MARK_X, answeredAt: "2026-08-02T00:00:00Z" },
      { questionKey: "latest-triangle", scoreMark: MARK_X, answeredAt: "2026-08-01T00:01:00Z" },
      { questionKey: "latest-triangle", scoreMark: MARK_TRIANGLE, answeredAt: "2026-08-02T00:01:00Z" },
      { questionKey: "old-x-now-good", scoreMark: MARK_X, answeredAt: "2026-08-01T00:02:00Z" },
      { questionKey: "old-x-now-good", scoreMark: MARK_CIRCLE, answeredAt: "2026-08-02T00:02:00Z" },
      { questionKey: "one-mastered", scoreMark: MARK_MASTERED, answeredAt: "2026-08-03T00:00:00Z" },
      { questionKey: "mastered", scoreMark: MARK_MASTERED, answeredAt: "2026-08-02T00:00:00Z" },
      { questionKey: "mastered", scoreMark: MARK_MASTERED, answeredAt: "2026-08-03T00:00:00Z" }
    ]
  };
  assert.deepEqual(hostValue(api.recentAnswers(state, "latest-weak", 2).map(entry => entry.scoreMark)), [MARK_X, MARK_CIRCLE]);
  assert.equal(api.hasWeakInRecentAnswers(state, "latest-weak"), true);
  assert.equal(api.hasWeakInRecentAnswers(state, "latest-triangle"), false);
  assert.equal(api.hasWeakInRecentAnswers(state, "old-x-now-good"), false);
  assert.equal(api.isMasteredByRecentAnswers(state, "one-mastered"), true);
  assert.equal(api.isMasteredByRecentAnswers(state, "old-x-now-good"), true);
  assert.equal(api.isMasteredByRecentAnswers(state, "mastered"), true);
  assert.equal(api.isMasteredByRecentAnswers(state, "latest-triangle"), false);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "weak" }).map(api.questionKey)), ["latest-weak"]);
  assert.equal(api.analytics({ questions, state, now: NOW }).masteredCount, 3);
});

test("filters by each exact latest answer mark without treating adjacent marks as the same", async () => {
  const api = await loadApi();
  const questions = [
    { id: "unanswered", decisionType: "discard" },
    { id: "latest-x", decisionType: "discard" },
    { id: "latest-triangle", decisionType: "discard" },
    { id: "latest-circle", decisionType: "discard" },
    { id: "latest-excellent", decisionType: "discard" },
    { id: "old-x-now-circle", decisionType: "discard" },
    { id: "old-circle-now-excellent", decisionType: "discard" },
    { id: "legacy-excellent", decisionType: "discard" }
  ];
  const state = {
    answerHistory: [
      { questionKey: "latest-x", scoreMark: MARK_X, answeredAt: "2026-08-03T00:00:00Z" },
      { questionKey: "latest-triangle", scoreMark: MARK_TRIANGLE, answeredAt: "2026-08-03T00:01:00Z" },
      { questionKey: "latest-circle", scoreMark: MARK_CIRCLE, answeredAt: "2026-08-03T00:02:00Z" },
      { questionKey: "latest-excellent", scoreMark: MARK_MASTERED, answeredAt: "2026-08-03T00:03:00Z" },
      { questionKey: "old-x-now-circle", scoreMark: MARK_X, answeredAt: "2026-08-03T00:04:00Z" },
      { questionKey: "old-x-now-circle", scoreMark: MARK_CIRCLE, answeredAt: "2026-08-03T00:05:00Z" },
      { questionKey: "old-circle-now-excellent", scoreMark: MARK_CIRCLE, answeredAt: "2026-08-03T00:06:00Z" },
      { questionKey: "old-circle-now-excellent", scoreMark: MARK_MASTERED, answeredAt: "2026-08-03T00:07:00Z" },
      { questionKey: "legacy-excellent", scoreMark: LEGACY_MARK_MASTERED, answeredAt: "2026-08-03T00:08:00Z" }
    ]
  };
  assert.equal(api.latestAnswerMark(state, "latest-x"), MARK_X);
  assert.equal(api.latestAnswerMark(state, "latest-triangle"), MARK_TRIANGLE);
  assert.equal(api.latestAnswerMark(state, "latest-circle"), MARK_CIRCLE);
  assert.equal(api.latestAnswerMark(state, "latest-excellent"), MARK_MASTERED);
  assert.equal(api.latestAnswerMark(state, "legacy-excellent"), MARK_MASTERED);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "unanswered" }).map(api.questionKey)), ["unanswered"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "latest-x" }).map(api.questionKey)), ["latest-x"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "latest-triangle" }).map(api.questionKey)), ["latest-triangle"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "latest-circle" }).map(api.questionKey)), ["latest-circle", "old-x-now-circle"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "latest-double-circle" }).map(api.questionKey)), ["latest-excellent", "old-circle-now-excellent", "legacy-excellent"]);
});

test("filters stably by view, query, status, and question type", async () => {
  const api = await loadApi();
  const questions = [
    { id: "001", number: 1, title: "\u62bc\u3057\u5f15\u304d", decisionType: "discard" },
    { id: "002", number: 2, title: "\u9cf4\u304d\u5224\u65ad", decisionType: "call" },
    { id: "003", number: 3, title: "\u7acb\u76f4\u5224\u65ad", decisionType: "discard", reach: [1, 0, 0] },
    { id: "004", number: 4, title: "\u65b0\u3057\u3044\u554f\u984c", decisionType: "discard" }
  ];
  const state = {
    favorites: ["002"],
    trashed: ["004"],
    answerHistory: [
      { questionKey: "001", scoreMark: MARK_X, answeredAt: NOW },
      { questionKey: "002", scoreMark: MARK_MASTERED, answeredAt: NOW },
      { questionKey: "003", scoreMark: MARK_CIRCLE, answeredAt: NOW }
    ]
  };
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state }).map(api.questionKey)), ["001", "002", "003"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, view: "favorites" }).map(api.questionKey)), ["002"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, view: "trash" }).map(api.questionKey)), ["004"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "weak" }).map(api.questionKey)), ["001"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "mastered" }).map(api.questionKey)), ["002", "003"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, status: "unanswered" }).map(api.questionKey)), []);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, type: "riichi" }).map(api.questionKey)), ["003"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, type: "call" }).map(api.questionKey)), ["002"]);
  assert.deepEqual(hostValue(api.filterQuestions({ questions, state, query: "\u9cf4\u304d" }).map(api.questionKey)), ["002"]);
});

test("uses the app number key format and shows snoozed questions in trash", async () => {
  const api = await loadApi();
  const question = { number: 249, title: "問題249" };
  const state = { snoozed: { "number-249": "forever" } };
  assert.equal(api.questionKey(question), "number-249");
  assert.equal(api.isPlayable(state, question, NOW), false);
  assert.deepEqual(hostValue(api.filterQuestions({ questions: [question], state, view: "my", now: NOW })), []);
  assert.deepEqual(hostValue(api.filterQuestions({ questions: [question], state, view: "trash", now: NOW }).map(api.questionKey)), ["number-249"]);
});

test("creates deterministic sessions and summarizes a session once per question", async () => {
  const api = await loadApi();
  const session = api.createSession("today", ["001", "002", "001"], NOW);
  const sameSession = api.createSession("today", ["001", "002", "001"], NOW);
  assert.equal(session.id, sameSession.id);
  assert.deepEqual(hostValue(session.questionKeys), ["001", "002"]);
  assert.equal(session.status, "active");

  const result = api.sessionResult(session, [
    { sessionId: session.id, questionKey: "001", scoreMark: MARK_X, responseTimeMs: 1000, answeredAt: NOW },
    { sessionId: session.id, questionKey: "001", scoreMark: MARK_MASTERED, responseTimeMs: 2000, answeredAt: "2026-08-03T00:01:00Z" },
    { sessionId: session.id, questionKey: "002", scoreMark: MARK_CIRCLE, responseTimeMs: 3000, answeredAt: "2026-08-03T00:02:00Z" },
    { sessionId: "other-session", questionKey: "003", scoreMark: MARK_MASTERED, responseTimeMs: 9999, answeredAt: NOW }
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.answered, 2);
  assert.equal(result.unanswered, 0);
  assert.equal(result.completed, true);
  assert.equal(result.status, "complete");
  assert.equal(result.totalAttempts, 3);
  assert.deepEqual(hostValue(result.scoreCounts), { [MARK_X]: 0, [MARK_TRIANGLE]: 0, [MARK_CIRCLE]: 1, [MARK_MASTERED]: 1 });
  assert.equal(result.avgResponseMs, 2500);
});
