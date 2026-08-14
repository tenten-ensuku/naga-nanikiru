import test from "node:test";
import assert from "node:assert/strict";
import { repairQuestionComments, stripLeadingUrls } from "../scripts/repair-question-comments.mjs";

test("strips only leading URLs and preserves prose after a same-line URL", () => {
  assert.equal(stripLeadingUrls("https://example.test/report\n\n①6ブロック目は打点や手役の種。"), "①6ブロック目は打点や手役の種。");
  assert.equal(stripLeadingUrls("https://example.test/report　この半荘、全体的に素晴らしい出来でした💯"), "この半荘、全体的に素晴らしい出来でした💯");
  assert.equal(stripLeadingUrls("本文 https://example.test/report は残す"), "本文 https://example.test/report は残す");
});

test("restores a truncated comment prefix from the Discord snapshot", () => {
  const questions = [{ number: 29, comments: [{ id: "m29", content: "ブロック目は打点や手役の種。" }] }];
  const snapshot = { threads: [{ messages: [{ id: "m29", content: "①6ブロック目は打点や手役の種。" }] }] };
  const result = repairQuestionComments(questions, snapshot);
  assert.equal(result.questions[0].comments[0].content, "①6ブロック目は打点や手役の種。");
  assert.equal(result.stats.restoredPrefix, 1);
});
