-- 非公開・申請制・限定共有でも、アクセス権のある所有者/メンバーは
-- ページングされた問題一覧を取得できるようにする。
-- 未許可ユーザーには private.can_access_collection が false を返すため、
-- 公開範囲の保護は維持される。
create or replace function public.get_shared_questions_page(
  p_share_slug text,
  p_offset integer default 0,
  p_limit integer default 1000
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
    and private.can_access_collection(c.id)
    and c.archived_at is null
    and q.deleted_at is null
  order by q.sort_order, q.created_at
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

revoke all on function public.get_shared_questions_page(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_shared_questions_page(text, integer, integer)
  to anon, authenticated;
