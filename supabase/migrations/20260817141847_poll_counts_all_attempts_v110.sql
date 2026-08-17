-- Count every submitted answer event for the community poll.
-- A repeat answer by the same user intentionally contributes another vote.
create or replace function public.get_question_poll_stats(p_share_slug text, p_question_id uuid)
returns table (sample_size bigint, correct_rate numeric, average_seconds numeric, choice_counts jsonb, grade_counts jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with all_attempts as (
    select a.answer, a.grade, a.elapsed_ms
    from public.answer_attempts a
    join public.questions q on q.id = a.question_id
    join public.collections c on c.id = q.collection_id
    where a.question_id = p_question_id
      and q.deleted_at is null
      and c.share_slug = p_share_slug
      and private.can_access_collection(c.id)
  ), totals as (
    select
      count(*)::bigint as n,
      count(*) filter (where grade in ('💮', '◎', '〇'))::bigint as correct_n,
      round(avg(elapsed_ms)::numeric / 1000, 1) as avg_seconds
    from all_attempts
  ), choices as (
    select
      case
        when nullif(answer ->> 'selected', '') is not null
          then concat(answer ->> 'selected', '|', case when lower(coalesce(answer ->> 'riichi', 'false')) = 'true' then 'reach' else 'no-reach' end)
        when lower(coalesce(answer ->> 'callDecision', '')) = 'true' then 'call:yes'
        when lower(coalesce(answer ->> 'callDecision', '')) = 'false' then 'call:no'
        else 'unknown'
      end as choice,
      count(*)::bigint as n
    from all_attempts
    group by 1
  ), grades as (
    select grade, count(*)::bigint as n
    from all_attempts
    group by grade
  )
  select
    t.n,
    round(100.0 * t.correct_n / nullif(t.n, 0), 1),
    t.avg_seconds,
    coalesce((select jsonb_object_agg(choice, n) from choices), '{}'::jsonb),
    coalesce((select jsonb_object_agg(grade, n) from grades), '{}'::jsonb)
  from totals t
  where t.n > 0
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.answer_attempts mine
      where mine.question_id = p_question_id
        and mine.user_id = (select auth.uid())
    );
$$;

revoke all on function public.get_question_poll_stats(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_question_poll_stats(text, uuid) to authenticated;
