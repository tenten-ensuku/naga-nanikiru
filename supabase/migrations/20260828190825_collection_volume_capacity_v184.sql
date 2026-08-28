-- v184: archive-aware learning totals and generic 200-question volumes.
-- Existing question IDs remain unchanged so answer attempts, comments and
-- browser-scoped personal markers continue to refer to the same questions.

-- A private, one-transaction capability lets the volume conversion move
-- questions without weakening the normal collection_id immutability guard.
create table if not exists private.collection_move_tokens (
  token uuid primary key,
  backend_pid integer not null,
  expires_at timestamptz not null default (now() + interval '5 minutes')
);

revoke all on table private.collection_move_tokens from public, anon, authenticated;

create or replace function private.prepare_question_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  collection_move_allowed boolean := exists (
    select 1
      from private.collection_move_tokens token
     where token.token::text = coalesce(current_setting('naga.collection_move_token', true), '')
       and token.backend_pid = pg_backend_pid()
       and token.expires_at > now()
  );
begin
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by
       or (new.collection_id is distinct from old.collection_id and not collection_move_allowed) then
      raise exception 'question ownership is immutable';
    end if;
    new.updated_by := coalesce(actor, new.updated_by, old.updated_by, new.created_by);
    new.updated_at := now();
    if old.deleted_at is null and new.deleted_at is not null then
      new.deleted_by := coalesce(actor, new.deleted_by);
    elsif old.deleted_at is not null and new.deleted_at is null then
      new.deleted_by := null;
    end if;
  else
    new.updated_by := coalesce(new.updated_by, actor, new.created_by);
  end if;

  select p.display_name into new.created_by_name
    from public.profiles p
   where p.id = new.created_by;
  select p.display_name into new.updated_by_name
    from public.profiles p
   where p.id = new.updated_by;
  return new;
end;
$function$;

-- くにたそ問題集は同じ親slugのまま第1巻・第2巻へ分ける。
-- 問題番号は既存payloadを基準にし、質問ID自体は変更しない。
do $migration$
declare
  parent public.collections%rowtype;
  volume record;
  volume_id uuid;
  move_token uuid := gen_random_uuid();
begin
  select c.*
    into parent
    from public.collections c
   where c.share_slug = '906571ede3684fa9b3d3e10e'
   for update;

  if not found then
    raise exception 'Kunitaso collection was not found';
  end if;

  update public.collections
     set series_key = coalesce(series_key, 'collection-' || replace(parent.id::text, '-', '')),
         updated_at = now()
   where id = parent.id;
  parent.series_key := coalesce(parent.series_key, 'collection-' || replace(parent.id::text, '-', ''));

  insert into private.collection_move_tokens(token, backend_pid)
  values (move_token, pg_backend_pid());
  perform set_config('naga.collection_move_token', move_token::text, true);

  for volume in
    select * from (values
      (1, 1, 200),
      (2, 201, 400)
    ) as ranges(volume_number, volume_start, volume_end)
  loop
    select c.id
      into volume_id
      from public.collections c
     where c.series_parent_id = parent.id
       and c.volume_number = volume.volume_number
     limit 1;

    if volume_id is null then
      insert into public.collections(
        owner_id, workspace_id, title, description, visibility, share_slug,
        allow_comments, allow_contributions, published_at, series_key,
        series_parent_id, volume_number, volume_start, volume_end
      )
      values (
        parent.owner_id, parent.workspace_id,
        format('%s 第%s巻', parent.title, volume.volume_number),
        format('問題%s〜%s。回答履歴・お気に入り・アーカイブはこの問題集内で引き継がれます。', volume.volume_start, volume.volume_end),
        parent.visibility, substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
        parent.allow_comments, parent.allow_contributions, parent.published_at,
        parent.series_key, parent.id, volume.volume_number,
        volume.volume_start, volume.volume_end
      )
      returning id into volume_id;
    else
      update public.collections
         set series_key = parent.series_key,
             series_parent_id = parent.id,
             volume_start = volume.volume_start,
             volume_end = volume.volume_end,
             updated_at = now()
       where id = volume_id;
    end if;

    update public.questions q
       set collection_id = volume_id,
           sort_order = (q.payload ->> 'number')::integer - volume.volume_start + 1,
           updated_at = now()
     where q.collection_id = parent.id
       and q.payload ->> 'number' ~ '^[0-9]+$'
       and (q.payload ->> 'number')::integer between volume.volume_start and volume.volume_end;

    update public.comments cm
       set collection_id = q.collection_id,
           updated_at = now()
      from public.questions q
     where cm.collection_id = parent.id
       and cm.question_id = q.id
       and q.collection_id = volume_id;

    update public.question_audit_events qa
       set collection_id = q.collection_id
      from public.questions q
     where qa.collection_id = parent.id
       and qa.question_id = q.id
       and q.collection_id = volume_id;

    volume_id := null;
  end loop;

  delete from private.collection_move_tokens where token = move_token;
end;
$migration$;

-- 親slug・子巻slugのどちらを受け取っても、番号に応じた既存巻へ格納する。
create or replace function private.route_pierre_question_to_volume()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_collection public.collections%rowtype;
  target_collection_id uuid;
  root_collection_id uuid;
  question_number integer;
  target_volume integer;
begin
  select c.* into source_collection
    from public.collections c
   where c.id = new.collection_id;
  if not found or source_collection.series_key is null then
    return new;
  end if;
  if new.payload ->> 'number' !~ '^[0-9]+$' then
    return new;
  end if;

  question_number := (new.payload ->> 'number')::integer;
  if question_number < 1 then
    return new;
  end if;
  target_volume := ((question_number - 1) / 200) + 1;
  root_collection_id := coalesce(source_collection.series_parent_id, source_collection.id);

  select c.id into target_collection_id
    from public.collections c
   where c.series_parent_id = root_collection_id
     and c.volume_number = target_volume
     and c.archived_at is null
   limit 1;
  if target_collection_id is null then
    return new;
  end if;

  new.collection_id := target_collection_id;
  new.sort_order := question_number - ((target_volume - 1) * 200);
  return new;
end;
$function$;

create or replace function private.refresh_pierre_volume_bound()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  question_number integer;
  target_volume integer;
begin
  if new.payload ->> 'number' !~ '^[0-9]+$' then
    return new;
  end if;
  question_number := (new.payload ->> 'number')::integer;
  if question_number < 1 then
    return new;
  end if;
  target_volume := ((question_number - 1) / 200) + 1;
  update public.collections c
     set volume_end = greatest(c.volume_end, question_number),
         updated_at = now()
   where c.id = new.collection_id
     and c.series_parent_id is not null
     and c.volume_number = target_volume;
  return new;
end;
$function$;

-- 問題集を200問単位のシリーズへ変換し、指定巻まで作成する。
create or replace function public.create_collection_volume(
  p_share_slug text,
  p_volume_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  requested_collection public.collections%rowtype;
  root_collection public.collections%rowtype;
  volume record;
  volume_id uuid;
  requested_volume integer;
  required_volume integer := 1;
  maximum_number integer := 0;
  move_token uuid := gen_random_uuid();
  created_volume_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if p_volume_number is not null and (p_volume_number < 1 or p_volume_number > 100) then
    raise exception 'invalid volume number';
  end if;

  select c.* into requested_collection
    from public.collections c
   where c.share_slug = p_share_slug
     and c.archived_at is null
   limit 1;
  if not found or not private.can_manage_collection(requested_collection.id) then
    raise exception 'the collection owner or administrator is required to create a volume';
  end if;

  select c.* into root_collection
    from public.collections c
   where c.id = coalesce(requested_collection.series_parent_id, requested_collection.id)
   for update;

  select coalesce(max((q.payload ->> 'number')::integer), 0)
    into maximum_number
    from public.questions q
   where q.collection_id = root_collection.id
     and q.payload ->> 'number' ~ '^[0-9]+$';
  if root_collection.series_key is not null then
    select greatest(maximum_number, coalesce(max((q.payload ->> 'number')::integer), 0))
      into maximum_number
      from public.questions q
      join public.collections c on c.id = q.collection_id
     where (c.id = root_collection.id or c.series_parent_id = root_collection.id)
       and q.payload ->> 'number' ~ '^[0-9]+$';
  end if;
  required_volume := greatest(1, ((greatest(maximum_number, 1) - 1) / 200) + 1);
  requested_volume := greatest(required_volume, coalesce(p_volume_number, 1));

  if root_collection.series_key is null then
    update public.collections
       set series_key = 'collection-' || replace(root_collection.id::text, '-', ''),
           updated_at = now()
     where id = root_collection.id;
    root_collection.series_key := 'collection-' || replace(root_collection.id::text, '-', '');

    insert into private.collection_move_tokens(token, backend_pid)
    values (move_token, pg_backend_pid());
    perform set_config('naga.collection_move_token', move_token::text, true);
  end if;

  for volume in
    select number as volume_number, (number - 1) * 200 + 1 as volume_start, number * 200 as volume_end
      from generate_series(1, requested_volume) as numbers(number)
  loop
    select c.id into volume_id
      from public.collections c
     where c.series_parent_id = root_collection.id
       and c.volume_number = volume.volume_number
     limit 1;

    if volume_id is null then
      insert into public.collections(
        owner_id, workspace_id, title, description, visibility, share_slug,
        allow_comments, allow_contributions, published_at, series_key,
        series_parent_id, volume_number, volume_start, volume_end
      )
      values (
        root_collection.owner_id, root_collection.workspace_id,
        format('%s 第%s巻', root_collection.title, volume.volume_number),
        format('問題%s〜%s。回答履歴・お気に入り・アーカイブはこの問題集内で引き継がれます。', volume.volume_start, volume.volume_end),
        root_collection.visibility, substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
        root_collection.allow_comments, root_collection.allow_contributions,
        root_collection.published_at, root_collection.series_key, root_collection.id,
        volume.volume_number, volume.volume_start, volume.volume_end
      )
      returning id into volume_id;
      created_volume_count := created_volume_count + 1;
    else
      update public.collections
         set series_key = root_collection.series_key,
             series_parent_id = root_collection.id,
             volume_start = volume.volume_start,
             volume_end = greatest(volume.volume_end, volume.volume_start),
             updated_at = now()
       where id = volume_id;
    end if;

    if root_collection.id = requested_collection.id and requested_collection.series_key is null then
      update public.questions q
         set collection_id = volume_id,
             sort_order = (q.payload ->> 'number')::integer - volume.volume_start + 1,
             updated_at = now()
       where q.collection_id = root_collection.id
         and q.payload ->> 'number' ~ '^[0-9]+$'
         and (q.payload ->> 'number')::integer between volume.volume_start and volume.volume_end;

      update public.comments cm
         set collection_id = q.collection_id,
             updated_at = now()
        from public.questions q
       where cm.collection_id = root_collection.id
         and cm.question_id = q.id
         and q.collection_id = volume_id;

      update public.question_audit_events qa
         set collection_id = q.collection_id
        from public.questions q
       where qa.collection_id = root_collection.id
         and qa.question_id = q.id
         and q.collection_id = volume_id;
    end if;
    volume_id := null;
  end loop;

  if root_collection.series_key is not null and exists (
    select 1 from private.collection_move_tokens where token = move_token
  ) then
    delete from private.collection_move_tokens where token = move_token;
  elsif root_collection.series_key is null then
    delete from private.collection_move_tokens where token = move_token;
  end if;

  return jsonb_build_object(
    'share_slug', root_collection.share_slug,
    'volume_number', requested_volume,
    'created_volume_count', created_volume_count,
    'question_count', maximum_number
  );
end;
$function$;

-- 追加先が満杯になったときは、UIが確認してから巻を作れるよう返す。
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_collection public.collections%rowtype;
  root_collection public.collections%rowtype;
  target_volume_collection public.collections%rowtype;
  existing_question_id uuid;
  new_question_id uuid;
  target_number integer;
  target_volume integer;
  normalized_payload jsonb;
  is_series boolean;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(coalesce(p_title, '')) > 160 then raise exception 'question title is too long'; end if;
  if p_source_kind not in ('manual', 'discord', 'naga_scene', 'naga_match') then raise exception 'invalid source kind'; end if;
  if p_decision_type not in ('discard', 'call', 'riichi', 'combined') then raise exception 'invalid decision type'; end if;

  select c.* into target_collection
    from public.collections c
   where c.share_slug = p_share_slug
     and c.archived_at is null
   limit 1;
  if not found or not private.can_contribute_collection(target_collection.id) then
    raise exception 'an owner or editor member is required to add questions';
  end if;

  select c.* into root_collection
    from public.collections c
   where c.id = coalesce(target_collection.series_parent_id, target_collection.id)
   for update;
  is_series := root_collection.series_key is not null;

  -- シリーズ内では親・全巻を横断して同一局面を確認する。
  select q.id into existing_question_id
    from public.questions q
    join public.collections c on c.id = q.collection_id
   where (c.id = root_collection.id or (is_series and c.series_parent_id = root_collection.id))
     and q.source_report_id is not distinct from p_source_report_id
     and q.scene_tw is not distinct from p_scene_tw
     and q.scene_ts is not distinct from p_scene_ts
     and q.scene_tv is not distinct from p_scene_tv
   order by q.created_at asc
   limit 1;
  if existing_question_id is not null then
    return jsonb_build_object('question_id', existing_question_id, 'already_exists', true);
  end if;

  select coalesce(max(case when q.payload ->> 'number' ~ '^[0-9]+$' then (q.payload ->> 'number')::integer end), 0) + 1
    into target_number
    from public.questions q
    join public.collections c on c.id = q.collection_id
   where c.id = root_collection.id
      or (is_series and c.series_parent_id = root_collection.id);

  if not is_series and target_number > 200 then
    return jsonb_build_object(
      'capacity_reached', true,
      'requires_volume_confirmation', true,
      'next_volume', ((target_number - 1) / 200) + 1,
      'parent_share_slug', root_collection.share_slug,
      'collection_title', root_collection.title,
      'question_count', target_number - 1
    );
  end if;

  if is_series then
    target_volume := ((target_number - 1) / 200) + 1;
    select c.* into target_volume_collection
      from public.collections c
     where c.series_parent_id = root_collection.id
       and c.volume_number = target_volume
       and c.archived_at is null
     for update;
    if not found then
      return jsonb_build_object(
        'capacity_reached', true,
        'requires_volume_confirmation', true,
        'next_volume', target_volume,
        'parent_share_slug', root_collection.share_slug,
        'collection_title', root_collection.title,
        'question_count', target_number - 1
      );
    end if;
  else
    target_volume_collection := root_collection;
    target_volume := 1;
  end if;

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
    target_volume_collection.id, (select auth.uid()), format('問題%s', target_number), p_source_kind,
    p_source_report_id, p_source_url, p_scene_tw, p_scene_ts, p_scene_tv,
    p_decision_type, normalized_payload
  ) on conflict do nothing returning id into new_question_id;

  if new_question_id is not null then
    return jsonb_build_object(
      'question_id', new_question_id,
      'already_exists', false,
      'volume_number', target_volume,
      'share_slug', target_volume_collection.share_slug
    );
  end if;

  select q.id into existing_question_id
    from public.questions q
    join public.collections c on c.id = q.collection_id
   where (c.id = root_collection.id or (is_series and c.series_parent_id = root_collection.id))
     and q.source_report_id is not distinct from p_source_report_id
     and q.scene_tw is not distinct from p_scene_tw
     and q.scene_ts is not distinct from p_scene_ts
     and q.scene_tv is not distinct from p_scene_tv
   order by q.created_at asc
   limit 1;
  if existing_question_id is null then raise exception 'question could not be created'; end if;
  return jsonb_build_object('question_id', existing_question_id, 'already_exists', true);
end;
$function$;

revoke all on function public.create_collection_volume(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.create_collection_volume(text, integer) to authenticated;
revoke all on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text)
  to authenticated;
