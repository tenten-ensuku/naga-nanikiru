import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const indexUrl = new URL("../public/index.html", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260822170216_idempotent_shared_question_creation_v153.sql", import.meta.url);
const cleanupMigrationUrl = new URL("../supabase/migrations/20260822171800_dedupe_question_source_unique_constraint_v153.sql", import.meta.url);
const privateCollectionQuestionsMigrationUrl = new URL("../supabase/migrations/20260823090000_allow_private_collection_questions_v154.sql", import.meta.url);

test("重複追加は既存問題への導線を持ち、コメント欄の拡大ボタンを持たない", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /const APP_VERSION = 183/);
  assert.doesNotMatch(html, /commentsExpandButton|comments-expand-button|toggleCommentsExpanded|commentsExpanded/);
  assert.match(html, /alreadyExists: result\.already_exists === true/);
  assert.match(html, /showGeneratorExistingStatusV153\("この局面は既に登録済みです。"/);
  assert.match(html, /data-generator-existing-question/);
  assert.match(html, /existing_question/);
  assert.match(html, /navigateToExistingGeneratorQuestionV153/);
  assert.match(html, /getElementById\("menuPanel"\)\.addEventListener\("click", handleMenuGridClickV16\)/);
  assert.match(html, /generatorDuplicateKeysV153/);
  assert.match(html, /if \(localExisting \|\| generatorAddedKeysV130\.has\(duplicateKey\) \|\| generatorDuplicateKeysV153\.has\(duplicateKey\)\)/);
  assert.doesNotMatch(html, /if \(!candidate\._imageData\)/);
  assert.match(html, /function finiteQuestionNumberV154/);
  assert.match(html, /function nextQuestionNumberV154/);
  assert.match(html, /repairInvalidCustomQuestionNumbersV154\(\)/);
  assert.doesNotMatch(html, /Math\.max\(\.\.\.questionsV16\.map\(question => Number\(question\.number\) \|\| 0\)\) \+ 1/);
});

test("非公開問題集でもアクセス権のある利用者が問題を取得できる", async () => {
  const sql = await readFile(privateCollectionQuestionsMigrationUrl, "utf8");
  assert.match(sql, /private\.can_access_collection\(c\.id\)/);
  assert.match(sql, /q\.deleted_at is null/);
  assert.doesNotMatch(sql, /c\.visibility in \('unlisted', 'public'\)/);
});

test("共有問題の作成RPCは局面単位の一意性を保ち、既存IDを返す", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /drop constraint if exists questions_collection_id_source_report_id_scene_tw_scene_ts_key/);
  assert.match(sql, /unique nulls not distinct \(collection_id, source_report_id, scene_tw, scene_ts, scene_tv\)/);
  assert.match(sql, /returns jsonb/);
  assert.match(sql, /jsonb_build_object\('question_id', existing_question_id, 'already_exists', true\)/);
  assert.match(sql, /on conflict do nothing returning id into new_question_id/);
});

test("重複した既存制約を整理して、局面一意性を1本に保つ", async () => {
  const sql = await readFile(cleanupMigrationUrl, "utf8");
  assert.match(sql, /pg_get_constraintdef\(oid\)/);
  assert.match(sql, /alter table public\.questions drop constraint if exists/);
  assert.match(sql, /questions_source_report_scene_key/);
});

test("問題集切替時の初期再描画を同一キーでまとめる", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /refreshCollectionAccessStateBodyV153/);
  assert.match(html, /collectionAccessRefreshInFlightV153/);
  assert.match(html, /refreshAccountBodyV153/);
  assert.match(html, /lastAccountRefreshKeyV153/);
  assert.match(html, /if \(lastAccountRefreshKeyV153 === refreshKey\) return/);
  assert.doesNotMatch(html, /renderCollectionSpacePanelV100\(\);\s*renderImportQuestionButtonV115\(\);\s*renderNotificationBadgesV65\(\);\s*if \(document\.querySelector\("\.page"\)\?\.classList\.contains\("menu-active"\)\) renderMenuCardsV16\(\);/);
});
