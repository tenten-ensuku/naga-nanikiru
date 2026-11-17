import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { cssSection, cssSectionOrder } from "./helpers/app-css.mjs";

const html = fs.readFileSync("public/index.html", "utf8");
const script = fs.readFileSync("public/answer-flow-v368.js", "utf8");
const css = cssSection("answer-flow-v368");

class FakeElement {
  constructor(id = "", tag = "DIV") { this.id = id; this.tagName = tag; this.hidden = false; this.textContent = ""; this.className = ""; this.listeners = {}; this.clicks = 0; this.offsetParent = {}; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() { this.clicks++; (this.listeners.click || []).forEach(fn => fn()); }
  append(child) { this.child = child; }
}

function harness() {
  const source = new FakeElement("nextQuestionBottomButton", "BUTTON");
  source.hidden = true; source.textContent = "次の問題へ";
  const form = new FakeElement("commentForm", "FORM"); form.hidden = true;
  const strip = new FakeElement("answerStrip", "SECTION"); strip.hidden = true;
  const hint = new FakeElement("keyHintV368", "P"); hint.hidden = true;
  const page = new FakeElement("", "MAIN"); page.menuActive = false;
  const body = new FakeElement("", "BODY");
  const byId = { nextQuestionBottomButton: source, commentForm: form, answerStrip: strip, keyHintV368: hint };
  const observers = [];
  const document = {
    readyState: "complete", body, activeElement: body,
    getElementById: id => byId[id] || null,
    querySelector: selector => selector === ".next-float-v368" ? body.child || null
      : selector === ".page.menu-active" ? (page.menuActive ? page : null)
      : selector === ".page" ? page : selector === "[data-tile-index]" ? {} : selector === ".scene-card" ? body : null,
    querySelectorAll: () => [],
    createElement: tag => new FakeElement("", tag.toUpperCase()),
    addEventListener() {},
  };
  const window = {
    document, setTimeout: fn => fn(),
    IntersectionObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} },
    MutationObserver: class { constructor() {} observe() {} },
  };
  vm.runInNewContext(script, { window });
  const floating = body.child;
  const api = window.MinkiruAnswerFlowV368;
  const scroll = inView => observers[0].cb([{ isIntersecting: inView }]);
  return { source, form, strip, hint, page, document, floating, api, scroll };
}

test("V368 the floating next button appears only when the real one is revealed but off-screen", () => {
  const h = harness();
  assert.ok(h.floating, "floating button created");
  assert.equal(h.floating.className, "next-float-v368");
  assert.equal(h.floating.hidden, true, "hidden before answering");
  h.source.hidden = false; h.scroll(true);
  assert.equal(h.floating.hidden, true, "hidden while the real button is visible");
  h.scroll(false);
  assert.equal(h.floating.hidden, false, "shown once the real button scrolls away");
  assert.equal(h.floating.textContent, "次の問題へ");
  h.floating.click();
  assert.equal(h.source.clicks, 1, "forwards to the real button");
  h.form.hidden = false; h.scroll(false);
  assert.equal(h.floating.hidden, true, "hidden while writing a comment");
  h.form.hidden = true; h.page.menuActive = true; h.scroll(false);
  assert.equal(h.floating.hidden, true, "hidden on menu screens");
  h.page.menuActive = false; h.source.textContent = "この本の学習へ"; h.scroll(false);
  assert.equal(h.floating.textContent, "この本の学習へ", "follows the real label");
});

test("V368 phone-only floating style and keyboard hint for pointer screens", () => {
  assert.match(css, /\.next-float-v368 \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 800px\) \{\s*\.next-float-v368:not\(\[hidden\]\) \{[\s\S]*?position: fixed;[\s\S]*?min-height: 50px;[\s\S]*?font-size: 17px;/);
  assert.match(css, /@media \(min-width: 801px\) and \(hover: hover\) and \(pointer: fine\)/);
  assert.match(html, /<link rel="stylesheet" href="app\.css\?v=\d+">/);
  assert.match(html, /<script src="answer-flow-v368\.js\?v=\d+"><\/script>/);
  assert.ok(cssSectionOrder().includes("answer-flow-v368"));
  assert.match(html, /<p class="key-hint-v368" id="keyHintV368" hidden><kbd>←<\/kbd><kbd>→<\/kbd> 牌を選ぶ　<kbd>Enter<\/kbd> 確定　回答後は <kbd>→<\/kbd> 次の問題へ<\/p>/);
});

test("V368 arrow keys move the tile choice before answering", () => {
  const handler = html.slice(html.indexOf("const onTileV368"), html.indexOf('document.getElementById("confirmAnswerButton").addEventListener("click", confirmAnswerV41)'));
  assert.match(handler, /document\.activeElement\?\.matches\?\.\("\[data-tile-index\]"\) === true/);
  assert.match(handler, /if \(!onTileV368 && \["INPUT", "TEXTAREA", "SELECT", "BUTTON", "SUMMARY"\]/);
  assert.match(handler, /if \(document\.querySelector\("\.page\.menu-active"\)\) return;/);
  assert.match(handler, /\(event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"\) && !state\.revealed && SCENE\.decisionType !== "call"/);
  assert.match(handler, /const current = state\.selected \? indexes\.indexOf\(Number\(state\.selectedIndex\)\) : -1;/);
  assert.match(handler, /selectTileV16\(indexes\[nextPosition\]\)/);
  // The existing confirm / next keys stay after the arrow branch.
  assert.ok(handler.indexOf("ArrowLeft") < handler.indexOf("confirmAnswerV41()"));
  assert.match(handler, /\(event\.key === "ArrowRight" \|\| event\.key === "Enter"\) && state\.revealed/);
});
