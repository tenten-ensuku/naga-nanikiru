import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const questionsUrl = new URL("../public/question-data/selected-questions.json", import.meta.url);

async function youtubeHelpers() {
  const html = await readFile(htmlUrl, "utf8");
  const start = html.indexOf("    function escapeHtml(");
  const end = html.indexOf("    function setCommentFormStatusV68(", start);
  assert.ok(start >= 0 && end > start, "YouTube comment helpers should be present");
  const source = html.slice(start, end);
  return new Function("commentTileImage", `${source}\nreturn { youtubeVideoIdV96, commentYoutubeEmbedV96, formatCommentContent };`)(() => "");
}

test("problem 17 restores the Discord YouTube URL and embed metadata", async () => {
  const questions = JSON.parse(await readFile(questionsUrl, "utf8"));
  const question = questions.find(item => item.number === 17);
  assert.ok(question, "problem 17 should exist");
  const comment = question.comments.find(item => item.id === "1435864189963862148");
  assert.ok(comment, "problem 17 should retain the video comment");
  assert.equal(comment.content, "https://www.youtube.com/watch?v=8N-DQuNwORk");
  assert.deepEqual(comment.embeds?.[0], {
    title: "孤立1.9は【孤立君はタ～子嫌い法則】の例外あり...",
    url: "https://www.youtube.com/watch?v=8N-DQuNwORk",
    thumbnail: "https://i.ytimg.com/vi/8N-DQuNwORk/hqdefault.jpg"
  });
});

test("YouTube URLs become metadata-backed video cards for watch and short links", async () => {
  const { youtubeVideoIdV96, commentYoutubeEmbedV96, formatCommentContent } = await youtubeHelpers();
  assert.equal(youtubeVideoIdV96("https://www.youtube.com/watch?v=8N-DQuNwORk&t=12s"), "8N-DQuNwORk");
  assert.equal(youtubeVideoIdV96("https://youtu.be/xsMMmBPivwE"), "xsMMmBPivwE");
  const embed = commentYoutubeEmbedV96("https://www.youtube.com/watch?v=8N-DQuNwORk", [{
    title: "孤立1.9は【孤立君はタ～子嫌い法則】の例外あり...",
    url: "https://www.youtube.com/watch?v=8N-DQuNwORk",
    thumbnail: "https://i.ytimg.com/vi/8N-DQuNwORk/hqdefault.jpg"
  }]);
  assert.equal(embed.title, "孤立1.9は【孤立君はタ～子嫌い法則】の例外あり...");
  assert.equal(embed.thumbnail, "https://i.ytimg.com/vi/8N-DQuNwORk/hqdefault.jpg");
  const rendered = formatCommentContent("動画はこちら https://www.youtube.com/watch?v=8N-DQuNwORk", [embed]);
  assert.match(rendered, /comment-youtube-placeholder/);
  assert.match(rendered, /data-youtube-title="孤立1\.9は【孤立君はタ～子嫌い法則】の例外あり\.\.\."/);
  assert.doesNotMatch(rendered, /<a href="https:\/\/www\.youtube\.com\/watch/);
});
