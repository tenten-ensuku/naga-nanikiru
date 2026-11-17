import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// V370: plain, short wording. Announcements keep their historical text, so they are excluded.
const source = fs.readFileSync("public/index.html", "utf8");
const start = source.indexOf("const APP_ANNOUNCEMENTS_V66 = [");
const html = source.slice(0, start) + source.slice(source.indexOf("];", start));

test("V370 generated-sounding phrases are gone from the app screens", () => {
  for (const phrase of [
    "見事な学びの積み重ね", "一周した証", "LEARNING MILESTONE", "完全習得おめでとうございます",
    "いつでも中断できます", "一言の感想も歓迎", "誰からのコメントもうれしい",
    "使い方に合わせて、必要な設定を開いてください", "画面付きの説明書と紹介動画",
    "あなたの選択をこの本で記憶します", "携帯とパソコンで引き継げます",
  ]) assert.ok(!html.includes(phrase), phrase);
});

test("V370 replacement copy states the facts briefly", () => {
  for (const phrase of [
    '<p class="learning-celebration-kicker">達成</p>',
    "全問に回答し、最新の回答がすべて〇以上になりました。",
    "この本の問題をすべて解きました。",
    "未回答と苦手の問題から出題します。",
    "疑問・別の考え・ひとこと感想、なんでもどうぞ。",
    "コメントはみん切るの中だけに保存され、Discordには投稿されません。",
    "Discordでログインして使います。回答履歴やお気に入りは、スマホとPCで共有されます。",
    "アカウントや通知などの設定です。",
    "問題の作り方や共有のしかたを、画像と動画で説明しています。",
    "<p>この本の次の問題も、この基準で採点します。</p>",
  ]) assert.ok(html.includes(phrase), phrase);
});
