import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cssSection, cssSectionOrder } from "./helpers/app-css.mjs";

const html = fs.readFileSync("public/index.html", "utf8");
const tray = fs.readFileSync("public/hand-tray-v379.js", "utf8");

test("V379 the design layer and the hand tray load after every feature section", () => {
  const order = cssSectionOrder();
  assert.deepEqual(order.slice(-2), ["design-v379", "hand-tray-v379"]);
  assert.match(html, /<script src="answer-flow-v368\.js\?v=\d+"><\/script>\n  <script src="hand-tray-v379\.js\?v=\d+"><\/script>/);
});

test("V379 one sans-serif family and one gold accent, defined for both themes", () => {
  const css = cssSection("design-v379");
  assert.match(css, /--mk-sans: "Hiragino Sans"/);
  for (const theme of ["light", "dark"]) assert.match(css, new RegExp(`html\\[data-theme="${theme}"\\] \\{[^}]*--mk-accent:`));
  assert.match(css, /font-family: var\(--mk-sans\) !important;/);
  // Book covers keep their printed serif.
  assert.match(css, /:not\(\.library-v214 \*, \.library-flight-v214 \*/);
});

test("V379 phones fold the question toolbar into rows instead of scrolling sideways", () => {
  const css = cssSection("design-v379");
  assert.match(css, /@media \(max-width: 800px\) \{[\s\S]*\.question-toolbar-v255 \{\s*flex-wrap: wrap;/);
  assert.match(css, /\.question-toolbar-v255 > \.menu-button \{ order: -1;/);
});

test("V379 the tray mirrors the real tile and call buttons and only forwards taps", () => {
  assert.match(tray, /querySelectorAll\("\.hand-layer \[data-tile-index\]"\)/);
  assert.match(tray, /querySelectorAll\("\[data-call-decision\]"\)/);
  assert.match(tray, /addEventListener\("click", \(\) => source\.click\(\)\)/);
  // Copies must not carry data-tile-index, or the arrow-key handler would count tiles twice.
  assert.doesNotMatch(tray, /dataset\.tileIndex\s*=|setAttribute\("data-tile-index"/);
  assert.match(tray, /setAttribute\("aria-hidden", "true"\)/);
  const css = cssSection("hand-tray-v379");
  assert.match(css, /^\.hand-tray-v379 \{ display: none; \}/m);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test("V380 on phones the last content can scroll above the floating 次の問題へ", () => {
  const css = cssSection("answer-flow-v368");
  assert.match(css, /@media \(max-width: 800px\) \{[\s\S]*html body \.page:not\(\.menu-active\) \{ padding-bottom: calc\(88px \+ env\(safe-area-inset-bottom\)\); \}/);
});
