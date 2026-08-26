import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://tenten-ensuku.github.io${pathname}`, {
      headers: { accept: "text/html", host: "tenten-ensuku.github.io" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the NAGA drill shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>NAGA局面ドリル/);
  assert.match(html, /src="\/naga-nanikiru\/index\.html"/);
  assert.match(html, /title="NAGA局面ドリル｜スクリーンショットベース"/);
});

test("wires v65 learning UX, generator, Supabase bridge, metadata, and social image", async () => {
  const [index, page, layout] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../public/og-v44.png", import.meta.url)),
  ]);
  assert.match(index, /const APP_VERSION = 171/);
  assert.match(index, /function menuRangeStepV120\(\)[\s\S]*?return MENU_RANGE_STEP_V137/);
  assert.match(index, /id="collectionDirectorySelect"/);
  assert.doesNotMatch(index, /class="collection-directory-item/);
  assert.match(index, /id="menuLoadMore"/);
  assert.match(index, /const MENU_RENDER_THRESHOLD_V119 = 300/);
  assert.match(index, /const MENU_RENDER_BATCH_V119 = 100/);
  assert.match(index, /さらに\$\{nextCount\}問を表示/);
  assert.doesNotMatch(index, /is-pierre-theme/);
  assert.match(index, /topColor: "#06254a", bottomColor: "#02244c"/);
  assert.doesNotMatch(index, /<div class="menu-heading">\s*<p class="eyebrow">NAGA SCREENSHOT-BASED DRILL<\/p>/);
  assert.match(index, /function menuQuestionSortKeyV99\(question\)[\s\S]*?const entries = menuFilteredQuestionsV80\(\)\.map\(question => \(\{ question, index:/);
  assert.match(index, /\.sort\(\(left, right\) => menuQuestionSortKeyV99\(left\.question\) - menuQuestionSortKeyV99\(right\.question\)/);
  assert.match(index, /<h1 id="questionPageTitle">何切る？<\/h1>/);
  assert.doesNotMatch(index, /<p class="header-note">NAGAの局面を解き、復習し、弱点を育て直す実戦問題集<\/p>/);
  assert.match(index, /id="menuButton"[^>]*>メニューに戻る<\/button>/);
  assert.match(index, /const typeMetadata = questionTypeV44\(question\);/);
  assert.doesNotMatch(index, /questionTypeV44\(question\), isSharedQuestionV47\(question\) \? "共有"/);
  assert.match(index, /id="sceneProblemTitle">問題249<\/strong><a class="source-link" id="nagaSourceLink"[^>]*>局面NAGAURLに移動<\/a>/);
  assert.doesNotMatch(index, /<div class="source-url">.*元画面：.*<\/div>/);
  assert.doesNotMatch(index, /<div class="source-url">.*report_viewer\.html.*<\/div>/);
  assert.match(index, /supabase-sync-v48\.js/);
  assert.match(index, /drill-ux-v44\.js/);
  assert.match(index, /naga-generator-v44\.js/);
  assert.match(index, /おすすめ10問/);
  assert.match(index, /NAGA URLから問題生成/);
  assert.match(index, /property="og:image" content="https:\/\/tenten-ensuku\.github\.io\/naga-nanikiru\/og-v44\.png"/);
  assert.match(index, /function formatAnnouncementDateV111\(item\)/);
  assert.match(index, /publishedAt: "2026-08-22T20:40:25\+09:00"/);
  assert.match(index, /formatAnnouncementDateV111\(item\)/);
  assert.match(page, /src=\{`\$\{APP_BASE_PATH\}index\.html`\}/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /og-v44\.png/);
});
