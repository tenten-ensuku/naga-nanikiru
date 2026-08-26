import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const clientUrl = new URL("../client/supabase-sync.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260825222328_shared_question_index_detail_loading.sql", import.meta.url);

test("V170 は問題集切り替え時に軽量インデックスだけを読み込む", async () => {
  const [html, client, migration] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(clientUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(html, /const APP_VERSION = 171;/);
  assert.match(html, /sharedQuestionDetailsDeferredV170/);
  assert.match(html, /ensureSharedQuestionDetailV170/);
  assert.match(html, /void startCommentNotificationPollingV65\(\)/);
  assert.doesNotMatch(html, /if \(loadedSharedCollection && questionsV16\.length\) await startCommentNotificationPollingV65\(\)/);
  assert.doesNotMatch(html, /if \(questionsV16\.length\) applyQuestionV16\(questionsV16\[0\], 0\)/);

  assert.match(client, /rpc\("get_shared_question_index"/);
  assert.match(client, /rpc\("get_shared_question_detail"/);
  assert.match(client, /detailsDeferred: questions\.detailsDeferred/);

  const indexFunction = migration.match(/create or replace function public\.get_shared_question_index[\s\S]*?grant execute on function public\.get_shared_question_index[\s\S]*?;/i)?.[0] || "";
  const detailFunction = migration.match(/create or replace function public\.get_shared_question_detail[\s\S]*?grant execute on function public\.get_shared_question_detail[\s\S]*?;/i)?.[0] || "";
  assert.match(indexFunction, /returns table/i);
  assert.doesNotMatch(indexFunction, /select q\.\*/i);
  assert.match(indexFunction, /private\.can_access_collection\(c\.id\)/i);
  assert.match(detailFunction, /returns setof public\.questions/i);
  assert.match(detailFunction, /select q\.\*/i);
  assert.match(detailFunction, /q\.id = p_question_id/i);
});
