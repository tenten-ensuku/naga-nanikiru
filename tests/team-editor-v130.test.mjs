import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260821110000_collection_editor_lifecycle_v130.sql", import.meta.url);

test("V130 baseline exposes a clear destination selector and editor-member wording", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /const APP_VERSION = 207/);
  assert.match(html, /function editableCollectionOptionsV130\(/);
  assert.match(html, /function currentGeneratorDestinationV130\(/);
  assert.match(html, /function canAddGeneratedQuestionV130\(/);
  assert.match(html, /保存先問題集/);
  assert.match(html, /編集メンバーは問題の生成・インポート・編集・整理もできます/);
  assert.match(html, /編集メンバー以上の権限/);
  assert.match(html, /承認時に「閲覧」または「編集」を選べます/);
});

test("V130 baseline separates editor contribution/archive from owner-only administration", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /visibility in \('private', 'limited', 'request'\)/i);
  assert.match(sql, /private\.can_archive_question_lifecycle/);
  assert.match(sql, /private\.can_edit_collection_content\(target_collection_id\)/);
  assert.match(sql, /questions_select_trash[\s\S]*can_archive_question_lifecycle/i);
  assert.match(sql, /questions_insert[\s\S]*can_contribute_collection/i);
  assert.match(sql, /questions_delete[\s\S]*can_manage_question_lifecycle/i);
  assert.match(sql, /create or replace function public\.create_shared_question[\s\S]*can_contribute_collection/i);
  assert.match(sql, /format\('問題%s', target_number\)/i);
  assert.match(sql, /create or replace function public\.permanently_delete_question[\s\S]*can_manage_question_lifecycle/i);
});
