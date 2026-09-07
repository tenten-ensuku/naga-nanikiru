-- Internal service-only inventory metadata. Paths are consumed in Worker memory and never included in snapshots or HTML.
-- Avoid thousands of per-key crypto operations under Workers Free's 10ms CPU allowance.
create or replace function public.ops_media_references() returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='15s' as $$
declare result jsonb;
begin
  if to_regclass('public.questions') is null then raise exception 'media_inventory_not_applicable'; end if;
  with recursive documents as (
    select payload as value from public.questions
    union all select attachments from public.comments
    union all select to_jsonb(body) from public.comments
    union all select to_jsonb(avatar_url) from public.profiles
    union all select to_jsonb('reaction-assets/'||image_path) from public.custom_reactions where image_path is not null
  ), nodes as (
    select value from documents
    union all
    select child.value from nodes parent cross join lateral (
      select value from jsonb_array_elements(case when jsonb_typeof(parent.value)='array' then parent.value else '[]'::jsonb end)
      union all select value from jsonb_each(case when jsonb_typeof(parent.value)='object' then parent.value else '{}'::jsonb end)
    ) child
  ), strings as (select distinct value#>>'{}' as raw from nodes where jsonb_typeof(value)='string'),
  refs as (
    select matches[1]||'/'||matches[2] as key from strings cross join lateral
      regexp_matches(raw,'(naga-question-assets|comment-assets|reaction-assets|question-assets)/([^[:space:]"<>?#]+)','g') matches
    union select 'comment-assets/'||raw from strings where raw ~ '^[a-f0-9-]{36}/comments/[^[:space:]"<>?#]+$'
    union select 'reaction-assets/'||raw from strings where raw ~ '^[a-f0-9-]{36}/reactions/[^[:space:]"<>?#]+$'
  )
  select jsonb_build_object('checkedAt',now(),'keys',coalesce(jsonb_agg(distinct key),'[]'),
    'ledgerBytes',(select coalesce(sum(size_bytes),0) from public.media_assets where state in ('ready','pending')),
    'ledgerCount',(select count(*) from public.media_assets where state='ready')) into result from refs;
  return result;
end $$;
revoke all on function public.ops_media_references() from public,anon,authenticated;
grant execute on function public.ops_media_references() to service_role;
