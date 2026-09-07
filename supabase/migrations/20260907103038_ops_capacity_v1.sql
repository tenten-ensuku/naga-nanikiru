-- Aggregate-only monitoring. No question bodies, comments, users or keys are returned.
create schema if not exists private;
create table private.ops_capacity_control (
  singleton boolean primary key default true check (singleton),
  armed boolean not null default false,
  blocked boolean not null default false,
  reason text not null default '',
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.ops_capacity_control enable row level security;
revoke all on private.ops_capacity_control from public, anon, authenticated;
grant usage on schema private to service_role;
grant select,update on private.ops_capacity_control to service_role;
insert into private.ops_capacity_control(singleton) values(true);

create function public.ops_capacity_snapshot() returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='8s' as $$
declare r record; a text; n bigint; tables jsonb:='[]'; objects jsonb; budget jsonb:=null;
begin
  for r in select c.oid,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace s on s.oid=c.relnamespace
    where s.nspname='public' and c.relkind in ('r','m') order by c.relname loop
    a := case
      when r.relname = any(array['answer_attempts','class_members','classes','collection_access_notifications','collection_access_requests','collection_members','collections','comment_reactions','comments','custom_reactions','generation_candidates','generation_jobs','media_assets','profiles','question_audit_events','question_deletion_requests','question_reactions','questions','user_question_state','workspace_members','workspaces']) then 'minkiru'
      when r.relname='ensuku_rankings' then 'ensuku'
      when r.relname=any(array['iishanten_ranking_submissions','iishanten_effort_events','iishanten_daily_effort']) then 'iishanten'
      when r.relname='isolated_rankings' then 'isolated'
      when r.relname=any(array['zundamon_question_overrides','zundamon_question_reviews']) then 'zundamon'
      else 'common' end;
    execute format('select count(*) from public.%I',r.relname) into n;
    tables:=tables||jsonb_build_array(jsonb_build_object('name',r.relname,'appId',a,'bytes',pg_catalog.pg_total_relation_size(r.oid),'count',n));
  end loop;
  select coalesce(jsonb_agg(x),'[]') into objects from (
    select bucket_id as bucket,count(*) as count,
      sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end) as bytes,
      count(*) filter(where metadata->>'size' is null or metadata->>'size' !~ '^[0-9]+$') as unknown
    from storage.objects group by bucket_id order by bucket_id
  ) x;
  if to_regclass('private.media_budget') is not null then
    execute 'select jsonb_build_object(''reservedAndReadyBytes'',used_bytes,''externalBytes'',external_bytes,''inventoryCheckedAt'',inventory_checked_at,''inventoryError'',inventory_error) from private.media_budget where singleton' into budget;
  end if;
  return jsonb_build_object('checkedAt',now(),'databaseBytes',pg_catalog.pg_database_size(current_database()),'tables',tables,'storage',objects,'mediaBudget',budget);
end $$;

-- Daily metadata reconciliation: hashed paths only, never image bytes or teaching text.
create function public.ops_media_references() returns jsonb
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
  select jsonb_build_object('checkedAt',now(),'hashes',coalesce(jsonb_agg(distinct encode(sha256(convert_to(key,'UTF8')),'hex')),'[]'),
    'ledgerBytes',(select coalesce(sum(size_bytes),0) from public.media_assets where state in ('ready','pending')),
    'ledgerCount',(select count(*) from public.media_assets where state='ready')) into result from refs;
  return result;
end $$;
revoke all on function public.ops_media_references() from public,anon,authenticated;
grant execute on function public.ops_media_references() to service_role;
revoke all on function public.ops_capacity_snapshot() from public,anon,authenticated;
grant execute on function public.ops_capacity_snapshot() to service_role;

create function public.ops_capacity_status() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('blocked',armed and (blocked or checked_at is null or checked_at<now()-interval '24 hours'),
    'reason',case when checked_at<now()-interval '24 hours' then 'monitor_stale' else reason end,'checkedAt',checked_at)
  from private.ops_capacity_control where singleton;
$$;
revoke all on function public.ops_capacity_status() from public,anon,authenticated;
grant execute on function public.ops_capacity_status() to service_role;

create function public.ops_set_capacity_control(p_armed boolean,p_blocked boolean,p_reason text,p_checked_at timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_checked_at is null or abs(extract(epoch from p_checked_at-now()))>300 or length(p_reason)>500 then
    raise exception 'invalid_control_update';
  end if;
  update private.ops_capacity_control set armed=p_armed,blocked=p_blocked,reason=p_reason,checked_at=p_checked_at,updated_at=now() where singleton;
end $$;
revoke all on function public.ops_set_capacity_control(boolean,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.ops_set_capacity_control(boolean,boolean,text,timestamptz) to service_role;

-- Trigger-only definer: reads one private global policy row, never bypasses existing row ownership policies.
create function private.ops_guard_heavy_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare c private.ops_capacity_control; heavy boolean:=true;
begin
  select * into c from private.ops_capacity_control where singleton;
  if not c.armed or (not c.blocked and c.checked_at>=now()-interval '24 hours') then return new; end if;
  if tg_table_name='questions' and tg_op='UPDATE' then heavy:=new.payload is distinct from old.payload;
  elsif tg_table_name='comments' then
    heavy:=coalesce(new.attachments,'[]'::jsonb)<>'[]'::jsonb;
    if tg_op='UPDATE' then heavy:=heavy and new.attachments is distinct from old.attachments; end if;
  elsif tg_table_name='custom_reactions' then
    heavy:=coalesce(new.image_path,'')<>'';
    if tg_op='UPDATE' then heavy:=heavy and new.image_path is distinct from old.image_path; end if;
  elsif tg_table_name='media_assets' and tg_op='UPDATE' then
    heavy:=new.size_bytes>old.size_bytes or (new.state='pending' and old.state not in ('pending','ready'));
  elsif tg_table_name='generation_jobs' and tg_op='UPDATE' then heavy:=false;
  end if;
  if heavy then raise exception 'ops_capacity_limited: 新しい画像・問題の追加は容量確認のため一時停止中です。入力は保持し、管理者による再開をお待ちください。' using errcode='P0001'; end if;
  return new;
end $$;
revoke all on function private.ops_guard_heavy_write() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['questions','generation_jobs','media_assets','comments','custom_reactions','zundamon_question_overrides'] loop
    if to_regclass('public.'||t) is not null then
      execute format('create trigger ops_capacity_guard before insert or update on public.%I for each row execute function private.ops_guard_heavy_write()',t);
    end if;
  end loop;
end $$;
