import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const clientUrl = new URL("../client/supabase-sync.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260825222328_shared_question_index_detail_loading.sql", import.meta.url);
const pagingMigrationUrl = new URL("../supabase/migrations/20260826110711_shared_question_index_page_100.sql", import.meta.url);

test("V170 は問題集切り替え時に軽量インデックスだけを読み込む", async () => {
  const [html, client, migration, pagingMigration] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(clientUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
    readFile(pagingMigrationUrl, "utf8"),
  ]);

  assert.match(html, /const APP_VERSION = 192;/);
  assert.match(html, /sharedQuestionDetailsDeferredV170/);
  assert.match(html, /ensureSharedQuestionDetailV170/);
  assert.match(html, /SHARED_QUESTION_PAGE_SIZE_V177 = 100/);
  assert.match(html, /ensureSharedQuestionPageV177/);
  assert.match(html, /ensureSharedQuestionIndexAllV177/);
  assert.match(html, /menuRangeRequestV178/);
  assert.match(html, /switchCollectionInPlaceV177\([\s\S]*?menuRangeRequestV178 \+= 1/);
  assert.match(html, /shouldDeferCollectionPersonalLegacyMigrationV178/);
  assert.match(html, /startRangeSessionV61\(mode === "range-unanswered" \? "unanswered" : "all"\)/);
  assert.match(html, /sharedQuestionPagingV177\.loading = sharedQuestionPagingV177\.requests\.size > 0/);
  assert.match(html, /isSeriesParentCollectionV180\(sharedCollectionV46\)/);
  assert.match(html, /if \(isSeriesParentCollectionV180\(sharedCollectionV46\)\) return 0;/);
  assert.match(client, /collection\.data\.is_series_parent === true/);
  assert.match(html, /history\.pushState/);
  assert.match(html, /void startCommentNotificationPollingV65\(\)/);
  assert.doesNotMatch(html, /if \(loadedSharedCollection && questionsV16\.length\) await startCommentNotificationPollingV65\(\)/);
  assert.doesNotMatch(html, /if \(questionsV16\.length\) applyQuestionV16\(questionsV16\[0\], 0\)/);

  assert.match(client, /rpc\("get_shared_question_index"/);
  assert.match(client, /rpc\("get_shared_question_index_page"/);
  assert.match(client, /async function loadSharedQuestionPage/);
  assert.match(client, /Math\.min\(100/);
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

  assert.match(pagingMigration, /get_shared_question_index_page/i);
  assert.match(pagingMigration, /total_count bigint/i);
  assert.match(pagingMigration, /count\(\*\)\s+over\s*\(\s*\)/i);
  assert.match(pagingMigration, /limit least\(greatest\(coalesce\(p_limit, 100\), 1\), 100\)/i);
  assert.match(pagingMigration, /questions_collection_active_order_idx/i);
  assert.doesNotMatch(pagingMigration, /select q\.\*/i);
});
