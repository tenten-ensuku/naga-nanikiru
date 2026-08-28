import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const rootUrl = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, rootUrl), "utf8");
}

async function loadUxApi() {
  const source = await read("public/drill-ux-v44.js");
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "drill-ux-v44.js" });
  return context.DrillUxV44;
}

test("V184 treats archived questions as mastered without making them playable", async () => {
  const api = await loadUxApi();
  const questions = [{ id: "archived" }, { id: "open" }];
  const state = { answerHistory: [] };

  const stats = api.analytics({ questions, state, masteredKeys: ["archived"] });
  assert.equal(stats.masteredCount, 1);

  const mastered = api.filterQuestions({
    questions,
    state,
    view: "all",
    status: "mastered",
    masteredKeys: ["archived"]
  });
  assert.deepEqual(mastered.map(question => question.id), ["archived"]);

  const queue = api.buildQueue({ questions, state, mode: "today", limit: 10, archivedKeys: ["archived"] });
  assert.equal(queue.map(question => question.id).join(","), "open");
});

test("V184 keeps archive-inclusive totals and genre in the compact question row", async () => {
  const [html, css] = await Promise.all([read("public/index.html"), read("public/ux-v159.css")]);
  assert.match(html, /function isLearningScopeQuestionV184\(/);
  assert.match(html, /const rangeLearningQuestions = menuLearningSummaryQuestionsV184\(\)/);
  assert.match(html, /isAnsweredForLearningV184/);
  assert.match(html, /masteredKeys: personalCollectionStateV131\(\)\.archived/);
  assert.match(html, /menu-card-heading"><span class="menu-card-title">\$\{title\}<\/span><span class="menu-card-meta">\$\{escapeHtml\(typeMetadata\)\}<\/span>/);
  assert.match(css, /V184: keep the question genre beside the bold number/);
  assert.match(css, /\.page\.menu-active \.menu-card-meta \{[\s\S]*?font-weight: 500/);
});

test("V184 migration splits Kunitaso and adds a guarded generic volume flow", async () => {
  const migration = await read("supabase/migrations/20260828190825_collection_volume_capacity_v184.sql");
  assert.match(migration, /906571ede3684fa9b3d3e10e/);
  assert.match(migration, /\(1, 1, 200\)/);
  assert.match(migration, /\(2, 201, 400\)/);
  assert.match(migration, /private\.collection_move_tokens/);
  assert.match(migration, /create or replace function public\.create_collection_volume\(/);
  assert.match(migration, /create or replace function public\.create_shared_question\(/);
  assert.match(migration, /'requires_volume_confirmation', true/);
  assert.match(migration, /'next_volume', target_volume/);
  assert.match(migration, /target_volume := \(\(question_number - 1\) \/ 200\) \+ 1/);
});

test("V184 exposes volume creation through the Supabase client and generator prompt", async () => {
  const [client, html] = await Promise.all([read("client/supabase-sync.ts"), read("public/index.html")]);
  assert.match(client, /async function createCollectionVolume\(shareSlug: string, volumeNumber: number \| null = null\)/);
  assert.match(client, /rpc\("create_collection_volume"/);
  assert.match(client, /createCollectionVolume,/);
  assert.match(html, /問題集の上限に達しました。\$\{nextVolume\}巻を作成し、そちらに追加しますか？/);
  assert.match(html, /await window\.NagaSupabase\.createCollectionVolume\(parentShareSlug, nextVolume\)/);
});
