-- Replace the empty admin lookup table with a signed JWT app_metadata claim.
-- Only Supabase Auth administration can set app_metadata; browser clients cannot.
drop table if exists private.app_admins;

create or replace function private.is_app_admin(target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and target_user_id = (select auth.uid())
    and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

revoke all on function private.is_app_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_app_admin(uuid) to authenticated;

-- Supabase grants function execution broadly by default. Make every public RPC
-- opt-in so anonymous visitors can only read a shared problem collection.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

revoke all on function public.get_shared_collection(text) from public, anon, authenticated, service_role;
revoke all on function public.get_shared_questions(text) from public, anon, authenticated, service_role;
revoke all on function public.get_shared_comments(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.post_shared_comment(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_shared_attempt(text, uuid, uuid, jsonb, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.get_my_capabilities() from public, anon, authenticated, service_role;
revoke all on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.update_shared_question(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.trash_question(uuid) from public, anon, authenticated, service_role;
revoke all on function public.restore_question(uuid) from public, anon, authenticated, service_role;
revoke all on function public.request_question_deletion(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_question_deletion_request(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.permanently_delete_question(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.get_question_poll_stats(text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_shared_collection(text) to anon, authenticated;
grant execute on function public.get_shared_questions(text) to anon, authenticated;
grant execute on function public.get_shared_comments(text, uuid) to anon, authenticated;

grant execute on function public.post_shared_comment(text, uuid, text) to authenticated;
grant execute on function public.record_shared_attempt(text, uuid, uuid, jsonb, text, integer, timestamptz) to authenticated;
grant execute on function public.get_my_capabilities() to authenticated;
grant execute on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text) to authenticated;
grant execute on function public.update_shared_question(uuid, text, jsonb) to authenticated;
grant execute on function public.trash_question(uuid) to authenticated;
grant execute on function public.restore_question(uuid) to authenticated;
grant execute on function public.request_question_deletion(uuid, text) to authenticated;
grant execute on function public.resolve_question_deletion_request(uuid, boolean) to authenticated;
grant execute on function public.permanently_delete_question(uuid, text) to authenticated;
grant execute on function public.get_question_poll_stats(text, uuid) to authenticated;

-- Index foreign-key columns used by ownership, moderation, and history queries.
create index if not exists classes_workspace_idx on public.classes(workspace_id);
create index if not exists classes_created_by_idx on public.classes(created_by);
create index if not exists collections_owner_idx on public.collections(owner_id);
create index if not exists collections_workspace_idx on public.collections(workspace_id);
create index if not exists comments_question_idx on public.comments(question_id);
create index if not exists comments_user_idx on public.comments(user_id);
create index if not exists generation_candidates_question_idx on public.generation_candidates(created_question_id);
create index if not exists generation_jobs_collection_idx on public.generation_jobs(collection_id);
create index if not exists question_audit_events_collection_idx on public.question_audit_events(collection_id);
create index if not exists question_audit_events_actor_idx on public.question_audit_events(actor_id);
create index if not exists deletion_requests_requester_idx on public.question_deletion_requests(requester_id);
create index if not exists deletion_requests_resolved_by_idx on public.question_deletion_requests(resolved_by);
create index if not exists questions_created_by_idx on public.questions(created_by);
create index if not exists questions_updated_by_idx on public.questions(updated_by);
create index if not exists questions_deleted_by_idx on public.questions(deleted_by);
create index if not exists user_question_state_question_idx on public.user_question_state(question_id);
create index if not exists workspaces_owner_idx on public.workspaces(owner_id);
