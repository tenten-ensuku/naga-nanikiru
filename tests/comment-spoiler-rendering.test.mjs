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

test('double tildes render strikethrough without changing ordinary or unfinished text', async () => {
  const { formatCommentContent: render } = await commentHelpers();
  assert.equal(render('~~間違った解説~~ → 正しい解説'), '<s>間違った解説</s> → 正しい解説');
  assert.equal(render('~~ 間違った解説 ~~'), '<s> 間違った解説 </s>');
  assert.equal(render('~~一~~、~~二行\nあります~~'), '<s>一</s>、<s>二行<br>あります</s>');
  assert.equal(render('~普通~ ~~未完了'), '~普通~ ~~未完了');
  assert.equal(render('~~~~ ~~ ~~'), '~~~~ ~~ ~~');
  assert.equal(render('~~**訂正**~~'), '<s><strong>訂正</strong></s>');
  assert.equal(render('**~~訂正~~**'), '<strong><s>訂正</s></strong>');
  assert.equal(render('~~<img src=x onerror=alert(1)>~~'), '<s>&lt;img src=x onerror=alert(1)&gt;</s>');
  const link = render('~~https://example.com/review~~');
  assert.match(link, /^<s><a href="https:\/\/example.com\/review"/);
  assert.match(link, /<\/a><\/s>$/);
  const rawLink = render('https://example.com/~~review~~');
  assert.match(rawLink, /href="https:\/\/example.com\/~~review~~"/);
  assert.doesNotMatch(rawLink, /<s>/);
  const hidden = render('||~~訂正~~||');
  assert.match(hidden, /aria-hidden="true"><s>訂正<\/s>/);
});

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

test("Discord spoiler attachments are collapsed until explicitly opened", async()=>{
  const html=await readFile(htmlUrl,'utf8'),start=html.indexOf('    function renderCommentAttachmentV242('),end=html.indexOf('    function renderCommentEntryV65(',start);
  const render=new Function('escapeHtml',html.slice(start,end)+'; return renderCommentAttachmentV242;')(value=>String(value).replaceAll('"','&quot;'));
  const normal=render({src:'https://fixture/image.png',alt:'image'}),hidden=render({src:'https://fixture/image.png',alt:'image',spoiler:true});
  assert.doesNotMatch(normal,/<details/);assert.match(hidden,/<details class="comment-image-spoiler-v242"><summary>/);assert.doesNotMatch(hidden,/<details[^>]*\bopen\b/);
});
