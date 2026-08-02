import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const questionsUrl = new URL("../public/question-data/selected-questions.json", import.meta.url);

async function formatter() {
  const html = await readFile(htmlUrl, "utf8");
  const start = html.indexOf("    function commentTileNumber(");
  const end = html.indexOf("    function formatCommentFragment(", start);
  assert.ok(start >= 0 && end > start, "comment tile formatter should be present");
  const source = html.slice(start, end);
  return new Function("commentTileImage", `${source}\nreturn formatCommentTileNotation;`)(tile => `[${tile}]`);
}

test("renders ranges, adjacent notation, and compact tile sequences", async () => {
  const format = await formatter();
  assert.equal(format("2～5ｍ"), "[man2]～[man5]");
  assert.equal(format("2ｍ～5ｍ"), "[man2]～[man5]");
  assert.equal(format("3ｍ4ｍ"), "[man3][man4]");
  assert.equal(format("34ｍ"), "[man3][man4]");
  assert.equal(format("3344555ｍ"), "[man3][man3][man4][man4][man5][man5][man5]");
  assert.equal(format("5788ｐ"), "[pin5][pin7][pin8][pin8]");
  assert.equal(format("24556ｓ"), "[sou2][sou4][sou5][sou5][sou6]");
  assert.equal(format("３４m・５６p・７８s"), "[man3][man4]・[pin5][pin6]・[sou7][sou8]");
  assert.equal(format("和了率5％、5巡目"), "和了率5％、5巡目");
});

test("problem 41 converts every tile in shorthand and adjacent notation", async () => {
  const format = await formatter();
  const questions = JSON.parse(await readFile(questionsUrl, "utf8"));
  const question = questions.find(item => item.number === 41);
  assert.ok(question, "problem 41 should exist");
  const rendered = format(question.comments.map(comment => comment.content).join("\n"));
  assert.match(rendered, /\[man3\]\[man4\]/);
  assert.match(rendered, /\[man2\]～\[man5\]/);
  assert.match(rendered, /\[man3\]\[man3\]\[man4\]\[man4\]\[man5\]\[man5\]\[man5\]/);
});

test("all stored comments leave no suited numeric shorthand unrendered", async () => {
  const format = await formatter();
  const questions = JSON.parse(await readFile(questionsUrl, "utf8"));
  let commentsChecked = 0;
  let renderedTiles = 0;
  for (const question of questions) {
    for (const comment of question.comments || []) {
      const rendered = format(comment.content || "");
      commentsChecked += 1;
      renderedTiles += (rendered.match(/\[(?:man|pin|sou)[1-9]\]/g) || []).length;
      assert.doesNotMatch(rendered, /[1-9１-９]+[mpsｍｐｓ]/, `problem ${question.number} still contains raw tile notation`);
      assert.doesNotMatch(rendered, /[1-9１-９]\s*[～〜~]\s*[1-9１-９]+[mpsｍｐｓ]/, `problem ${question.number} still contains a raw range`);
    }
  }
  assert.ok(commentsChecked > 100, "the full comment set should be audited");
  assert.ok(renderedTiles > 600, "the audit should exercise the full tile-notation corpus");
});
