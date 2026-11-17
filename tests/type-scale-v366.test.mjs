import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cssSection } from "./helpers/app-css.mjs";

// V366: readable text floor. Body text stays at 12px or more; only chart and
// badge labels inside tight graphics may go smaller, and never below 9px.
const FILES = [
  "public/index.html", "ux-v159", "book-builder-v235", "book-pages-v281",
  "collection-admin-v328", "comment-tags-v270", "content-dates-v246",
  "dora-sheen-v333", "generator-tools-v274", "menu-polish-v238",
  "menu-sections-v239", "navigation-v234", "question-header-v250",
  "question-toolbar-v255", "refinements-v273", "standard-reactions-v329",
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
    for (const { px, selector } of smallSizes(file.startsWith("public/") ? fs.readFileSync(file, "utf8") : cssSection(file))) {
      assert.ok(CHART.test(selector), `${file}: ${selector} is ${px}px`);
      assert.ok(px >= 9, `${file}: ${selector} is ${px}px`);
    }
  }
});

test("V366 progress caption column fits 「最新〇以上 100%」 at 12px", () => {
  const css = cssSection("refinements-v273");
  assert.match(css, /\.learning-header-progress \{ width: 100%; grid-template-columns: 125px minmax\(0, 1fr\) 104px;/);
  assert.match(css, /\.learning-header-progress \{ grid-template-columns: 111px minmax\(0, 1fr\) 96px;/);
  assert.match(css, /\.learning-header-progress > small \{ text-align: right; white-space: nowrap; \}/);
});

test("V366 vote counts and match labels no longer shrink below 12px", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  assert.match(html, /\.answer-poll-count \{ color: #fff1bd; font-size: 12px;/);
  assert.match(html, /\.hand-score-match \{ color: #dffbfb; font-size: max\(12px, \.72em\);/);
});
