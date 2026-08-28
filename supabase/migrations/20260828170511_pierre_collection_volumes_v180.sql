-- ピエール問題集を既存の問題IDを保ったまま、9つの軽量な巻へ分割する。
-- 親コレクションのshare_slugは互換用に残し、問題は子コレクションへ移す。

alter table public.collections
  add column if not exists series_key text,
  add column if not exists series_parent_id uuid references public.collections(id) on delete cascade,
  add column if not exists volume_number integer,
  add column if not exists volume_start integer,
  add column if not exists volume_end integer;

create index if not exists collections_series_parent_idx
  on public.collections(series_parent_id, volume_number)
  where series_parent_id is not null and archived_at is null;

create index if not exists collections_series_key_idx
  on public.collections(series_key, volume_number)
  where series_key is not null and archived_at is null;

-- 既存トリガーは通常の編集でcollection_idを変えないための保護。
-- 今回だけ所属移動を行い、完了直後に同じトリガーを復元する。
drop trigger if exists prepare_question_write on public.questions;

do $migration$
declare
  pierre public.collections%rowtype;
  volume record;
  volume_id uuid;
begin
  select c.*
    into pierre
    from public.collections c
   where c.share_slug = '36375789797246e59e670802'
   for update;

  if not found then
    raise exception 'Pierre collection was not found';
  end if;

  update public.collections
     set series_key = 'pierre',
         updated_at = now(),
         description = case
           when description like 'ピエール問題集 全9巻。巻を選んで学習します。%' then description
           else 'ピエール問題集 全9巻。巻を選んで学習します。'
         end
   where id = pierre.id;

  for volume in
    select * from (values
      (1, 1, 200),
      (2, 201, 400),
      (3, 401, 600),
      (4, 601, 800),
      (5, 801, 1000),
      (6, 1001, 1200),
      (7, 1201, 1400),
      (8, 1401, 1600),
      (9, 1601, 1754)
    ) as ranges(volume_number, volume_start, volume_end)
  loop
    select c.id
      into volume_id
      from public.collections c
     where c.series_parent_id = pierre.id
       and c.volume_number = volume.volume_number
     limit 1;

    if volume_id is null then
      insert into public.collections(
        owner_id,
        workspace_id,
        title,
        description,
        visibility,
        share_slug,
        allow_comments,
        allow_contributions,
        published_at,
        series_key,
        series_parent_id,
        volume_number,
        volume_start,
        volume_end
      )
      values (
        pierre.owner_id,
        pierre.workspace_id,
        format('ピエール問題集 第%s巻', volume.volume_number),
        format('問題%s〜%s。回答履歴・お気に入り・アーカイブは全巻で共通です。', volume.volume_start, volume.volume_end),
        pierre.visibility,
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
        pierre.allow_comments,
        pierre.allow_contributions,
        pierre.published_at,
        'pierre',
        pierre.id,
        volume.volume_number,
        volume.volume_start,
        volume.volume_end
      )
      returning id into volume_id;
    else
      update public.collections
         set series_key = 'pierre',
             series_parent_id = pierre.id,
             volume_start = volume.volume_start,
             volume_end = volume.volume_end,
             updated_at = now()
       where id = volume_id;
    end if;

    -- 既存の問題ID・回答履歴・お気に入り状態は変更せず、所属だけ移す。
    update public.questions q
       set collection_id = volume_id,
           sort_order = case
             when q.payload ->> 'number' ~ '^[0-9]+$'
               then (q.payload ->> 'number')::integer - volume.volume_start + 1
             else q.sort_order
           end,
           updated_at = now()
     where q.collection_id = pierre.id
       and q.payload ->> 'number' ~ '^[0-9]+$'
       and (q.payload ->> 'number')::integer between volume.volume_start and volume.volume_end;

    -- コメント・監査履歴は、紐づく問題と同じ巻へ移して参照を保つ。
    update public.comments cm
       set collection_id = q.collection_id,
           updated_at = now()
      from public.questions q
     where cm.collection_id = pierre.id
       and cm.question_id = q.id
       and q.collection_id = volume_id;

    update public.question_audit_events qa
       set collection_id = q.collection_id
      from public.questions q
     where qa.collection_id = pierre.id
       and qa.question_id = q.id
       and q.collection_id = volume_id;

    -- 第9巻は現在の末尾を表示しつつ、将来の問題追加で自動的に伸びる。
    if volume.volume_number = 9 then
      update public.collections c
         set volume_end = greatest(c.volume_end, coalesce((
           select max((q.payload ->> 'number')::integer)
             from public.questions q
            where q.collection_id = volume_id
              and q.payload ->> 'number' ~ '^[0-9]+$'
         ), c.volume_end)),
             updated_at = now()
       where c.id = volume_id;
    end if;

    volume_id := null;
  end loop;

  -- 親は入口として残し、通常の問題一覧には子巻を出さない。
  update public.collections
     set volume_number = null,
         volume_start = null,
         volume_end = null,
         series_parent_id = null,
         updated_at = now()
   where id = pierre.id;
end;
$migration$;

create trigger prepare_question_write
before insert or update on public.questions
for each row execute function private.prepare_question_write();

-- 親を保存先に指定した古いクライアントや将来の追加でも、番号に応じた巻へ入る。
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
  select c.*
    into source_collection
    from public.collections c
   where c.id = new.collection_id;
  if not found or source_collection.series_key is distinct from 'pierre' then
    return new;
  end if;

  if new.payload ->> 'number' !~ '^[0-9]+$' then
    return new;
  end if;
  question_number := (new.payload ->> 'number')::integer;
  if question_number < 1 then
    return new;
  end if;

  root_collection_id := coalesce(source_collection.series_parent_id, source_collection.id);
  target_volume := case
    when question_number between 1 and 200 then 1
    when question_number between 201 and 400 then 2
    when question_number between 401 and 600 then 3
    when question_number between 601 and 800 then 4
    when question_number between 801 and 1000 then 5
    when question_number between 1001 and 1200 then 6
    when question_number between 1201 and 1400 then 7
    when question_number between 1401 and 1600 then 8
    else 9
  end;

  select c.id
    into target_collection_id
    from public.collections c
   where c.series_parent_id = root_collection_id
     and c.volume_number = target_volume
     and c.archived_at is null
   limit 1;
  if target_collection_id is null then
    return new;
  end if;

  new.collection_id := target_collection_id;
  new.sort_order := question_number - case target_volume
    when 1 then 1
    when 2 then 201
    when 3 then 401
    when 4 then 601
    when 5 then 801
    when 6 then 1001
    when 7 then 1201
    when 8 then 1401
    else 1601
  end + 1;
  return new;
end;
$function$;

drop trigger if exists route_pierre_question_to_volume on public.questions;
create trigger route_pierre_question_to_volume
before insert on public.questions
for each row execute function private.route_pierre_question_to_volume();

create or replace function private.refresh_pierre_volume_bound()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.collection_id is not null
     and new.payload ->> 'number' ~ '^[0-9]+$'
     and (new.payload ->> 'number')::integer > 0 then
    update public.collections c
       set volume_end = greatest(c.volume_end, (new.payload ->> 'number')::integer),
           updated_at = now()
     where c.id = new.collection_id
       and c.series_key = 'pierre'
       and c.volume_number = 9;
  end if;
  return new;
end;
$function$;

drop trigger if exists refresh_pierre_volume_bound on public.questions;
create trigger refresh_pierre_volume_bound
after insert on public.questions
for each row execute function private.refresh_pierre_volume_bound();

-- 親のURLを保存先にした古い生成処理でも、全巻を横断して重複確認・採番する。
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
  root_collection_id uuid;
  target_is_series_parent boolean := false;
  existing_question_id uuid;
  new_question_id uuid;
  target_number integer;
  normalized_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(coalesce(p_title, '')) > 160 then raise exception 'question title is too long'; end if;
  if p_source_kind not in ('manual', 'discord', 'naga_scene', 'naga_match') then raise exception 'invalid source kind'; end if;
  if p_decision_type not in ('discard', 'call', 'riichi', 'combined') then raise exception 'invalid decision type'; end if;

  select c.*
    into target_collection
    from public.collections c
   where c.share_slug = p_share_slug
     and c.archived_at is null
   limit 1;
  if not found or not private.can_contribute_collection(target_collection.id) then
    raise exception 'an owner or editor member is required to add questions';
  end if;

  root_collection_id := coalesce(target_collection.series_parent_id, target_collection.id);
  target_is_series_parent := target_collection.series_key = 'pierre' and target_collection.series_parent_id is null;

  -- 先に既存行を返す。シリーズ親を指定した場合だけ、9巻を横断して確認する。
  select q.id
    into existing_question_id
    from public.questions q
    join public.collections c on c.id = q.collection_id
   where (q.collection_id = target_collection.id or (target_is_series_parent and c.series_parent_id = root_collection_id))
     and q.source_report_id is not distinct from p_source_report_id
     and q.scene_tw is not distinct from p_scene_tw
     and q.scene_ts is not distinct from p_scene_ts
     and q.scene_tv is not distinct from p_scene_tv
   order by q.created_at asc
   limit 1;
  if existing_question_id is not null then
    return jsonb_build_object('question_id', existing_question_id, 'already_exists', true);
  end if;

  select coalesce(max((q.payload ->> 'number')::integer), 0) + 1
    into target_number
    from public.questions q
    join public.collections c on c.id = q.collection_id
   where (q.collection_id = target_collection.id or (target_is_series_parent and c.series_parent_id = root_collection_id))
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
    target_collection.id, (select auth.uid()), format('問題%s', target_number), p_source_kind,
    p_source_report_id, p_source_url, p_scene_tw, p_scene_ts, p_scene_tv,
    p_decision_type, normalized_payload
  ) on conflict do nothing returning id into new_question_id;

  if new_question_id is not null then
    return jsonb_build_object('question_id', new_question_id, 'already_exists', false);
  end if;

  select q.id
    into existing_question_id
    from public.questions q
    join public.collections c on c.id = q.collection_id
   where (q.collection_id = target_collection.id or (target_is_series_parent and c.series_parent_id = root_collection_id))
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

-- 巻選択画面に必要な小さなメタデータだけを返す。
drop function if exists public.get_collection_volumes(text);
create function public.get_collection_volumes(p_share_slug text)
returns table (
  id uuid,
  share_slug text,
  title text,
  description text,
  owner_id uuid,
  volume_number integer,
  volume_start integer,
  volume_end integer,
  question_count bigint,
  can_view boolean,
  can_edit boolean,
  can_manage boolean,
  series_parent_slug text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with requested as (
    select coalesce(c.series_parent_id, c.id) as root_id
      from public.collections c
     where c.share_slug = p_share_slug
       and c.archived_at is null
       and private.can_access_collection(c.id)
     limit 1
  )
  select c.id,
         c.share_slug,
         c.title,
         c.description,
         c.owner_id,
         c.volume_number,
         c.volume_start,
         c.volume_end,
         count(q.id) filter (where q.deleted_at is null),
         private.can_access_collection(c.id),
         private.can_edit_collection_content(c.id),
         private.can_manage_collection(c.id),
         root.share_slug
    from requested r
    join public.collections root on root.id = r.root_id
    join public.collections c on c.series_parent_id = root.id
    left join public.questions q on q.collection_id = c.id
   where c.archived_at is null
     and private.can_access_collection(c.id)
   group by c.id, root.share_slug
   order by c.volume_number;
$function$;

-- 親または巻の問題数・回答済み数・習熟数だけを集計する。
create or replace function public.get_collection_volume_progress(p_share_slug text)
returns table (
  volume_number integer,
  volume_start integer,
  volume_end integer,
  question_count bigint,
  answered_count bigint,
  mastered_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with requested as (
    select coalesce(c.series_parent_id, c.id) as root_id
      from public.collections c
     where c.share_slug = p_share_slug
       and c.archived_at is null
       and private.can_access_collection(c.id)
     limit 1
  ),
  volumes as (
    select c.*
      from requested r
      join public.collections c on c.series_parent_id = r.root_id
     where c.archived_at is null
       and private.can_access_collection(c.id)
  ),
  latest_attempt as (
    select distinct on (a.question_id)
           a.question_id,
           a.grade
      from public.answer_attempts a
      join public.questions q on q.id = a.question_id
      join volumes v on v.id = q.collection_id
     where a.user_id = (select auth.uid())
       and q.deleted_at is null
     order by a.question_id, a.answered_at desc, a.id desc
  )
  select v.volume_number,
         v.volume_start,
         v.volume_end,
         count(q.id) filter (where q.deleted_at is null),
         count(distinct la.question_id),
         count(distinct la.question_id) filter (where la.grade in ('◎', '〇', '💮'))
    from volumes v
    left join public.questions q on q.collection_id = v.id
    left join latest_attempt la on la.question_id = q.id
   group by v.volume_number, v.volume_start, v.volume_end
   order by v.volume_number;
$function$;

-- 新しい戻り列を含む共有コレクション情報。旧share_slugは親のまま利用できる。
drop function if exists public.get_shared_collection(text);
create function public.get_shared_collection(p_share_slug text)
returns table (
  id uuid,
  owner_id uuid,
  title text,
  description text,
  visibility text,
  allow_comments boolean,
  allow_contributions boolean,
  published_at timestamptz,
  series_key text,
  series_parent_id uuid,
  series_parent_slug text,
  series_title text,
  volume_number integer,
  volume_start integer,
  volume_end integer,
  is_series_parent boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id,
         c.owner_id,
         c.title,
         c.description,
         c.visibility,
         c.allow_comments,
         c.allow_contributions,
         c.published_at,
         c.series_key,
         c.series_parent_id,
         case when c.series_parent_id is null and c.series_key is not null then c.share_slug else parent.share_slug end,
         case when c.series_parent_id is null and c.series_key is not null then c.title else parent.title end,
         c.volume_number,
         c.volume_start,
         c.volume_end,
         c.series_parent_id is null and c.series_key is not null
    from public.collections c
    left join public.collections parent on parent.id = c.series_parent_id
   where c.share_slug = p_share_slug
     and c.archived_at is null
     and private.can_access_collection(c.id);
$function$;

grant execute on function public.get_collection_volumes(text) to anon, authenticated;
grant execute on function public.get_collection_volume_progress(text) to anon, authenticated;
revoke all on function public.get_shared_collection(text) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_collection(text) to anon, authenticated;

-- 親URLを開いた旧環境でも、既存の問題詳細・回答履歴・コメントを参照できる。
create or replace function public.get_shared_question_detail(
  p_share_slug text,
  p_question_id uuid
)
returns setof public.questions
language sql
stable
security definer
set search_path = ''
as $function$
  with requested as (
    select coalesce(c.series_parent_id, c.id) as root_id
      from public.collections c
     where c.share_slug = p_share_slug
       and c.archived_at is null
       and private.can_access_collection(c.id)
     limit 1
  )
  select q.*
    from public.questions q
    join public.collections c on c.id = q.collection_id
    join requested r on c.id = r.root_id or c.series_parent_id = r.root_id
   where q.id = p_question_id
     and c.archived_at is null
     and private.can_access_collection(c.id)
     and q.deleted_at is null;
$function$;

-- 親のshare_slugを含む既存URLからも、巻へ移した問題に回答できるようにする。
create or replace function public.record_shared_attempt(
  p_share_slug text,
  p_question_id uuid,
  p_client_attempt_id uuid,
  p_answer jsonb,
  p_grade text,
  p_elapsed_ms integer default null,
  p_answered_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_attempt_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if p_grade not in ('💮', '◎', '〇', '△', '×') then raise exception 'invalid grade'; end if;
  if p_elapsed_ms is not null and p_elapsed_ms not between 0 and 86400000 then raise exception 'invalid elapsed time'; end if;
  if not exists (
    with requested as (
      select coalesce(c.series_parent_id, c.id) as root_id
        from public.collections c
       where c.share_slug = p_share_slug
         and c.archived_at is null
         and private.can_access_collection(c.id)
       limit 1
    )
    select 1
      from public.questions q
      join public.collections c on c.id = q.collection_id
      join requested r on c.id = r.root_id or c.series_parent_id = r.root_id
     where q.id = p_question_id
       and q.deleted_at is null
       and c.archived_at is null
       and private.can_access_collection(c.id)
  ) then
    raise exception 'shared question not found';
  end if;
  insert into public.answer_attempts(client_attempt_id, user_id, question_id, answer, grade, elapsed_ms, answered_at)
  values (p_client_attempt_id, (select auth.uid()), p_question_id, coalesce(p_answer, '{}'::jsonb), p_grade, p_elapsed_ms, p_answered_at)
  on conflict (user_id, client_attempt_id) do update
    set answer = excluded.answer,
        grade = excluded.grade,
        elapsed_ms = excluded.elapsed_ms,
        answered_at = excluded.answered_at
  returning id into new_attempt_id;
  return new_attempt_id;
end;
$function$;

create or replace function public.load_my_attempts_for_collection(
  p_share_slug text,
  p_limit integer default 5000,
  p_offset integer default 0
)
returns table (
  client_attempt_id uuid,
  question_id uuid,
  answer jsonb,
  grade text,
  elapsed_ms integer,
  answered_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  with requested as (
    select coalesce(c.series_parent_id, c.id) as root_id
      from public.collections c
     where c.share_slug = p_share_slug
       and c.archived_at is null
       and private.can_access_collection(c.id)
     limit 1
  )
  select a.client_attempt_id,
         a.question_id,
         a.answer,
         a.grade,
         a.elapsed_ms,
         a.answered_at
    from public.answer_attempts a
    join public.questions q on q.id = a.question_id
    join public.collections c on c.id = q.collection_id
    join requested r on c.id = r.root_id or c.series_parent_id = r.root_id
   where a.user_id = (select auth.uid())
     and q.deleted_at is null
     and c.archived_at is null
     and private.can_access_collection(c.id)
   order by a.answered_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 5000), 1), 5000)
   offset greatest(coalesce(p_offset, 0), 0);
$function$;

create or replace function public.get_shared_comments(p_share_slug text, p_question_id uuid default null)
returns table (
  id uuid,
  question_id uuid,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  body text,
  attachments jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  with requested as (
    select coalesce(c.series_parent_id, c.id) as root_id
      from public.collections c
     where c.share_slug = p_share_slug
       and c.archived_at is null
       and private.can_access_collection(c.id)
     limit 1
  )
  select cm.id,
         cm.question_id,
         cm.user_id,
         p.display_name,
         p.avatar_url,
         cm.body,
         cm.attachments,
         cm.created_at,
         cm.updated_at
    from public.comments cm
    join public.collections c on c.id = cm.collection_id
    join public.profiles p on p.id = cm.user_id
    join requested r on c.id = r.root_id or c.series_parent_id = r.root_id
   where c.archived_at is null
     and private.can_access_collection(c.id)
     and cm.deleted_at is null
     and (p_question_id is null or cm.question_id = p_question_id)
   order by cm.created_at;
$function$;

revoke all on function public.get_shared_question_detail(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_question_detail(text, uuid) to anon, authenticated;
revoke all on function public.load_my_attempts_for_collection(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.load_my_attempts_for_collection(text, integer, integer) to authenticated;
revoke all on function public.get_shared_comments(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_comments(text, uuid) to anon, authenticated;

-- 一覧・自分の問題集の通常カードには親だけを出す。
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
  request_status text,
  series_key text,
  is_series_parent boolean,
  volume_count integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id,
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
           limit 1),
         c.series_key,
         c.series_parent_id is null and c.series_key is not null,
         (select count(*)::integer from public.collections child where child.series_parent_id = c.id and child.archived_at is null)
    from public.collections c
    left join public.profiles owner_profile on owner_profile.id = c.owner_id
   where c.archived_at is null
     and c.published_at is not null
     and c.visibility in ('public', 'request', 'unlisted')
     and c.series_parent_id is null
   order by c.created_at desc;
$function$;

revoke all on function public.list_collection_directory() from public, anon, authenticated, service_role;
grant execute on function public.list_collection_directory() to anon, authenticated;

create or replace function public.list_my_collections()
returns table (
  id uuid,
  share_slug text,
  title text,
  description text,
  visibility text,
  owner_id uuid,
  member_role text,
  member_status text,
  can_view boolean,
  can_edit boolean,
  can_manage boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id,
         c.share_slug,
         c.title,
         c.description,
         c.visibility,
         c.owner_id,
         (select cm.role from public.collection_members cm where cm.collection_id = c.id and cm.user_id = (select auth.uid()) limit 1),
         (select cm.status from public.collection_members cm where cm.collection_id = c.id and cm.user_id = (select auth.uid()) limit 1),
         private.can_access_collection(c.id),
         private.can_edit_collection_content(c.id),
         private.can_manage_collection(c.id),
         c.created_at
    from public.collections c
   where c.archived_at is null
     and c.series_parent_id is null
     and private.can_access_collection(c.id)
   order by c.created_at desc;
$function$;

revoke all on function public.list_my_collections() from public, anon, authenticated, service_role;
grant execute on function public.list_my_collections() to authenticated;
