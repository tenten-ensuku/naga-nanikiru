import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// V366: readable text floor. Body text stays at 12px or more; only chart and
// badge labels inside tight graphics may go smaller, and never below 9px.
const FILES = [
  "public/index.html", "public/ux-v159.css", "public/book-builder-v235.css", "public/book-pages-v281.css",
  "public/collection-admin-v328.css", "public/comment-tags-v270.css", "public/content-dates-v246.css",
  "public/dora-sheen-v333.css", "public/generator-tools-v274.css", "public/menu-polish-v238.css",
  "public/menu-sections-v239.css", "public/navigation-v234.css", "public/question-header-v250.css",
  "public/question-toolbar-v255.css", "public/refinements-v273.css", "public/standard-reactions-v329.css",
  "public/legacy-transfer-v232.js",
];
const CHART = /candidate-choice|reach|bar-(model|value)|model-legend|badge|is-tile/;

function smallSizes(source) {
  const found = [];
  for (const m of source.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    const px = Number(m[1]);
    if (px >= 12) continue;
    const open = source.lastIndexOf("{", m.index);
    const selector = source.slice(source.lastIndexOf("}", open) + 1, open).replace(/\s+/g, " ").trim();
    found.push({ px, selector });
  }
  return found;
}

test("V366 body text is at least 12px; chart labels at least 9px", () => {
  for (const file of FILES) {
    for (const { px, selector } of smallSizes(fs.readFileSync(file, "utf8"))) {
      assert.ok(CHART.test(selector), `${file}: ${selector} is ${px}px`);
      assert.ok(px >= 9, `${file}: ${selector} is ${px}px`);
    }
  }
});

test("V366 progress caption column fits 「最新〇以上 100%」 at 12px", () => {
  const css = fs.readFileSync("public/refinements-v273.css", "utf8");
  assert.match(css, /\.learning-header-progress \{ width: 100%; grid-template-columns: 125px minmax\(0, 1fr\) 104px;/);
  assert.match(css, /\.learning-header-progress \{ grid-template-columns: 111px minmax\(0, 1fr\) 96px;/);
  assert.match(css, /\.learning-header-progress > small \{ text-align: right; white-space: nowrap; \}/);
});

test("V366 vote counts and match labels no longer shrink below 12px", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  assert.match(html, /\.answer-poll-count \{ color: #fff1bd; font-size: 12px;/);
  assert.match(html, /\.hand-score-match \{ color: #dffbfb; font-size: max\(12px, \.72em\);/);
});
