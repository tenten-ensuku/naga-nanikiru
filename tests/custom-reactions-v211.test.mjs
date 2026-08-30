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
const migration = read("supabase/migrations/20260830160223_custom_reactions_v211.sql");

test("V211 places the curated eight reactions first and removes duplicate labels", () => {
  assert.match(html, /const APP_VERSION = 212;/);
  assert.match(html, /const REACTION_TOP_KEYS_V211 = Object\.freeze\(\["like", "agree", "hard", "good-question", "important", "hmm", "policy", "mistake"\]\)/);
  assert.match(html, /id: "silent", storageKey: "silent", label: "ダマ"/);
  assert.match(html, /id: "exclamation", storageKey: "exclaim", label: "", icon: "❗"/);
  assert.match(html, /id: "question", storageKey: "question", label: "", icon: "❓"/);
  assert.match(html, /const topDefinitions = REACTION_TOP_KEYS_V211/);
  assert.match(html, /const standardDefinitions = \[\.\.\.topDefinitions, \.\.\.REACTION_DEFINITIONS_V209/);
  assert.match(html, /definition\.label \? `<span class="reaction-picker-label-v208">/);
  assert.match(html, /definition\.label \? `<span class="reaction-chip-label-v208">/);
});

test("V211 gives the picker standard/custom tabs and settings entry point", () => {
  assert.match(html, /data-reaction-tab="standard"/);
  assert.match(html, /data-reaction-tab="custom"/);
  assert.match(html, /id="reactionCustomPickerOptionsV211"/);
  assert.match(html, /data-reaction-open-settings/);
  assert.match(html, /function setReactionPickerTabV211\(/);
  assert.match(html, /function normalizeCustomReactionDefinitionsV211\(/);
  assert.match(html, /naga:custom-reactions/);
  assert.match(css, /V211: separate the curated set from shared custom reactions/);
  assert.match(css, /\.reaction-picker-option-v208\.is-icon-only/);
  assert.match(css, /\.reaction-picker-options-v208\s*\{\s*grid-template-columns: repeat\(4/);
  assert.match(css, /\.custom-reaction-settings-v211/);
});

test("V211 exposes custom reaction catalog APIs in the client bridge", () => {
  assert.match(syncClient, /async function loadCustomReactions\(\)/);
  assert.match(syncClient, /rpc\("list_custom_reactions"\)/);
  assert.match(syncClient, /async function createCustomReaction\(label: string, icon: string\)/);
  assert.match(syncClient, /rpc\("create_custom_reaction"/);
  assert.match(syncClient, /loadCustomReactions,/);
  assert.match(syncClient, /createCustomReaction,/);
});

test("V211 migration shares custom definitions while protecting reaction writes", () => {
  assert.match(migration, /create table if not exists public\.custom_reactions/);
  assert.match(migration, /reaction_key text primary key/);
  assert.match(migration, /creator_user_id uuid not null references public\.profiles/);
  assert.match(migration, /alter table public\.custom_reactions enable row level security/);
  assert.match(migration, /create policy custom_reactions_select/);
  assert.match(migration, /create policy custom_reactions_insert/);
  assert.match(migration, /create function public\.list_custom_reactions\(\)/);
  assert.match(migration, /create function public\.create_custom_reaction\(\n  p_label text,\n  p_icon text\n\)/);
  assert.match(migration, /private\.is_valid_shared_reaction_key/);
  assert.match(migration, /create trigger validate_question_reaction_key/);
  assert.match(migration, /create trigger validate_comment_reaction_key/);
  assert.match(migration, /on conflict \(question_id, user_id, reaction_key\) do nothing/);
  assert.match(migration, /on conflict \(question_id, comment_id, user_id, reaction_key\) do nothing/);
  assert.match(migration, /grant execute on function public\.list_custom_reactions\(\) to authenticated/);
  assert.match(migration, /grant execute on function public\.create_custom_reaction\(text, text\) to authenticated/);
});
