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
  assert.equal(format("44r5s"), "[sou4][sou4][aka3]");
  assert.equal(format("r5ｍ・35R5ｐ"), "[aka1]・[pin3][pin5][aka2]");
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

test("honor notation maps all seven tiles and supports full-width, sequences, and ranges", async () => {
  const format = await formatter();
  for (let number = 1; number <= 7; number++) {
    const fullWidth = String.fromCharCode(0xff10 + number);
    for (const digit of [String(number), fullWidth]) {
      for (const suit of ["z", "ｚ", "Z", "Ｚ"]) {
        assert.equal(format(`${digit}${suit}`), `[ji${number}]`);
      }
    }
    await readFile(new URL(`../public/tiles/ji${number}-66-90-l.png`, import.meta.url));
  }
  assert.equal(format("1234567z"), "[ji1][ji2][ji3][ji4][ji5][ji6][ji7]");
  assert.equal(format("６６７ｚ"), "[ji6][ji6][ji7]");
  assert.equal(format("1z7z"), "[ji1][ji7]");
  assert.equal(format("1ｚ～7ｚ"), "[ji1]～[ji7]");
  assert.equal(format("１～７ｚ"), "[ji1]～[ji7]");
  assert.equal(format("東は1z、中は7ｚ。発展の中では6z。"), "東は[ji1]、中は[ji7]。発展の中では[ji6]。");
  assert.equal(format("123m456p789s567z"), "[man1][man2][man3][pin4][pin5][pin6][sou7][sou8][sou9][ji5][ji6][ji7]");
});

test("honor conversion leaves Japanese prose, invalid tile numbers, and ordinary words intact", async () => {
  const format = await formatter();
  for (const value of [
    "発展の発、最中の中、〇〇の中では、東南西北白發中。",
    "東京から南へ。西口、北海道、白紙、發展、集中。",
    "0z 8z 9z ０ｚ ８ｚ ９ｚ 18z ０７ｚ 1～8z 8～7z",
    "7zip ７ｚｉｐ"
  ]) assert.equal(format(value), value);
});

test("honor notation works in styled and hidden comments without changing links or source text", async () => {
  const html = await readFile(htmlUrl, "utf8");
  const start = html.indexOf("    function escapeHtml(");
  const end = html.indexOf("    function setCommentFormStatusV68(", start);
  assert.ok(start >= 0 && end > start);
  const format = new Function("commentTileImage", `${html.slice(start, end)}\nreturn formatCommentContent;`)(tile => `[${tile}]`);
  const source = "**7ｚ** [color:green]6z[/color] ||５ｚ|| 発展・最中・〇〇の中では https://example.com/7z";
  const rendered = format(source);
  assert.match(rendered, /<strong>\[ji7\]<\/strong>/);
  assert.match(rendered, /comment-color-green">\[ji6\]/);
  assert.match(rendered, /comment-spoiler-content[^>]*>\[ji5\]/);
  assert.match(rendered, /発展・最中・〇〇の中では/);
  assert.match(rendered, /href="https:\/\/example\.com\/7z"/);
  assert.match(rendered, />https:\/\/example\.com\/7z<\/a>/);
  assert.equal(source, "**7ｚ** [color:green]6z[/color] ||５ｚ|| 発展・最中・〇〇の中では https://example.com/7z");
});

test("problem 163 converts r-prefixed red-five notation", async () => {
  const format = await formatter();
  const questions = JSON.parse(await readFile(questionsUrl, "utf8"));
  const question = questions.find(item => item.number === 163);
  assert.ok(question, "problem 163 should exist");
  const rendered = format(question.comments.map(comment => comment.content).join("\n"));
  assert.match(rendered, /\[sou4\]\[sou4\]\[aka3\]/);
  assert.doesNotMatch(rendered, /44r5s/);
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
