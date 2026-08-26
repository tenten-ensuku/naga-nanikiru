-- 大規模な共有問題集は、一覧を100問単位で遅延読み込みする。
-- 問題本体の payload は返さず、初回表示を軽くする。
create index if not exists questions_collection_active_order_idx
  on public.questions(collection_id, sort_order, created_at, id)
  where deleted_at is null;

create or replace function public.get_shared_question_index_page(
  p_share_slug text,
  p_offset integer default 0,
  p_limit integer default 100
)
returns table (
  id uuid,
  created_by uuid,
  updated_by uuid,
  created_by_name text,
  updated_by_name text,
  title text,
  legacy_key text,
  sort_order integer,
  source_kind text,
  source_report_id text,
  source_url text,
  scene_tw smallint,
  scene_ts integer,
  scene_tv integer,
  decision_type text,
  question_number integer,
  has_riichi_judgment boolean,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with visible_questions as (
    select
      q.id,
      q.created_by,
      q.updated_by,
      q.created_by_name,
      q.updated_by_name,
      q.title,
      q.legacy_key,
      q.sort_order,
      q.source_kind,
      q.source_report_id,
      q.source_url,
      q.scene_tw,
      q.scene_ts,
      q.scene_tv,
      q.decision_type,
      case
        when q.payload ->> 'number' ~ '^[0-9]+$' then (q.payload ->> 'number')::integer
        else null
      end as question_number,
      coalesce((q.payload ->> 'hasRiichiJudgment')::boolean, false)
        or jsonb_path_exists(coalesce(q.payload, '{}'::jsonb), '$.reach[*] ? (@ > 0)') as has_riichi_judgment,
      q.created_at,
      q.updated_at
    from public.questions q
    join public.collections c on c.id = q.collection_id
    where c.share_slug = p_share_slug
      and private.can_access_collection(c.id)
      and c.archived_at is null
      and q.deleted_at is null
  )
  select
    v.id,
    v.created_by,
    v.updated_by,
    v.created_by_name,
    v.updated_by_name,
    v.title,
    v.legacy_key,
    v.sort_order,
    v.source_kind,
    v.source_report_id,
    v.source_url,
    v.scene_tw,
    v.scene_ts,
    v.scene_tv,
    v.decision_type,
    v.question_number,
    v.has_riichi_judgment,
    v.created_at,
    v.updated_at,
    count(*) over () as total_count
  from visible_questions v
  order by v.sort_order, v.created_at, v.id
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

revoke all on function public.get_shared_question_index_page(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_shared_question_index_page(text, integer, integer)
  to anon, authenticated;
