import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { cssSection } from "./helpers/app-css.mjs";

const html = fs.readFileSync("public/index.html", "utf8");

function dashboard(rows, userId = "owner") {
  const start = html.indexOf("async function renderStudentDashboardV46(");
  let depth = 0, i = html.indexOf("{", start);
  for (; i < html.length; i++) { if (html[i] === "{") depth++; else if (html[i] === "}" && --depth === 0) break; }
  const grid = { innerHTML: "" };
  const context = {
    document: { getElementById: () => grid },
    window: { NagaSupabase: { configured: true, loadStudentSummaries: async () => rows } },
    supabaseSessionV46: { user: { id: userId } },
    canViewStudentDashboardV84: () => true,
    escapeHtml: value => String(value),
  };
  vm.runInNewContext(html.slice(start, i + 1) + "; this.render = renderStudentDashboardV46;", context);
  return context.render().then(() => grid.innerHTML);
}

test("V377 the owner's own totals come first, marked あなた, followed by the students", async () => {
  const out = await dashboard([
    { user_id: "s1", display_name: "生徒A", attempt_count: 3, safe_count: 2, weak_count: 1, average_seconds: 8.5 },
    { user_id: "owner", display_name: "てんてん", attempt_count: 40, safe_count: 30, weak_count: 10, average_seconds: 6.2 },
  ]);
  assert.match(out, /<article class="student-row is-self-v377"><strong>てんてん<span class="student-self-badge-v377">あなた<\/span><\/strong><span class="student-metric">回答数<b>40<\/b>/);
  assert.ok(out.indexOf("てんてん") < out.indexOf("生徒A"), "own row first");
  assert.equal((out.match(/class="student-row/g) || []).length, 2);
  assert.match(out, /あなた自身の集計と、生徒の集計情報を確認できます。/);
});

test("V377 with no student answers yet, the owner still sees their own totals", async () => {
  const out = await dashboard([{ user_id: "owner", display_name: "てんてん", attempt_count: 5, safe_count: 4, weak_count: 1, average_seconds: null }]);
  assert.match(out, /is-self-v377/);
  assert.match(out, /平均時間<b>-秒<\/b>/);
  assert.match(out, /<p class="student-dashboard-empty-v377">生徒の回答はまだありません。/);
  const none = await dashboard([]);
  assert.match(none, /表示できる回答履歴はまだありません/);
});

test("V377 the own row is outlined in gold in both themes", () => {
  const css = cssSection("student-self-v377");
  assert.match(css, /html\[data-theme\] \.page\.menu-active #menuPanel \.student-row\.is-self-v377 \{ border-color: #c9a24a;/);
  assert.match(css, /\.student-self-badge-v377 \{/);
});
