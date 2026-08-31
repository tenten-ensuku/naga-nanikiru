-- V215: lightweight, read-only preview for ONE accessible collection.
-- Answers remain server-owned; existing browser-local archive keys are preview
-- input only. This function never persists them or changes learning records.
-- Reuses questions_collection_active_order_idx and
-- answer_attempts_user_question_answered_idx (already present in production).
create or replace function public.get_collection_library_summary(
  p_share_slug text,
  p_archived_keys text[] default '{}'::text[]
)
returns table (
  question_count bigint,
  answered_count bigint,
  mastered_count bigint,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_collection_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  if coalesce(cardinality(p_archived_keys), 0) > 20000 then
    raise exception using errcode = '22023', message = 'too many archive keys';
  end if;
  select c.id into v_collection_id
    from public.collections c
   where c.share_slug = nullif(btrim(p_share_slug), '')
     and c.archived_at is null
     and private.can_access_collection(c.id)
     and (c.series_parent_id is null or exists (
       select 1 from public.collections parent_collection
        where parent_collection.id = c.series_parent_id
          and parent_collection.archived_at is null
     ))
   limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'collection not found or access denied';
  end if;

  return query
  select count(q.id),
         count(q.id) filter (where latest.answered_at is not null
           or q.id::text = any(coalesce(p_archived_keys, '{}'::text[]))),
         count(q.id) filter (where latest.grade in ('〇', '◎', '💮')
           or q.id::text = any(coalesce(p_archived_keys, '{}'::text[]))),
         greatest(max(q.updated_at), max(latest.answered_at))
    from public.questions q
    left join lateral (
      select a.grade, a.answered_at
        from public.answer_attempts a
       where a.question_id = q.id and a.user_id = v_user_id
       order by a.answered_at desc, a.id desc
       limit 1
    ) latest on true
   where q.collection_id = v_collection_id
     and q.deleted_at is null;
end;
$function$;

revoke all on function public.get_collection_library_summary(text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_collection_library_summary(text, text[])
  to authenticated;
