import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(testDir, "..");
const read = (relativePath) => fs.readFileSync(path.join(repoDir, relativePath), "utf8");

const html = read("public/index.html");
const css = read("public/ux-v159.css");
const syncClient = read("client/supabase-sync.ts");
const migration = read("supabase/migrations/20260830150000_shared_reactions_v208.sql");

const reactionLabels = [
  "いいね！", "そーだね！", "ムズい", "良問だね～", "重要だね！", "うーん", "方針が重要",
  "間違えちゃった", "大差だね", "微差かな", "メモメモ", "セオリー", "基本序列", "鳴く",
  "立直", "スルー", "ダマ", "カン"
];

test("V209 exposes the sample-style reaction icons and preserves the current-question hydration flow", () => {
  assert.match(html, /const APP_VERSION = 222;/);
  assert.match(html, /reactionPickerV208/);
  assert.match(html, /この問題へのリアクション/);
  assert.match(html, /data-reaction-add/);
  assert.match(html, /data-reaction-toggle/);
  assert.match(html, /data-reaction-details/);
  assert.match(html, /Promise\.allSettled\(\[/);
  assert.match(html, /loadSharedReactionSummary\(shareSlug, questionId\)/);
  assert.match(html, /setSharedCommentReaction\(questionId, String\(targetId\), storageKey, active\)/);
  assert.match(html, /reactionPending: new Set\(\)/);

  let previousIndex = -1;
  for (const label of reactionLabels) {
    const index = html.indexOf(`label: "${label}"`);
    assert.ok(index > previousIndex, `リアクション文言の順番が不正: ${label}`);
    previousIndex = index;
  }
  for (const icon of ["👍", "✅", "😥", "✨", "💡", "🤔", "🧭", "😣", "📏", "⚖️", "📝", "📗", "📘", "🗣️", "⏩", "🤫", "❗", "❓"]) {
    assert.match(html, new RegExp(`icon: "${icon}"`));
  }
  assert.match(html, /icon: "棒", iconType: "riichi-stick"/);
  assert.match(html, /reaction-riichi-stick-v209/);
  assert.match(html, /REACTION_STORAGE_KEY_MAP_V209/);
});

test("V208 renders a responsive picker without horizontal overflow", () => {
  assert.match(css, /\.reaction-picker-options-v208\s*\{[\s\S]*grid-template-columns: repeat\(5/);
  assert.match(css, /@media \(min-width: 801px\) and \(max-width: 1100px\)/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /width: min\(430px, calc\(100vw - 24px\)\)/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("V208 exposes one batched summary RPC and scoped mutation RPCs", () => {
  assert.match(syncClient, /async function loadSharedReactionSummary\(shareSlug: string, questionId: string\)/);
  assert.match(syncClient, /p_share_slug: shareSlug/);
  assert.match(syncClient, /p_question_id: questionId/);
  assert.match(syncClient, /async function setSharedQuestionReaction\(questionId: string, reactionKey: string, active: boolean\)/);
  assert.match(syncClient, /async function setSharedCommentReaction\(questionId: string, commentId: string, reactionKey: string, active: boolean\)/);
  assert.match(syncClient, /p_comment_id: commentId/);
});

test("V208 migration enforces reaction identity, access checks, and authenticated-only writes", () => {
  assert.match(migration, /create table if not exists public\.question_reactions/);
  assert.match(migration, /create table if not exists public\.comment_reactions/);
  assert.match(migration, /primary key \(question_id, user_id, reaction_key\)/);
  assert.match(migration, /primary key \(question_id, comment_id, user_id, reaction_key\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /private\.can_access_reaction_comment/);
  assert.match(migration, /create function public\.get_shared_reaction_summary/);
  assert.match(migration, /create function public\.set_shared_question_reaction/);
  assert.match(migration, /create function public\.set_shared_comment_reaction/);
  assert.match(migration, /p_question_id uuid,\n  p_comment_id text/);
  assert.match(migration, /grant execute on function public\.get_shared_reaction_summary\(text, uuid\) to authenticated/);
  assert.match(migration, /grant execute on function public\.set_shared_question_reaction\(uuid, text, boolean\) to authenticated/);
  assert.match(migration, /grant execute on function public\.set_shared_comment_reaction\(uuid, text, text, boolean\) to authenticated/);
  assert.match(migration, /revoke all on function public\.get_shared_reaction_summary\(text, uuid\) from public, anon, authenticated, service_role/);
  assert.match(migration, /delete from public\.comment_reactions/);
  assert.doesNotMatch(migration, /notification/i);
});
