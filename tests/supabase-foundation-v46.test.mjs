import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260803165942_learning_platform_core.sql", import.meta.url);
const ownerProgressMigrationPath = new URL("../supabase/migrations/20260815173000_owner_only_student_progress_v84.sql", import.meta.url);
const pollAttemptMigrationPath = new URL("../supabase/migrations/20260817141847_poll_counts_all_attempts_v110.sql", import.meta.url);

test("restricts student progress to the application owner and enrolls future users", async () => {
  const sql = await fs.readFile(ownerProgressMigrationPath, "utf8");
  assert.match(sql, /create or replace function private\.can_view_student[\s\S]*private\.is_app_admin\(\)/i);
  assert.match(sql, /owner_member\.role = 'owner'/i);
  assert.match(sql, /student_member\.role = 'student'/i);
  assert.match(sql, /create or replace function private\.add_default_naga_student/i);
  assert.match(sql, /on_profile_created_add_default_naga_student/i);
  assert.match(sql, /NAGA問題集/i);
});

test("enables RLS and scopes private learning history", async () => {
  const sql = await fs.readFile(migrationPath, "utf8");
  for (const table of ["profiles", "workspaces", "workspace_members", "classes", "class_members", "collections", "questions", "answer_attempts", "user_question_state", "comments", "question_deletion_requests", "question_audit_events", "generation_jobs", "generation_candidates"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /user_id = \(select auth\.uid\(\)\) or private\.can_view_student\(user_id\)/i);
  assert.match(sql, /create policy question_state_select[\s\S]*user_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(sql, /raw_user_meta_data[\s\S]{0,200}(policy|using|with check)/i);
  assert.doesNotMatch(sql, /create table private\.app_admins/i);
  assert.match(sql, /auth\.jwt\(\)[\s\S]*app_metadata[\s\S]*is_admin/i);
});

test("keeps unlisted collections behind token-scoped RPCs", async () => {
  const sql = await fs.readFile(migrationPath, "utf8");
  assert.match(sql, /visibility text[\s\S]*'unlisted'/i);
  assert.match(sql, /create or replace function public\.get_shared_collection\(p_share_slug text\)/i);
  assert.match(sql, /create or replace function public\.get_shared_questions\(p_share_slug text\)/i);
  assert.match(sql, /create or replace function public\.post_shared_comment/i);
  assert.match(sql, /authentication required/i);
  const directCollectionPolicy = sql.match(/create policy collections_select[\s\S]*?;/i)?.[0] ?? "";
  assert.doesNotMatch(directCollectionPolicy, /unlisted/i);
  assert.match(sql, /values \('question-assets', 'question-assets', false,/i);
});

test("separates personal authorship, community contributions, moderation, and permanent deletion", async () => {
  const sql = await fs.readFile(migrationPath, "utf8");
  assert.match(sql, /allow_contributions boolean not null default true/i);
  assert.match(sql, /create or replace function private\.can_edit_question/i);
  assert.match(sql, /q\.created_by = \(select auth\.uid\(\)\)[\s\S]*private\.can_manage_collection/i);
  const manageFunction = sql.match(/create or replace function private\.can_manage_collection[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(manageFunction, /c\.owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(manageFunction, /private\.is_app_admin\(\)/i);
  assert.doesNotMatch(manageFunction, /is_workspace_admin/i);
  assert.match(sql, /create policy questions_insert[\s\S]*private\.can_contribute_collection/i);
  assert.match(sql, /create policy questions_update[\s\S]*private\.can_edit_question/i);
  assert.match(sql, /create policy questions_delete[\s\S]*private\.is_app_admin/i);
  assert.match(sql, /create or replace function public\.request_question_deletion/i);
  assert.match(sql, /create or replace function public\.permanently_delete_question/i);
  assert.match(sql, /p_confirmation <> '完全削除'/i);
  assert.match(sql, /create trigger log_question_change/i);
  assert.match(sql, /revoke all on function public\.create_shared_question[\s\S]*from public, anon, authenticated, service_role/i);
});

test("publishes anonymous first-answer stats only after five responses and after the viewer answers", async () => {
  const sql = await fs.readFile(migrationPath, "utf8");
  const statsFunction = sql.match(/create or replace function public\.get_question_poll_stats[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(statsFunction, /distinct on \(a\.user_id\)/i);
  assert.match(statsFunction, /t\.n >= 5/i);
  assert.match(statsFunction, /mine\.user_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(statsFunction, /display_name|discord_user_id|avatar_url/i);
});

test("counts every submitted answer event in community vote totals", async () => {
  const sql = await fs.readFile(pollAttemptMigrationPath, "utf8");
  const statsFunction = sql.match(/create or replace function public\.get_question_poll_stats[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.doesNotMatch(statsFunction, /distinct on \(a\.user_id\)/i);
  assert.match(statsFunction, /from all_attempts[\s\S]*count\(\*\)/i);
  assert.match(statsFunction, /t\.n > 0/i);
  assert.match(statsFunction, /answer ->> 'riichi'/i);
  assert.match(sql, /grant execute on function public\.get_question_poll_stats\(text, uuid\) to authenticated/i);
});

test("pins Supabase dependencies and protects the NAGA proxy", async () => {
  const [packageJson, denoJson, edgeFunction, runtimeConfig, clientSource] = await Promise.all([
    fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
    fs.readFile(new URL("../supabase/functions/naga-report/deno.json", import.meta.url), "utf8"),
    fs.readFile(new URL("../supabase/functions/naga-report/index.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/runtime-config.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../client/supabase-sync.ts", import.meta.url), "utf8"),
  ]);
  assert.match(packageJson, /"@supabase\/supabase-js": "2\.110\.8"/);
  assert.match(packageJson, /"supabase": "2\.110\.0"/);
  assert.match(denoJson, /@supabase\/supabase-js@2\.110\.8/);
  assert.match(edgeFunction, /createClient\(supabaseUrl, supabaseAnonKey/);
  assert.match(edgeFunction, /supabase\.auth\.getUser\(\)/);
  assert.match(edgeFunction, /https:\/\/naga\.dmv\.nico\/reports\/\$\{reportId\}\.json/);
  assert.match(runtimeConfig, /Never put a Supabase secret\/service-role key here/);
  assert.doesNotMatch(runtimeConfig, /sb_secret_|service_role\s*:/i);
  assert.match(clientSource, /provider: "discord"/);
  assert.match(clientSource, /function clearAuthCallbackUrl\(\)/);
  assert.match(clientSource, /function buildOAuthRedirectUrl\(\)/);
  assert.match(clientSource, /redirectTo: buildOAuthRedirectUrl\(\)/);
  assert.match(clientSource, /naga:autherror/);
  assert.match(clientSource, /importLocalHistory/);
  assert.match(clientSource, /async function loadMyAttempts\(limit = 500\)/);
  assert.match(clientSource, /answer_attempts/);
  assert.match(clientSource, /createSharedQuestion/);
  assert.match(clientSource, /updateSharedComment/);
  assert.match(clientSource, /deleteSharedComment/);
  assert.match(clientSource, /updateProfileDisplayName/);
  assert.match(clientSource, /requestQuestionDeletion/);
  assert.match(clientSource, /loadQuestionPollStats/);
});

test("scopes shared comment edits and deletes to authenticated owners or managers", async () => {
  const migration = await fs.readFile(new URL("../supabase/migrations/20260814210757_comment_edit_delete.sql", import.meta.url), "utf8");
  assert.match(migration, /create policy comments_update[\s\S]*user_id = \(select auth\.uid\(\)\)[\s\S]*private\.can_manage_collection/i);
  assert.match(migration, /create function public\.update_shared_comment[\s\S]*security invoker/i);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)[\s\S]*deleted_at is null[\s\S]*returning id into updated_comment_id/i);
  assert.match(migration, /create function public\.delete_shared_comment[\s\S]*security invoker/i);
  assert.match(migration, /grant execute on function public\.update_shared_comment\(uuid, text, jsonb\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.delete_shared_comment\(uuid\) to authenticated/i);
});

test("generates browser runtime config without accepting server secrets", async () => {
  const [writer, workflow] = await Promise.all([
    fs.readFile(new URL("../scripts/write-runtime-config.mjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
  ]);
  assert.match(writer, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(writer, /sb_secret_/);
  assert.match(writer, /Only the browser-safe Supabase publishable key is allowed/);
  assert.doesNotMatch(workflow, /SUPABASE_SECRET_KEY|service_role/i);
  assert.match(workflow, /npm run runtime:config/);
  assert.match(workflow, /path: public/);
});

test("supports private collection spaces and owner-reviewed access requests", async () => {
  const [migration, memberMigration, clientSource, html] = await Promise.all([
    fs.readFile(new URL("../supabase/migrations/20260816120000_collection_access_control_v100.sql", import.meta.url), "utf8"),
    fs.readFile(new URL("../supabase/migrations/20260816123000_collection_access_members_v100.sql", import.meta.url), "utf8"),
    fs.readFile(new URL("../client/supabase-sync.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /check \(visibility in \('private', 'request', 'limited', 'public'/i);
  for (const table of ["collection_members", "collection_access_requests", "collection_access_notifications"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(migration, /request_collection_access[\s\S]*auth\.uid\(\)/i);
  assert.match(migration, /review_collection_access[\s\S]*collection_members/i);
  assert.match(migration, /revoke_collection_access[\s\S]*status = 'revoked'/i);
  assert.match(memberMigration, /list_collection_members[\s\S]*can_manage_collection/i);
  assert.match(clientSource, /const visibility = input\.visibility \?\? "private"/i);
  assert.match(clientSource, /loadMyCollections|requestCollectionAccess|reviewCollectionAccess|revokeCollectionAccess/i);
  assert.match(html, /const APP_VERSION = 110/);
  assert.match(html, /id="collectionSpacePanel"/);
  assert.doesNotMatch(html, /data-menu-view="collections"/);
  assert.match(html, /data-menu-view="my"/);
  assert.match(html, /collectionCreateFormMarkupV106/);
  assert.match(html, /id="collectionCreateInlinePanel"/);
  assert.match(html, /collectionCreateFormMarkupV106\("collectionCreateInline"\)/);
  assert.match(html, /\$\{prefix\}Visibility/);
  assert.match(html, /くにたそ問題集/);
  assert.match(html, /renderCollectionDirectoryV101/);
  assert.match(html, /閲覧申請を送る/);
  assert.match(html, /新しく作る問題集は、最初は必ずプライベート/);
});

test("preassigns the verified Kakisaki Nima account as the collection owner", async () => {
  const [migration, html] = await Promise.all([
    fs.readFile(new URL("../supabase/migrations/20260817132405_kakisakinima_collection_owner_v108.sql", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /display_name = 'kakisakinima'/i);
  assert.match(migration, /public\.answer_attempts/);
  assert.match(migration, /title = '垣崎にま問題集'/i);
  assert.match(migration, /set owner_id = target_user_id/i);
  assert.match(html, /const APP_VERSION = 110/);
  assert.match(html, /垣崎にまさんを問題集オーナーに設定しました/);
});

test("limits shared question lifecycle mutations to the application or collection owner", async () => {
  const [migration, clientSource, html] = await Promise.all([
    fs.readFile(new URL("../supabase/migrations/20260817125653_question_lifecycle_owner_only_v107.sql", import.meta.url), "utf8"),
    fs.readFile(new URL("../client/supabase-sync.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /create or replace function private\.can_manage_question_lifecycle/i);
  assert.match(migration, /c\.owner_id = \(select auth\.uid\(\)\)[\s\S]*private\.is_app_admin\(\)/i);
  assert.match(migration, /create policy questions_insert[\s\S]*private\.can_manage_question_lifecycle/i);
  assert.match(migration, /create policy questions_delete[\s\S]*private\.can_manage_question_lifecycle/i);
  assert.match(migration, /create or replace function public\.trash_question[\s\S]*private\.can_manage_question_lifecycle/i);
  assert.match(migration, /create or replace function public\.permanently_delete_question[\s\S]*private\.can_manage_question_lifecycle/i);
  assert.match(migration, /create or replace function public\.transfer_collection_ownership[\s\S]*active collection member/i);
  assert.match(clientSource, /async function transferCollectionOwnership\(collectionId: string, userId: string\)/i);
  assert.match(clientSource, /transfer_collection_ownership/i);
  assert.match(html, /オーナーにする/);
  assert.match(html, /共有問題集への問題追加は、アプリ所有者または問題集オーナーだけが行えます/);
});
