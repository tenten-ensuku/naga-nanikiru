-- V211: 共有カスタムリアクションと定番キーの拡張
-- カスタムリアクションは全ログイン利用者で共有し、表示名・アイコンは
-- 既存プロフィールから取得する。問題集・コメントへの反応は従来表を利用する。

create table if not exists public.custom_reactions (
  reaction_key text primary key
    check (reaction_key ~ '^custom_[0-9a-f]{32}$'),
  label text not null
    check (char_length(btrim(label)) between 1 and 24),
  icon text not null
    check (char_length(icon) between 1 and 8),
  creator_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists custom_reactions_created_at_idx
  on public.custom_reactions (created_at asc, reaction_key asc);

alter table public.custom_reactions enable row level security;

drop policy if exists custom_reactions_select on public.custom_reactions;
create policy custom_reactions_select on public.custom_reactions
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists custom_reactions_insert on public.custom_reactions;
create policy custom_reactions_insert on public.custom_reactions
  for insert to authenticated
  with check (creator_user_id = (select auth.uid()));

drop policy if exists custom_reactions_update on public.custom_reactions;
create policy custom_reactions_update on public.custom_reactions
  for update to authenticated
  using (creator_user_id = (select auth.uid()))
  with check (creator_user_id = (select auth.uid()));

drop policy if exists custom_reactions_delete on public.custom_reactions;
create policy custom_reactions_delete on public.custom_reactions
  for delete to authenticated
  using (creator_user_id = (select auth.uid()));

-- カタログへの直接書き込みは公開せず、下記RPCで入力値と作成者を検証する。
revoke all on table public.custom_reactions from anon, authenticated;
grant select on table public.custom_reactions to authenticated;

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
    'exclaim', 'question'
  ])
  or exists (
    select 1
      from public.custom_reactions cr
     where cr.reaction_key = p_reaction_key
  );
$function$;

revoke all on function private.is_valid_shared_reaction_key(text) from public, anon, authenticated, service_role;
grant execute on function private.is_valid_shared_reaction_key(text) to authenticated;

-- REST経由の直接INSERTでも、定番または存在するカスタムキー以外を拒否する。
create or replace function private.validate_shared_reaction_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_valid_shared_reaction_key(new.reaction_key) then
    raise exception 'invalid reaction';
  end if;
  return new;
end;
$function$;

revoke all on function private.validate_shared_reaction_key() from public, anon, authenticated, service_role;

alter table public.question_reactions
  drop constraint if exists question_reactions_reaction_key_check;
alter table public.comment_reactions
  drop constraint if exists comment_reactions_reaction_key_check;

drop trigger if exists validate_question_reaction_key on public.question_reactions;
create trigger validate_question_reaction_key
before insert or update of reaction_key on public.question_reactions
for each row execute function private.validate_shared_reaction_key();

drop trigger if exists validate_comment_reaction_key on public.comment_reactions;
create trigger validate_comment_reaction_key
before insert or update of reaction_key on public.comment_reactions
for each row execute function private.validate_shared_reaction_key();

drop function if exists public.list_custom_reactions();
create function public.list_custom_reactions()
returns table (
  reaction_key text,
  label text,
  icon text,
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
         cr.creator_user_id,
         coalesce(p.display_name, 'プレイヤー'),
         cr.created_at
    from public.custom_reactions cr
    left join public.profiles p on p.id = cr.creator_user_id
   where (select auth.uid()) is not null
   order by cr.created_at asc, cr.reaction_key asc;
$function$;

drop function if exists public.create_custom_reaction(text, text);
create function public.create_custom_reaction(
  p_label text,
  p_icon text
)
returns table (
  reaction_key text,
  label text,
  icon text,
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
  new_key text := 'custom_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if pg_catalog.char_length(normalized_label) not between 1 and 24 then
    raise exception 'custom reaction label must be 1 to 24 characters';
  end if;
  if pg_catalog.char_length(normalized_icon) not between 1 and 8 then
    raise exception 'custom reaction icon must be 1 to 8 characters';
  end if;

  insert into public.custom_reactions(reaction_key, label, icon, creator_user_id)
  values (new_key, normalized_label, normalized_icon, current_user_id);

  return query
  select cr.reaction_key,
         cr.label,
         cr.icon,
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
revoke all on function public.create_custom_reaction(text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_custom_reaction(text, text) to authenticated;

create or replace function public.set_shared_question_reaction(
  p_question_id uuid,
  p_reaction_key text,
  p_active boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not private.is_valid_shared_reaction_key(p_reaction_key) then raise exception 'invalid reaction'; end if;
  if not exists (
    select 1
      from public.questions q
      join public.collections c on c.id = q.collection_id
     where q.id = p_question_id
       and q.deleted_at is null
       and c.archived_at is null
       and private.can_access_collection(c.id)
  ) then raise exception 'shared question not found'; end if;

  if coalesce(p_active, false) then
    insert into public.question_reactions(question_id, user_id, reaction_key)
    values (p_question_id, (select auth.uid()), p_reaction_key)
    on conflict (question_id, user_id, reaction_key) do nothing;
  else
    delete from public.question_reactions
     where question_id = p_question_id
       and user_id = (select auth.uid())
       and reaction_key = p_reaction_key;
  end if;
end;
$function$;

create or replace function public.set_shared_comment_reaction(
  p_question_id uuid,
  p_comment_id text,
  p_reaction_key text,
  p_active boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not private.is_valid_shared_reaction_key(p_reaction_key) then raise exception 'invalid reaction'; end if;
  if not private.can_access_reaction_comment(p_question_id, p_comment_id) then
    raise exception 'shared comment not found';
  end if;

  if coalesce(p_active, false) then
    insert into public.comment_reactions(question_id, comment_id, user_id, reaction_key)
    values (p_question_id, p_comment_id, (select auth.uid()), p_reaction_key)
    on conflict (question_id, comment_id, user_id, reaction_key) do nothing;
  else
    delete from public.comment_reactions
     where question_id = p_question_id
       and comment_id = p_comment_id
       and user_id = (select auth.uid())
       and reaction_key = p_reaction_key;
  end if;
end;
$function$;

revoke all on function public.set_shared_question_reaction(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_shared_question_reaction(uuid, text, boolean) to authenticated;
revoke all on function public.set_shared_comment_reaction(uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_shared_comment_reaction(uuid, text, text, boolean) to authenticated;
