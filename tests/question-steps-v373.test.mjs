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
