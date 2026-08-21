-- Keep answer-history hydration scoped to the logged-in user and collection.
-- This avoids importing other users' rows for an owner/admin and avoids the
-- global 500-row window dropping older answers from the current problem set.

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
as $$
  select
    a.client_attempt_id,
    a.question_id,
    a.answer,
    a.grade,
    a.elapsed_ms,
    a.answered_at
  from public.answer_attempts a
  join public.questions q on q.id = a.question_id
  join public.collections c on c.id = q.collection_id
  where a.user_id = (select auth.uid())
    and c.share_slug = p_share_slug
    and q.deleted_at is null
    and private.can_access_collection(c.id)
  order by a.answered_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 5000), 1), 5000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.load_my_attempts_for_collection(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.load_my_attempts_for_collection(text, integer, integer) to authenticated;

create index if not exists answer_attempts_user_question_answered_idx
  on public.answer_attempts(user_id, question_id, answered_at desc);
