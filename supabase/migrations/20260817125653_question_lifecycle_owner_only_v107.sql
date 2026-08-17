-- V107: only the application owner or collection owner may add, trash, restore,
-- or permanently delete shared questions. Editors may still edit question
-- content and all permitted members may answer and comment.

create or replace function private.can_manage_question_lifecycle(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.collections c
    where c.id = target_collection_id
      and c.archived_at is null
      and (
        c.owner_id = (select auth.uid())
        or private.is_app_admin()
      )
  );
$$;

revoke all on function private.can_manage_question_lifecycle(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_question_lifecycle(uuid) to authenticated;

-- The old contribution switch allowed public contributors and collection
-- editors to insert questions. Keep the function name for compatibility, but
-- make its authorization match the owner-only lifecycle policy.
create or replace function private.can_contribute_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_question_lifecycle(target_collection_id);
$$;

drop policy if exists questions_select_trash on public.questions;
create policy questions_select_trash on public.questions for select to authenticated
using (deleted_at is not null and private.can_manage_question_lifecycle(collection_id));

drop policy if exists questions_insert on public.questions;
create policy questions_insert on public.questions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.can_manage_question_lifecycle(collection_id)
);

drop policy if exists questions_delete on public.questions;
create policy questions_delete on public.questions for delete to authenticated
using (private.can_manage_question_lifecycle(collection_id));

create or replace function public.create_shared_question(
  p_share_slug text,
  p_title text,
  p_payload jsonb,
  p_source_kind text default 'manual',
  p_source_report_id text default null,
  p_source_url text default null,
  p_scene_tw smallint default null,
  p_scene_ts integer default null,
  p_scene_tv integer default null,
  p_decision_type text default 'discard'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_collection_id uuid;
  new_question_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(coalesce(p_title, '')) > 160 then raise exception 'question title is too long'; end if;
  if p_source_kind not in ('manual', 'discord', 'naga_scene', 'naga_match') then raise exception 'invalid source kind'; end if;
  if p_decision_type not in ('discard', 'call', 'riichi', 'combined') then raise exception 'invalid decision type'; end if;
  select c.id into target_collection_id
  from public.collections c
  where c.share_slug = p_share_slug
    and c.archived_at is null;
  if target_collection_id is null or not private.can_manage_question_lifecycle(target_collection_id) then
    raise exception 'only the application or collection owner may add questions';
  end if;
  insert into public.questions(
    collection_id, created_by, title, source_kind, source_report_id, source_url,
    scene_tw, scene_ts, scene_tv, decision_type, payload
  ) values (
    target_collection_id, (select auth.uid()), coalesce(p_title, ''), p_source_kind,
    p_source_report_id, p_source_url, p_scene_tw, p_scene_ts, p_scene_tv,
    p_decision_type, coalesce(p_payload, '{}'::jsonb)
  ) returning id into new_question_id;
  return new_question_id;
end;
$$;

create or replace function public.trash_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_collection_id uuid;
begin
  select q.collection_id into target_collection_id
  from public.questions q
  where q.id = p_question_id and q.deleted_at is null;
  if target_collection_id is null or not private.can_manage_question_lifecycle(target_collection_id) then
    raise exception 'only the application or collection owner may trash questions';
  end if;
  update public.questions
  set deleted_at = now(), deleted_by = (select auth.uid())
  where id = p_question_id and deleted_at is null;
end;
$$;

create or replace function public.restore_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_collection_id uuid;
begin
  select q.collection_id into target_collection_id
  from public.questions q
  where q.id = p_question_id and q.deleted_at is not null;
  if target_collection_id is null or not private.can_manage_question_lifecycle(target_collection_id) then
    raise exception 'only the application or collection owner may restore questions';
  end if;
  update public.questions
  set deleted_at = null, deleted_by = null
  where id = p_question_id and deleted_at is not null;
end;
$$;

create or replace function public.permanently_delete_question(p_question_id uuid, p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_collection_id uuid;
begin
  select q.collection_id into target_collection_id
  from public.questions q
  where q.id = p_question_id;
  if target_collection_id is null or not private.can_manage_question_lifecycle(target_collection_id) then
    raise exception 'only the application or collection owner may permanently delete questions';
  end if;
  if p_confirmation <> '完全削除' then
    raise exception 'confirmation text is invalid';
  end if;
  delete from public.questions where id = p_question_id;
end;
$$;

-- Allow the application owner or current collection owner to hand ownership
-- to an already approved active member without exposing auth.users to the browser.
create or replace function public.transfer_collection_ownership(
  p_collection_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_collection(p_collection_id) then
    raise exception 'collection ownership transfer is not allowed';
  end if;
  if p_user_id is null or not exists (
    select 1
    from public.collection_members cm
    where cm.collection_id = p_collection_id
      and cm.user_id = p_user_id
      and cm.status = 'active'
  ) then
    raise exception 'new owner must be an active collection member';
  end if;
  update public.collections
  set owner_id = p_user_id, updated_at = now()
  where id = p_collection_id and archived_at is null;
  if not found then raise exception 'collection not found'; end if;
end;
$$;

revoke all on function public.transfer_collection_ownership(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.transfer_collection_ownership(uuid, uuid) to authenticated;
