-- V213: 画像付きカスタムリアクションと麻雀牌リアクション
-- カスタム画像はログインユーザーごとのStorage領域に保存し、
-- カタログには画像パスだけを保持する。牌リアクションは固定キーで検証する。

alter table public.custom_reactions
  add column if not exists image_path text,
  add column if not exists icon_type text not null default 'emoji';

alter table public.custom_reactions
  drop constraint if exists custom_reactions_icon_check,
  drop constraint if exists custom_reactions_icon_length_check,
  drop constraint if exists custom_reactions_content_check,
  drop constraint if exists custom_reactions_icon_type_check,
  drop constraint if exists custom_reactions_image_path_check;

alter table public.custom_reactions
  add constraint custom_reactions_icon_length_check
  check (char_length(btrim(icon)) between 0 and 8),
  add constraint custom_reactions_content_check
  check (char_length(btrim(icon)) > 0 or image_path is not null),
  add constraint custom_reactions_icon_type_check
  check (
    (image_path is null and icon_type = 'emoji')
    or (image_path is not null and icon_type = 'image')
  ),
  add constraint custom_reactions_image_path_check
  check (
    image_path is null
    or image_path ~ ('^' || creator_user_id::text || '/reactions/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reaction-assets',
  'reaction-assets',
  true,
  1048576,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists reaction_assets_insert on storage.objects;
create policy reaction_assets_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'reaction-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] = 'reactions'
);

drop policy if exists reaction_assets_update on storage.objects;
create policy reaction_assets_update on storage.objects for update to authenticated
using (bucket_id = 'reaction-assets' and owner_id = (select auth.uid())::text)
with check (
  bucket_id = 'reaction-assets'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] = 'reactions'
);

drop policy if exists reaction_assets_delete on storage.objects;
create policy reaction_assets_delete on storage.objects for delete to authenticated
using (bucket_id = 'reaction-assets' and owner_id = (select auth.uid())::text);

create or replace function private.is_valid_shared_reaction_key(p_reaction_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_reaction_key = any (array[
    'like', 'agree', 'difficult', 'good_question', 'important', 'hmm',
    'strategy', 'mistake', 'big_difference', 'small_difference', 'memo',
    'theory', 'basic_order', 'call', 'riichi', 'pass', 'silent', 'kan',
    'exclaim', 'question',
    'tile_man1', 'tile_man2', 'tile_man3', 'tile_man4', 'tile_man5', 'tile_man6', 'tile_man7', 'tile_man8', 'tile_man9',
    'tile_pin1', 'tile_pin2', 'tile_pin3', 'tile_pin4', 'tile_pin5', 'tile_pin6', 'tile_pin7', 'tile_pin8', 'tile_pin9',
    'tile_sou1', 'tile_sou2', 'tile_sou3', 'tile_sou4', 'tile_sou5', 'tile_sou6', 'tile_sou7', 'tile_sou8', 'tile_sou9',
    'tile_ji1', 'tile_ji2', 'tile_ji3', 'tile_ji4', 'tile_ji5', 'tile_ji6', 'tile_ji7',
    'tile_aka1', 'tile_aka2', 'tile_aka3'
  ])
  or exists (
    select 1
      from public.custom_reactions cr
     where cr.reaction_key = p_reaction_key
  );
$function$;

drop function if exists public.list_custom_reactions();
create function public.list_custom_reactions()
returns table (
  reaction_key text,
  label text,
  icon text,
  image_path text,
  icon_type text,
  creator_user_id uuid,
  creator_display_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select cr.reaction_key,
         cr.label,
         cr.icon,
         cr.image_path,
         cr.icon_type,
         cr.creator_user_id,
         coalesce(p.display_name, 'プレイヤー'),
         cr.created_at
    from public.custom_reactions cr
    left join public.profiles p on p.id = cr.creator_user_id
   where (select auth.uid()) is not null
   order by cr.created_at asc, cr.reaction_key asc;
$function$;

drop function if exists public.create_custom_reaction(text, text, text);
create function public.create_custom_reaction(
  p_label text,
  p_icon text,
  p_image_path text default null
)
returns table (
  reaction_key text,
  label text,
  icon text,
  image_path text,
  icon_type text,
  creator_user_id uuid,
  creator_display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_label text := pg_catalog.btrim(coalesce(p_label, ''));
  normalized_icon text := pg_catalog.btrim(coalesce(p_icon, ''));
  normalized_image_path text := nullif(pg_catalog.btrim(coalesce(p_image_path, '')), '');
  new_key text := 'custom_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if pg_catalog.char_length(normalized_label) not between 1 and 24 then
    raise exception 'custom reaction label must be 1 to 24 characters';
  end if;
  if pg_catalog.char_length(normalized_icon) > 8 then
    raise exception 'custom reaction icon must be 0 to 8 characters';
  end if;
  if normalized_icon = '' and normalized_image_path is null then
    raise exception 'custom reaction needs an icon or image';
  end if;
  if normalized_image_path is not null
    and normalized_image_path !~ ('^' || current_user_id::text || '/reactions/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$') then
    raise exception 'custom reaction image path is invalid';
  end if;
  if normalized_image_path is not null and not exists (
    select 1
      from storage.objects so
     where so.bucket_id = 'reaction-assets'
       and so.name = normalized_image_path
       and so.owner_id = current_user_id::text
  ) then
    raise exception 'custom reaction image was not uploaded by this user';
  end if;

  insert into public.custom_reactions(reaction_key, label, icon, image_path, icon_type, creator_user_id)
  values (
    new_key,
    normalized_label,
    normalized_icon,
    normalized_image_path,
    case when normalized_image_path is null then 'emoji' else 'image' end,
    current_user_id
  );

  return query
  select cr.reaction_key,
         cr.label,
         cr.icon,
         cr.image_path,
         cr.icon_type,
         cr.creator_user_id,
         coalesce(p.display_name, 'プレイヤー'),
         cr.created_at
    from public.custom_reactions cr
    left join public.profiles p on p.id = cr.creator_user_id
   where cr.reaction_key = new_key;
end;
$function$;

revoke all on function public.list_custom_reactions() from public, anon, authenticated, service_role;
grant execute on function public.list_custom_reactions() to authenticated;
revoke all on function public.create_custom_reaction(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_custom_reaction(text, text, text) to authenticated;
