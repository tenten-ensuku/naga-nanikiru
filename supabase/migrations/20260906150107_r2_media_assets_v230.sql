-- V230: metadata only. No Storage object or existing question is deleted here.
create table public.media_assets (
  object_key text primary key,
  bucket text not null check (bucket in ('naga-question-assets','comment-assets','reaction-assets','question-assets')),
  path text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  collection_id uuid references public.collections(id) on delete set null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp','image/gif')),
  state text not null default 'pending' check (state in ('pending','ready','deleting','deleted')),
  provider text not null default 'r2' check (provider = 'r2'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, path),
  check (object_key = bucket || '/' || path),
  check (path !~ '(^|/)\.\.?(/|$)' and path !~ '[\\%?#]' and length(path) between 1 and 1024)
);
create index media_assets_owner_idx on public.media_assets(owner_id, created_at);
create index media_assets_collection_idx on public.media_assets(collection_id);
alter table public.media_assets enable row level security;
revoke all on public.media_assets from public, anon, authenticated;
grant select on public.media_assets to authenticated;
grant all on public.media_assets to service_role;
create policy media_assets_read on public.media_assets for select to authenticated
using ((select auth.uid()) is not null and (
  owner_id = (select auth.uid()) or private.is_app_admin((select auth.uid()))
  or (state = 'ready' and bucket = 'reaction-assets')
  or (state = 'ready' and collection_id is not null and private.can_access_collection(collection_id))
));

create table private.media_budget (
  singleton boolean primary key default true check (singleton),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  warning_bytes bigint not null default 7000000000,
  limit_bytes bigint not null default 8000000000,
  external_bytes bigint not null default 0 check (external_bytes >= 0),
  inventory_checked_at timestamptz,
  inventory_error text
);
insert into private.media_budget(singleton) values (true);
revoke all on private.media_budget from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, update on private.media_budget to service_role;

create function private.account_media_bytes() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare old_bytes bigint := 0; new_bytes bigint := 0; budget private.media_budget;
begin
  if tg_op <> 'INSERT' and old.state <> 'deleted' then old_bytes := old.size_bytes; end if;
  if tg_op <> 'DELETE' and new.state <> 'deleted' then new_bytes := new.size_bytes; end if;
  select * into budget from private.media_budget where singleton for update;
  if new_bytes > old_bytes and budget.used_bytes + budget.external_bytes + new_bytes - old_bytes > budget.limit_bytes then
    raise exception 'media_storage_limit' using errcode = 'P0001';
  end if;
  update private.media_budget set used_bytes = used_bytes + new_bytes - old_bytes where singleton;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.account_media_bytes() from public, anon, authenticated;
grant execute on function private.account_media_bytes() to service_role;
create trigger media_assets_budget before insert or update or delete on public.media_assets
for each row execute function private.account_media_bytes();

-- Called with the end user's JWT, not the worker service credential.
create function public.authorize_media_upload(p_bucket text, p_collection_id uuid default null, p_share_slug text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare uid uuid := (select auth.uid()); cid uuid := p_collection_id; recent_count bigint;
begin
  if uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_bucket not in ('comment-assets','reaction-assets','question-assets') then
    raise exception 'invalid media bucket' using errcode = '42501';
  end if;
  if nullif(p_share_slug, '') is not null then
    select id into cid from public.collections where share_slug = p_share_slug
      and (p_collection_id is null or id = p_collection_id);
  end if;
  if p_bucket = 'comment-assets' and (cid is null or not private.can_access_collection(cid)) then
    raise exception 'collection access required' using errcode = '42501';
  end if;
  if p_bucket = 'question-assets' and (cid is null or not private.can_contribute_collection(cid)) then
    raise exception 'collection contribution required' using errcode = '42501';
  end if;
  select count(*) into recent_count from public.media_assets
    where owner_id = uid and created_at > now() - interval '1 hour';
  if recent_count >= 100 then raise exception 'media_upload_rate_limit'; end if;
  return jsonb_build_object('owner_id', uid, 'collection_id', cid);
end $$;
revoke all on function public.authorize_media_upload(text,uuid,text) from public, anon, authenticated;
grant execute on function public.authorize_media_upload(text,uuid,text) to authenticated;

create function public.resolve_private_media(p_keys text[])
returns table(object_key text) language sql stable security invoker set search_path = '' as $$
  select m.object_key from public.media_assets m
  where (select auth.uid()) is not null and cardinality(p_keys) between 1 and 32
    and m.object_key = any(p_keys) and m.state = 'ready' and m.bucket = 'question-assets'
    and (m.owner_id = (select auth.uid()) or private.can_access_collection(m.collection_id));
$$;
revoke all on function public.resolve_private_media(text[]) from public, anon, authenticated;
grant execute on function public.resolve_private_media(text[]) to authenticated;

-- An enabled bucket is not proof that each legacy object has been copied.
-- RLS and ready state gate every individual rewrite.
create function public.resolve_public_media(p_keys text[])
returns table(object_key text) language sql stable security invoker set search_path = '' as $$
  select m.object_key from public.media_assets m
  where (select auth.uid()) is not null and cardinality(p_keys) between 1 and 32
    and m.object_key = any(p_keys) and m.state = 'ready'
    and m.bucket in ('naga-question-assets','comment-assets','reaction-assets');
$$;
revoke all on function public.resolve_public_media(text[]) from public, anon, authenticated;
grant execute on function public.resolve_public_media(text[]) to authenticated;

-- Only the worker may reserve/complete actual objects; clients cannot fake completion.
create function public.reserve_media_asset(
  p_bucket text, p_path text, p_owner_id uuid, p_collection_id uuid,
  p_size_bytes bigint, p_sha256 text, p_content_type text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare key text := p_bucket || '/' || p_path; existing public.media_assets;
begin
  perform pg_advisory_xact_lock(hashtextextended(key, 230));
  select * into existing from public.media_assets where object_key = key for update;
  if found then
    if existing.sha256 <> p_sha256 or existing.size_bytes <> p_size_bytes
      or existing.owner_id is distinct from p_owner_id then raise exception 'media_key_conflict'; end if;
    if existing.state in ('deleting','deleted') then raise exception 'media_key_retired'; end if;
    return jsonb_build_object('object_key', key, 'ready', existing.state = 'ready');
  end if;
  insert into public.media_assets(object_key,bucket,path,owner_id,collection_id,size_bytes,sha256,content_type)
  values(key,p_bucket,p_path,p_owner_id,p_collection_id,p_size_bytes,p_sha256,p_content_type);
  return jsonb_build_object('object_key',key,'ready',false);
end $$;
revoke all on function public.reserve_media_asset(text,text,uuid,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.reserve_media_asset(text,text,uuid,uuid,bigint,text,text) to service_role;

create function public.complete_media_asset(p_key text, p_sha256 text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.media_assets set state = 'ready'
  where object_key = p_key and sha256 = p_sha256 and state in ('pending','ready');
  if not found then raise exception 'media completion mismatch'; end if;
end $$;
revoke all on function public.complete_media_asset(text,text) from public, anon, authenticated;
grant execute on function public.complete_media_asset(text,text) to service_role;

-- Claim deletion transactionally. A ready-row lock also serializes attachment validation.
create function public.begin_media_asset_delete(p_key text, p_owner_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare asset public.media_assets;
begin
  select * into asset from public.media_assets where object_key = p_key for update;
  if not found then return false; end if;
  if asset.owner_id is distinct from p_owner_id then
    raise exception 'asset ownership required' using errcode = '42501';
  end if;
  if exists(select 1 from public.comments c where c.deleted_at is null
      and c.attachments @> jsonb_build_array(jsonb_build_object('path',asset.path)))
    or exists(select 1 from public.custom_reactions r where r.image_path = asset.path)
    or exists(select 1 from public.questions q where position(p_key in q.payload::text) > 0)
  then raise exception 'media_asset_in_use'; end if;
  if asset.state = 'deleted' then return false; end if;
  update public.media_assets set state = 'deleting' where object_key = p_key;
  return true;
end $$;
create function public.finish_media_asset_delete(p_key text, p_success boolean)
returns void language sql security invoker set search_path = '' as $$
  update public.media_assets set state = case when p_success then 'deleted' else 'ready' end
    where object_key = p_key and state = 'deleting';
$$;
revoke all on function public.begin_media_asset_delete(text,uuid) from public, anon, authenticated;
revoke all on function public.finish_media_asset_delete(text,boolean) from public, anon, authenticated;
grant execute on function public.begin_media_asset_delete(text,uuid) to service_role;
grant execute on function public.finish_media_asset_delete(text,boolean) to service_role;

create function public.media_usage_snapshot(p_actual_r2_bytes bigint default null, p_inventory_error text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare budget private.media_budget;
begin
  select * into budget from private.media_budget where singleton for update;
  if p_actual_r2_bytes is not null and p_actual_r2_bytes >= 0 then
    update private.media_budget
      set external_bytes = greatest(0,p_actual_r2_bytes - used_bytes),
          inventory_checked_at = now(), inventory_error = null where singleton;
  elsif p_inventory_error is not null then
    update private.media_budget set inventory_error = left(p_inventory_error,200) where singleton;
  end if;
  select * into budget from private.media_budget where singleton;
  return jsonb_build_object('used_bytes',budget.used_bytes + budget.external_bytes,
    'warning_bytes',budget.warning_bytes,'limit_bytes',budget.limit_bytes,
    'checked_at',budget.inventory_checked_at,'error',budget.inventory_error);
end $$;
revoke all on function public.media_usage_snapshot(bigint,text) from public, anon, authenticated;
grant execute on function public.media_usage_snapshot(bigint,text) to service_role;

-- Preserve existing RPC signatures and every existing permission check.
-- Add the R2 ledger as a second source for the narrowly scoped attachment existence checks.
create function private.lock_owned_media_attachment(p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return false; end if;
  perform 1 from public.media_assets
    where object_key = p_key and owner_id = (select auth.uid())
      and bucket in ('comment-assets','reaction-assets') and state = 'ready'
    for share;
  return found;
end $$;
revoke all on function private.lock_owned_media_attachment(text) from public, anon, authenticated;
grant execute on function private.lock_owned_media_attachment(text) to authenticated;
do $$
declare fn record; original text; changed text; count_changed int := 0;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('post_shared_comment','update_shared_comment','create_custom_reaction')
  loop
    original := pg_get_functiondef(fn.oid);
    if position('from storage.objects' in lower(original)) = 0 then continue; end if;
    changed := regexp_replace(original, 'from storage\.objects',
      'from (select bucket_id, name, owner_id from storage.objects union all select bucket as bucket_id, path as name, owner_id::text from public.media_assets where state = ''ready'' and private.lock_owned_media_attachment(object_key))', 'gi');
    execute changed;
    count_changed := count_changed + 1;
  end loop;
  if count_changed <> 3 then
    raise exception 'Expected 3 attachment-validation RPCs, found %. Review current schema before migration.', count_changed;
  end if;
end $$;

-- Small delta pages, including tombstones. No full bodies or attachment lists.
create index comments_change_cursor_v230 on public.comments(collection_id,updated_at,id);
create function private.get_shared_comment_changes(
  p_share_slug text, p_after timestamptz default null,
  p_after_id uuid default '00000000-0000-0000-0000-000000000000', p_limit int default 100
) returns table (
  id uuid, question_id uuid, author_id uuid, author_name text,
  body text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select c.id,c.question_id,c.user_id,p.display_name,
    case when c.deleted_at is null then left(c.body,160) else '' end,
    c.created_at,c.updated_at,c.deleted_at
  from public.comments c join public.collections col on col.id=c.collection_id
  join public.profiles p on p.id=c.user_id
  where (select auth.uid()) is not null and col.share_slug=p_share_slug
    and private.can_access_collection(col.id)
    and (p_after is null or (c.updated_at,c.id) > (p_after,p_after_id))
  order by
    case when p_after is null then c.updated_at end desc,
    case when p_after is null then c.id end desc,
    c.updated_at,c.id limit greatest(1,least(100,p_limit));
$$;
revoke all on function private.get_shared_comment_changes(text,timestamptz,uuid,int) from public, anon, authenticated;
grant execute on function private.get_shared_comment_changes(text,timestamptz,uuid,int) to authenticated;
create function public.get_shared_comment_changes(
  p_share_slug text, p_after timestamptz default null,
  p_after_id uuid default '00000000-0000-0000-0000-000000000000', p_limit int default 100
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with page as materialized (
    select * from private.get_shared_comment_changes(p_share_slug,p_after,p_after_id,p_limit)
  ), last_row as (
    select updated_at,id from page order by updated_at desc,id desc limit 1
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(page) order by updated_at,id) from page),'[]'::jsonb),
    'cursor',jsonb_build_object(
      'updatedAt',coalesce((select updated_at from last_row),p_after,statement_timestamp()),
      'id',coalesce((select id from last_row),p_after_id,'00000000-0000-0000-0000-000000000000'::uuid)
    )
  );
$$;
revoke all on function public.get_shared_comment_changes(text,timestamptz,uuid,int) from public, anon, authenticated;
grant execute on function public.get_shared_comment_changes(text,timestamptz,uuid,int) to authenticated;
