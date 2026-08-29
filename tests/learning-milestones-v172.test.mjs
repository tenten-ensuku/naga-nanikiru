import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const uxUrl = new URL("../public/drill-ux-v44.js", import.meta.url);

async function loadUxApi() {
  const source = await readFile(uxUrl, "utf8");
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: uxUrl.pathname });
  return context.DrillUxV44;
}

function hostValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("V172 defines mastery as the latest circle-or-better answer", async () => {
  const api = await loadUxApi();
  const state = {
    answerHistory: [
      { questionKey: "circle", scoreMark: "×", answeredAt: "2026-08-25T00:00:00Z" },
      { questionKey: "circle", scoreMark: "〇", answeredAt: "2026-08-26T00:00:00Z" },
      { questionKey: "excellent", scoreMark: "◎", answeredAt: "2026-08-26T00:01:00Z" },
      { questionKey: "triangle", scoreMark: "△", answeredAt: "2026-08-26T00:02:00Z" },
      { questionKey: "miss", scoreMark: "×", answeredAt: "2026-08-26T00:03:00Z" }
    ]
  };

  assert.equal(api.isMasteredByRecentAnswers(state, "circle"), true);
  assert.equal(api.isMasteredByRecentAnswers(state, "excellent"), true);
  assert.equal(api.isMasteredByRecentAnswers(state, "triangle"), false);
  assert.equal(api.isMasteredByRecentAnswers(state, "miss"), false);
});

test("V172 milestone transitions only fire when a collection crosses the completion boundary", async () => {
  const api = await loadUxApi();
  assert.deepEqual(hostValue(api.learningMilestoneTransitions(
    { total: 3, unanswered: 1, mastered: 2 },
    { total: 3, unanswered: 0, mastered: 2 }
  )), { lap: true, mastery: false });
  assert.deepEqual(hostValue(api.learningMilestoneTransitions(
    { total: 3, unanswered: 0, mastered: 2 },
    { total: 3, unanswered: 0, mastered: 3 }
  )), { lap: false, mastery: true });
  assert.deepEqual(hostValue(api.learningMilestoneTransitions(
    { total: 0, unanswered: 0, mastered: 0 },
    { total: 0, unanswered: 0, mastered: 0 }
  )), { lap: false, mastery: false });
});

test("V180 renders recent history while keeping the celebration dialog", async () => {
  const html = await readFile(htmlUrl, "utf8");
  const recentView = html.match(/function renderRecentHistoryViewV180\([\s\S]*?\n      function renderTodayViewV159\(/)?.[0] || "";

  assert.match(html, /const APP_VERSION = 191;/);
  assert.match(html, /id="learningCelebrationDialog"/);
  assert.match(html, /1周達成おめでとう！/);
  assert.match(html, /完全習得おめでとう！/);
  assert.match(html, /evaluateLearningMilestonesV172\(true\)/);
  assert.match(html, /learningMilestoneTransitions/);
  assert.match(html, /直近1回が〇以上またはアーカイブ/);
  assert.match(recentView, /learning-dashboard/);
  assert.match(recentView, /直近回答履歴/);
  assert.doesNotMatch(recentView, /todayQueueCandidatesV172\(\)/);
  assert.doesNotMatch(recentView, /今日の10問/);
  assert.doesNotMatch(recentView, /直近2回連続で◎/);
});
