import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { cssSection } from "./helpers/app-css.mjs";

const html = fs.readFileSync("public/index.html", "utf8");
const source = name => {
  const start = html.indexOf(`function ${name}(`);
  const asyncStart = html.lastIndexOf("async ", start) === start - 6 ? start - 6 : start;
  let depth = 0, i = html.indexOf("{", start);
  for (; i < html.length; i++) { if (html[i] === "{") depth++; else if (html[i] === "}" && --depth === 0) break; }
  return html.slice(asyncStart, i + 1);
};

function harness({ values = [3, 5, 9], current = 5, allLoaded = true } = {}) {
  const select = {
    disabled: false, value: String(current),
    options: values.map(v => ({ value: String(v), textContent: `問題${v}` })),
  };
  const buttons = [-1, 1].map(step => ({ dataset: { questionStep: String(step) }, disabled: false, title: "", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }));
  const opened = [];
  let loads = 0;
  const context = {
    document: { getElementById: () => select, querySelectorAll: () => buttons },
    sharedQuestionPagingV177: { allLoaded },
    sharedQuestionPagingIsCurrentV177: () => true,
    ensureSharedQuestionIndexAllV177: async () => { loads++; select.options.push({ value: "12", textContent: "問題12" }); context.sharedQuestionPagingV177.allLoaded = true; },
    openQuestionV16: async index => { opened.push(index); select.value = String(index); return true; },
  };
  vm.runInNewContext(["questionStepTargetV373", "syncQuestionStepsV373", "stepQuestionV373"].map(source).join("\n") +
    "; this.api = { questionStepTargetV373, syncQuestionStepsV373, stepQuestionV373 };", context);
  return { ...context.api, select, buttons, opened, loads: () => loads };
}

test("V373 ‹ › open the neighbouring question in picker order", async () => {
  const h = harness();
  h.syncQuestionStepsV373();
  assert.equal(h.buttons[0].attrs["aria-label"], "前の問題（問題3）");
  assert.equal(h.buttons[1].attrs["aria-label"], "次の問題（問題9）");
  await h.stepQuestionV373(1);
  assert.deepEqual(h.opened, [9]);
  assert.equal(h.buttons[1].disabled, true, "no next question at the end of a fully loaded book");
  await h.stepQuestionV373(-1);
  await h.stepQuestionV373(-1);
  assert.deepEqual(h.opened, [9, 5, 3]);
  assert.equal(h.buttons[0].disabled, true, "no previous question at the start");
  await h.stepQuestionV373(-1);
  assert.deepEqual(h.opened, [9, 5, 3], "nothing opens past the first question");
});

test("V373 next at the end of a partly loaded book loads the rest first", async () => {
  const h = harness({ current: 9, allLoaded: false });
  h.syncQuestionStepsV373();
  assert.equal(h.buttons[1].disabled, false, "more pages may hold the next question");
  await h.stepQuestionV373(1);
  assert.equal(h.loads(), 1);
  assert.deepEqual(h.opened, [12]);
});

test("V373 buttons sit on both sides of the question picker and stay readable", () => {
  assert.match(html, /<button class="question-step-v373" id="questionPrevV373" type="button" data-question-step="-1" aria-label="前の問題" title="前の問題">‹<\/button><span class="question-title-picker-v250"/);
  assert.match(html, /<select id="questionSelect" aria-label="問題を選ぶ"><\/select><\/span><button class="question-step-v373" id="questionNextV373" type="button" data-question-step="1"/);
  assert.match(html, /querySelectorAll\("\[data-question-step\]"\)\.forEach\(button => button\.addEventListener\("click"/);
  const css = cssSection("question-steps-v373");
  assert.match(css, /\.question-step-v373 \{[^}]*width: 40px;[^}]*height: 44px;/);
  assert.match(css, /html\[data-theme="light"\] \.question-step-v373/);
});

test("V374 after answering, previous / next number buttons sit under 次の問題へ and show their destination", () => {
  assert.match(html, /<button class="next-button" id="nextQuestionBottomButton" type="button" hidden>次の問題へ<\/button>\s*<div class="answer-steps-v374" role="group" aria-label="番号順に移動"><button class="answer-step-v374" type="button" data-question-step="-1">‹ 前の問題<\/button><button class="answer-step-v374" type="button" data-question-step="1">次の番号 ›<\/button><\/div>/);
  const h = harness();
  h.buttons.forEach(button => { button.classList = { contains: name => name === "answer-step-v374" }; });
  h.syncQuestionStepsV373();
  assert.equal(h.buttons[0].textContent, "‹ 問題3");
  assert.equal(h.buttons[1].textContent, "問題9 ›");
  const css = cssSection("answer-steps-v374");
  assert.match(css, /\.answer-steps-v374 \{ display: flex; gap: 8px; flex: 1 1 100%;/);
  assert.match(css, /\.answer-step-v374 \{[^}]*min-height: 44px;[^}]*font: 700 15px/);
  assert.match(css, /@media \(max-width: 800px\) \{\s*\.prev-float-v374:not\(\[hidden\]\) \{[^}]*position: fixed;[^}]*left: 14px;/);
});

test("V374 ← after answering opens the previous number; the floating ‹ forwards to the header button", () => {
  assert.match(html, /if \(event\.key === "ArrowLeft" && state\.revealed\) \{\s*event\.preventDefault\(\);\s*void stepQuestionV373\(-1\);/);
  const flow = fs.readFileSync("public/answer-flow-v368.js", "utf8");
  assert.match(flow, /prevFloating\.className = "prev-float-v374";/);
  assert.match(flow, /prevFloating\.addEventListener\("click", \(\) => prevSource\?\.click\(\)\);/);
  assert.match(flow, /prevFloating\.hidden = !show \|\| !prevSource \|\| prevSource\.disabled;/);
});
