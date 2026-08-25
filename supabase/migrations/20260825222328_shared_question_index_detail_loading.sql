-- 大規模な共有問題集は、一覧用の軽量メタデータと問題本体を分離する。
-- 問題本体の payload jsonb（盤面・手牌・解説など）は、問題を開いた時だけ取得する。
create or replace function public.get_shared_question_index(
  p_share_slug text,
  p_offset integer default 0,
  p_limit integer default 500
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
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
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
    end,
    coalesce((q.payload ->> 'hasRiichiJudgment')::boolean, false)
      or jsonb_path_exists(coalesce(q.payload, '{}'::jsonb), '$.reach[*] ? (@ > 0)'),
    q.created_at,
    q.updated_at
  from public.questions q
  join public.collections c on c.id = q.collection_id
  where c.share_slug = p_share_slug
    and private.can_access_collection(c.id)
    and c.archived_at is null
    and q.deleted_at is null
  order by q.sort_order, q.created_at
  limit least(greatest(coalesce(p_limit, 500), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

revoke all on function public.get_shared_question_index(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_shared_question_index(text, integer, integer)
  to anon, authenticated;

-- 問題画面を開く時だけ、対象問題の payload を取得する。
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
  select q.*
  from public.questions q
  join public.collections c on c.id = q.collection_id
  where c.share_slug = p_share_slug
    and q.id = p_question_id
    and private.can_access_collection(c.id)
    and c.archived_at is null
    and q.deleted_at is null;
$function$;

revoke all on function public.get_shared_question_detail(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_shared_question_detail(text, uuid)
  to anon, authenticated;
