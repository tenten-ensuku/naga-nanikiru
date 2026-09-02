import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);

async function commentHelpers() {
  const html = await readFile(htmlUrl, "utf8");
  const start = html.indexOf("    function escapeHtml(");
  const end = html.indexOf("    function setCommentFormStatusV68(", start);
  assert.ok(start >= 0 && end > start, "comment formatting helpers should be present");
  return new Function("commentTileImage", `${html.slice(start, end)}\nreturn { normalizeCommentSpoilerMarkupV217, formatCommentContent };`)(() => "");
}

test("Discordのスポイラー本文を取得後も伏せ字として描画する", async () => {
  const { formatCommentContent } = await commentHelpers();
  const rendered = formatCommentContent("前||秘密<&||\n後||二つ目||");

  assert.equal((rendered.match(/class="comment-spoiler"/g) || []).length, 2);
  assert.match(rendered, /aria-expanded="false"/);
  assert.match(rendered, /秘密&lt;&amp;/);
  assert.match(rendered, /二つ目/);
  assert.doesNotMatch(rendered, /\|\|秘密/);
});

test("中継時の全角パイプとHTMLエンコードされたパイプもスポイラーとして扱う", async () => {
  const { normalizeCommentSpoilerMarkupV217, formatCommentContent } = await commentHelpers();
  const source = "前｜｜全角の秘密｜｜中&#124;&#124;数値の秘密&#124;&#124;後";
  assert.equal(normalizeCommentSpoilerMarkupV217(source), "前||全角の秘密||中||数値の秘密||後");
  const rendered = formatCommentContent(source);
  assert.equal((rendered.match(/class="comment-spoiler"/g) || []).length, 2);
  assert.match(rendered, /全角の秘密/);
  assert.match(rendered, /数値の秘密/);
});
