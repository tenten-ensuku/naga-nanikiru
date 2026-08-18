-- v115: collection creation through an auth.uid-owned RPC, public directory, and question import.

drop function if exists public.create_collection(text, text, uuid, text, boolean);
create function public.create_collection(
  p_title text,
  p_description text default '',
  p_workspace_id uuid default null,
  p_visibility text default 'private',
  p_allow_contributions boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_description text := coalesce(p_description, '');
  normalized_visibility text := lower(btrim(coalesce(p_visibility, 'private')));
  new_collection public.collections;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if char_length(normalized_title) not between 1 and 120 then
    raise exception 'collection title is invalid';
  end if;
  if char_length(normalized_description) > 3000 then
    raise exception 'collection description is too long';
  end if;
  if normalized_visibility not in ('private', 'request', 'public') then
    raise exception 'invalid collection visibility';
  end if;
  if p_workspace_id is not null and not private.is_workspace_member(p_workspace_id, current_user_id) then
    raise exception 'workspace membership is required';
  end if;

  insert into public.collections(
    owner_id,
    workspace_id,
    title,
    description,
    visibility,
    allow_contributions,
    published_at
  )
  values (
    current_user_id,
    p_workspace_id,
    normalized_title,
    normalized_description,
    normalized_visibility,
    coalesce(p_allow_contributions, true),
    case when normalized_visibility = 'private' then null else now() end
  )
  returning * into new_collection;

  return to_jsonb(new_collection);
end;
$$;

revoke all on function public.create_collection(text, text, uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.create_collection(text, text, uuid, text, boolean) to authenticated;

drop function if exists public.list_collection_directory();
create function public.list_collection_directory()
returns table (
  id uuid,
  share_slug text,
  title text,
  description text,
  visibility text,
  owner_id uuid,
  owner_name text,
  created_at timestamptz,
  can_view boolean,
  can_edit boolean,
  can_manage boolean,
  request_id uuid,
  request_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.share_slug,
    c.title,
    c.description,
    c.visibility,
    c.owner_id,
    owner_profile.display_name,
    c.created_at,
    private.can_access_collection(c.id),
    private.can_edit_collection_content(c.id),
    private.can_manage_collection(c.id),
    (select ar.id
       from public.collection_access_requests ar
      where ar.collection_id = c.id
        and ar.requester_id = (select auth.uid())
      order by ar.created_at desc
      limit 1),
    (select ar.status
       from public.collection_access_requests ar
      where ar.collection_id = c.id
        and ar.requester_id = (select auth.uid())
      order by ar.created_at desc
      limit 1)
  from public.collections c
  left join public.profiles owner_profile on owner_profile.id = c.owner_id
  where c.archived_at is null
    and c.published_at is not null
    and c.visibility in ('public', 'request', 'unlisted')
  order by c.created_at desc;
$$;

revoke all on function public.list_collection_directory() from public, anon, authenticated, service_role;
grant execute on function public.list_collection_directory() to anon, authenticated;

drop function if exists public.import_shared_question(uuid, text);
create function public.import_shared_question(
  p_source_question_id uuid,
  p_target_share_slug text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_question public.questions;
  target_collection public.collections;
  existing_question_id uuid;
  new_question_id uuid;
  next_number integer;
  next_sort_order integer;
  source_payload jsonb;
  imported_payload jsonb;
  creator_name text;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  select q.* into source_question
    from public.questions q
    join public.collections source_collection on source_collection.id = q.collection_id
   where q.id = p_source_question_id
     and q.deleted_at is null
     and source_collection.archived_at is null
     and private.can_access_collection(source_collection.id);
  if source_question.id is null then
    raise exception 'source question is not accessible';
  end if;

  select c.* into target_collection
    from public.collections c
   where c.share_slug = btrim(coalesce(p_target_share_slug, ''))
     and c.archived_at is null
     and private.can_edit_collection_content(c.id);
  if target_collection.id is null then
    raise exception 'target collection is not editable';
  end if;

  select q.id into existing_question_id
    from public.questions q
   where q.collection_id = target_collection.id
     and q.payload->>'importedFromQuestionId' = source_question.id::text
   order by q.created_at desc
   limit 1;
  if existing_question_id is not null then
    return existing_question_id;
  end if;

  select
    coalesce(max((q.payload->>'number')::integer) filter (where q.payload->>'number' ~ '^[0-9]+$'), 0) + 1,
    coalesce(max(q.sort_order), -1) + 1
    into next_number, next_sort_order
    from public.questions q
   where q.collection_id = target_collection.id;

  source_payload := case
    when jsonb_typeof(source_question.payload) = 'object' then source_question.payload
    else '{}'::jsonb
  end;
  imported_payload := jsonb_set(source_payload, '{number}', to_jsonb(next_number), true);
  imported_payload := jsonb_set(imported_payload, '{title}', to_jsonb(format('問題%s', next_number)), true);
  imported_payload := jsonb_set(imported_payload, '{importedFromQuestionId}', to_jsonb(source_question.id::text), true);
  imported_payload := jsonb_set(imported_payload, '{importedFromCollectionSlug}', to_jsonb((select share_slug from public.collections where id = source_question.collection_id)), true);
  imported_payload := jsonb_set(imported_payload, '{importedAt}', to_jsonb(now()), true);
  creator_name := coalesce(nullif((select p.display_name from public.profiles p where p.id = current_user_id), ''), '利用者');

  insert into public.questions(
    collection_id,
    created_by,
    created_by_name,
    title,
    legacy_key,
    sort_order,
    source_kind,
    source_report_id,
    source_url,
    scene_tw,
    scene_ts,
    scene_tv,
    decision_type,
    payload
  )
  values (
    target_collection.id,
    current_user_id,
    creator_name,
    format('問題%s', next_number),
    format('import:%s', source_question.id),
    next_sort_order,
    source_question.source_kind,
    source_question.source_report_id,
    source_question.source_url,
    source_question.scene_tw,
    source_question.scene_ts,
    source_question.scene_tv,
    source_question.decision_type,
    imported_payload
  )
  on conflict (collection_id, source_report_id, scene_tw, scene_ts, scene_tv) do nothing
  returning id into new_question_id;

  if new_question_id is null then
    select q.id into new_question_id
      from public.questions q
     where q.collection_id = target_collection.id
       and q.source_report_id is not distinct from source_question.source_report_id
       and q.scene_tw is not distinct from source_question.scene_tw
       and q.scene_ts is not distinct from source_question.scene_ts
       and q.scene_tv is not distinct from source_question.scene_tv
     order by q.created_at desc
     limit 1;
  end if;
  if new_question_id is null then
    raise exception 'question import failed';
  end if;
  return new_question_id;
end;
$$;

revoke all on function public.import_shared_question(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.import_shared_question(uuid, text) to authenticated;

create or replace function public.set_collection_visibility(p_collection_id uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_visibility not in ('private', 'request', 'public') then
    raise exception 'invalid collection visibility';
  end if;
  if not private.can_manage_collection(p_collection_id) then
    raise exception 'collection visibility update is not allowed';
  end if;
  update public.collections
     set visibility = p_visibility,
         published_at = case when p_visibility = 'private' then null else coalesce(published_at, now()) end,
         updated_at = now()
   where id = p_collection_id
     and archived_at is null;
end;
$$;

revoke all on function public.set_collection_visibility(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_collection_visibility(uuid, text) to authenticated;
