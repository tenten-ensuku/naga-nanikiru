import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { repairQuestionComments, stripLeadingUrls } from "../scripts/repair-question-comments.mjs";

async function nimaCommentSanitizer() {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf("      function isNimaCollectionV105");
  const end = html.indexOf("      function isQuestionAddedByOtherV66", start);
  assert.ok(start >= 0 && end > start, "Nima comment sanitizer should be present");
  return new Function("sharedCollectionV46", `${html.slice(start, end)}\nreturn { isNimaCollectionV105, removeFirstHttpUrlV141, sanitizeNimaCommentsV105 };`)(
    { title: "垣崎にま問題集" }
  );
}

test("strips only leading URLs and preserves prose after a same-line URL", () => {
  assert.equal(stripLeadingUrls("https://example.test/report\n\n①6ブロック目は打点や手役の種。"), "①6ブロック目は打点や手役の種。");
  assert.equal(stripLeadingUrls("https://example.test/report　この半荘、全体的に素晴らしい出来でした💯"), "この半荘、全体的に素晴らしい出来でした💯");
  assert.equal(stripLeadingUrls("https://example.test/report\n5p は中筋。見落とし。"), "5p は中筋。見落とし。");
  assert.equal(stripLeadingUrls("https://example.test/report 3s切り"), "3s切り");
  for (const tile of ["1m", "9m", "1p", "9p", "1s", "9s", "1z", "7z"]) {
    assert.equal(stripLeadingUrls(`https://example.test/report\n${tile}切り`), `${tile}切り`);
  }
  assert.equal(
    stripLeadingUrls("https://example.test/first\n5p\nhttps://example.test/second"),
    "5p\nhttps://example.test/second"
  );
  assert.equal(stripLeadingUrls("本文 https://example.test/report は残す"), "本文 https://example.test/report は残す");
});

test("restores a truncated comment prefix from the Discord snapshot", () => {
  const questions = [{ number: 29, comments: [{ id: "m29", content: "ブロック目は打点や手役の種。" }] }];
  const snapshot = { threads: [{ messages: [{ id: "m29", content: "①6ブロック目は打点や手役の種。" }] }] };
  const result = repairQuestionComments(questions, snapshot);
  assert.equal(result.questions[0].comments[0].content, "①6ブロック目は打点や手役の種。");
  assert.equal(result.stats.restoredPrefix, 1);
});

test("Nima display cleanup removes the two scene images and only the first NAGA URL", async () => {
  const { isNimaCollectionV105, removeFirstHttpUrlV141, sanitizeNimaCommentsV105 } = await nimaCommentSanitizer();
  assert.equal(isNimaCollectionV105("nima-share"), true);
  assert.equal(removeFirstHttpUrlV141("https://example.com/test\n5p は中筋。見落とし。"), "5p は中筋。見落とし。");
  assert.equal(removeFirstHttpUrlV141("https://example.com/test 3s切り"), "3s切り");
  const result = sanitizeNimaCommentsV105([
    {
      content: "上家の副露判断",
      attachments: [{ src: "question-images/comments/problem.webp" }]
    },
    {
      content: "https://naga.dmv.nico/htmls/report_viewer.html?report_id=first",
      attachments: [{ src: "question-images/comments/explanation.webp" }]
    },
    {
      content: "比較用 https://naga.dmv.nico/htmls/report_viewer.html?report_id=second",
      attachments: [{ src: "question-images/comments/later.webp" }]
    }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].attachments.length, 0);
  assert.match(result[1].content, /report_id=second/);
  assert.equal(result[1].attachments[0].src, "question-images/comments/later.webp");
});
