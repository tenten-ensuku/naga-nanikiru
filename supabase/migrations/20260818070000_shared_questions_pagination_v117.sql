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
as $$
  select q.*
  from public.questions q
  join public.collections c on c.id = q.collection_id
  where c.share_slug = p_share_slug
    and c.visibility in ('unlisted', 'public')
    and c.published_at is not null
    and c.archived_at is null
    and q.deleted_at is null
  order by q.sort_order, q.created_at
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_shared_questions_page(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_questions_page(text, integer, integer) to anon, authenticated;
