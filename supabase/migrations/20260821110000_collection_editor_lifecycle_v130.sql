-- V130: make approved editor members equal contributors for daily collection work.
--
-- Collection owners and application administrators remain the only users who
-- can change visibility, manage members, transfer ownership, or permanently
-- delete a question. An active editor member can now create/import questions,
-- edit question content, and archive/restore questions.

create or replace function private.can_access_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.collections c
    where c.id = target_collection_id
      and c.archived_at is null
      and (
        c.owner_id = (select auth.uid())
        or private.is_app_admin()
        or (c.published_at is not null and c.visibility in ('public', 'unlisted'))
        or (c.visibility = 'workspace' and private.is_workspace_member(c.workspace_id))
        or (c.visibility in ('private', 'limited', 'request') and exists (
          select 1
          from public.collection_members cm
          where cm.collection_id = c.id
            and cm.user_id = (select auth.uid())
            and cm.status = 'active'
        ))
      )
  );
$$;
create or replace function private.can_archive_question_lifecycle(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.can_edit_collection_content(target_collection_id);
$$;

revoke all on function private.can_archive_question_lifecycle(uuid) from public, anon, authenticated;
grant execute on function private.can_archive_question_lifecycle(uuid) to authenticated;

-- Keep this compatibility function name, but give it the editor permission
-- used by both direct inserts and the shared-question RPC.
create or replace function private.can_contribute_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.can_edit_collection_content(target_collection_id);
$$;

drop policy if exists questions_select_trash on public.questions;
create policy questions_select_trash on public.questions for select to authenticated
using (deleted_at is not null and private.can_archive_question_lifecycle(collection_id));

drop policy if exists questions_insert on public.questions;
create policy questions_insert on public.questions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.can_contribute_collection(collection_id)
);

-- Permanent deletion remains an owner/administrator operation.
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
  target_number integer;
  normalized_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(coalesce(p_title, '')) > 160 then raise exception 'question title is too long'; end if;
  if p_source_kind not in ('manual', 'discord', 'naga_scene', 'naga_match') then raise exception 'invalid source kind'; end if;
  if p_decision_type not in ('discard', 'call', 'riichi', 'combined') then raise exception 'invalid decision type'; end if;

  select c.id into target_collection_id
  from public.collections c
  where c.share_slug = p_share_slug
    and c.archived_at is null;
  if target_collection_id is null or not private.can_contribute_collection(target_collection_id) then
    raise exception 'an owner or editor member is required to add questions';
  end if;

  -- The number belongs to the destination collection, never to the source
  -- collection or the browser currently displaying the generator.
  select coalesce(max((q.payload ->> 'number')::integer), 0) + 1
    into target_number
  from public.questions q
  where q.collection_id = target_collection_id
    and (q.payload ->> 'number') ~ '^[0-9]+$';

  normalized_payload := case
    when jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object' then coalesce(p_payload, '{}'::jsonb)
    else '{}'::jsonb
  end;
  normalized_payload := jsonb_set(normalized_payload, '{number}', to_jsonb(target_number), true);
  normalized_payload := jsonb_set(normalized_payload, '{title}', to_jsonb(format('問題%s', target_number)), true);

  insert into public.questions(
    collection_id, created_by, title, source_kind, source_report_id, source_url,
    scene_tw, scene_ts, scene_tv, decision_type, payload
  ) values (
    target_collection_id, (select auth.uid()), format('問題%s', target_number), p_source_kind,
    p_source_report_id, p_source_url, p_scene_tw, p_scene_ts, p_scene_tv,
    p_decision_type, normalized_payload
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
  if target_collection_id is null or not private.can_archive_question_lifecycle(target_collection_id) then
    raise exception 'an owner or editor member is required to archive questions';
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
  if target_collection_id is null or not private.can_archive_question_lifecycle(target_collection_id) then
    raise exception 'an owner or editor member is required to restore questions';
  end if;
  update public.questions
  set deleted_at = null, deleted_by = null
  where id = p_question_id and deleted_at is not null;
end;
$$;

-- Do not loosen this function: permanent deletion remains owner/admin only.
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
