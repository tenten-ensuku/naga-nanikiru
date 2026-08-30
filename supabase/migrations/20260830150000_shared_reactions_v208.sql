-- V208: 問題・コメント単位の共有リアクション
-- リアクションの表示名・アイコンは profiles を参照し、リアクション表には保存しない。

create table if not exists public.question_reactions (
  question_id uuid not null references public.questions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_key text not null check (reaction_key in (
    'like', 'agree', 'difficult', 'good_question', 'important', 'hmm',
    'strategy', 'mistake', 'big_difference', 'small_difference', 'memo',
    'theory', 'basic_order', 'call', 'riichi', 'pass', 'silent', 'kan',
    'exclaim', 'question'
  )),
  created_at timestamptz not null default now(),
  primary key (question_id, user_id, reaction_key)
);

create table if not exists public.comment_reactions (
  question_id uuid not null references public.questions(id) on delete cascade,
  comment_id text not null check (char_length(comment_id) between 1 and 200),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_key text not null check (reaction_key in (
    'like', 'agree', 'difficult', 'good_question', 'important', 'hmm',
    'strategy', 'mistake', 'big_difference', 'small_difference', 'memo',
    'theory', 'basic_order', 'call', 'riichi', 'pass', 'silent', 'kan',
    'exclaim', 'question'
  )),
  created_at timestamptz not null default now(),
  primary key (question_id, comment_id, user_id, reaction_key)
);

create index if not exists question_reactions_question_key_idx
  on public.question_reactions (question_id, reaction_key);
create index if not exists question_reactions_user_question_idx
  on public.question_reactions (user_id, question_id);
create index if not exists comment_reactions_comment_key_idx
  on public.comment_reactions (question_id, comment_id, reaction_key);
create index if not exists comment_reactions_user_comment_idx
  on public.comment_reactions (user_id, question_id, comment_id);

alter table public.question_reactions enable row level security;
alter table public.comment_reactions enable row level security;

drop policy if exists question_reactions_select on public.question_reactions;
create policy question_reactions_select on public.question_reactions
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1
        from public.questions q
        join public.collections c on c.id = q.collection_id
       where q.id = question_reactions.question_id
         and q.deleted_at is null
         and c.archived_at is null
         and private.can_access_collection(c.id)
    )
  );

drop policy if exists question_reactions_insert on public.question_reactions;
create policy question_reactions_insert on public.question_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.questions q
        join public.collections c on c.id = q.collection_id
       where q.id = question_reactions.question_id
         and q.deleted_at is null
         and c.archived_at is null
         and private.can_access_collection(c.id)
    )
  );

drop policy if exists question_reactions_delete on public.question_reactions;
create policy question_reactions_delete on public.question_reactions
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.questions q
        join public.collections c on c.id = q.collection_id
       where q.id = question_reactions.question_id
         and q.deleted_at is null
         and c.archived_at is null
         and private.can_access_collection(c.id)
    )
  );

-- comments の既存 SELECT RLS は本人・管理者に限定されるため、
-- リアクション操作の対象確認だけを安全な private 関数で行う。
-- コメント欄にはDiscord由来のpayloadコメントと、アプリ内コメントの両方があるため、
-- comment_idは文字列で保持し、問題IDも一緒に保存する。
drop function if exists private.can_access_reaction_comment(uuid, text);
create function private.can_access_reaction_comment(target_question_id uuid, target_comment_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.questions q
      join public.collections c on c.id = q.collection_id
     where q.id = target_question_id
       and q.deleted_at is null
       and c.archived_at is null
       and private.can_access_collection(c.id)
       and (
         exists (
           select 1
             from public.comments cm
            where cm.id::text = target_comment_id
              and cm.question_id = q.id
              and cm.deleted_at is null
         )
         or exists (
           select 1
             from jsonb_array_elements(
               case when jsonb_typeof(q.payload -> 'comments') = 'array'
                    then q.payload -> 'comments'
                    else '[]'::jsonb end
             ) as comment_row
            where coalesce(comment_row ->> 'id', comment_row ->> 'messageId') = target_comment_id
         )
       )
  );
$function$;

revoke all on function private.can_access_reaction_comment(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.can_access_reaction_comment(uuid, text) to authenticated;

drop function if exists private.purge_comment_reactions();
create function private.purge_comment_reactions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
    delete from public.comment_reactions
     where question_id = old.question_id
       and comment_id = old.id::text;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.purge_comment_reactions() from public, anon, authenticated, service_role;
drop trigger if exists purge_comment_reactions_on_comment_delete on public.comments;
create trigger purge_comment_reactions_on_comment_delete
after delete or update of deleted_at on public.comments
for each row execute function private.purge_comment_reactions();

drop policy if exists comment_reactions_select on public.comment_reactions;
create policy comment_reactions_select on public.comment_reactions
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and private.can_access_reaction_comment(comment_reactions.question_id, comment_reactions.comment_id)
  );

drop policy if exists comment_reactions_insert on public.comment_reactions;
create policy comment_reactions_insert on public.comment_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.can_access_reaction_comment(comment_reactions.question_id, comment_reactions.comment_id)
  );

drop policy if exists comment_reactions_delete on public.comment_reactions;
create policy comment_reactions_delete on public.comment_reactions
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and private.can_access_reaction_comment(comment_reactions.question_id, comment_reactions.comment_id)
  );

revoke all on table public.question_reactions, public.comment_reactions from anon, authenticated;
grant select, insert, delete on table public.question_reactions, public.comment_reactions to authenticated;

drop function if exists public.get_shared_reaction_summary(text, uuid);
create function public.get_shared_reaction_summary(
  p_share_slug text,
  p_question_id uuid
)
returns table (
  scope text,
  target_id text,
  reaction_key text,
  reaction_count integer,
  reactors jsonb,
  reacted_by_me boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with requested as (
    select q.id as question_id
      from public.questions q
      join public.collections c on c.id = q.collection_id
     where p_question_id is not null
       and q.id = p_question_id
       and q.deleted_at is null
       and c.share_slug = p_share_slug
       and c.archived_at is null
       and private.can_access_collection(c.id)
     limit 1
  ),
  all_reactions as (
    select 'question'::text as scope,
           qr.question_id::text as target_id,
           qr.reaction_key,
           qr.user_id,
           qr.created_at
      from public.question_reactions qr
      join requested r on r.question_id = qr.question_id
    union all
    select 'comment'::text as scope,
           cr.comment_id as target_id,
           cr.reaction_key,
           cr.user_id,
           cr.created_at
      from public.comment_reactions cr
      join requested r on r.question_id = cr.question_id
     where private.can_access_reaction_comment(cr.question_id, cr.comment_id)
  )
  select ar.scope,
         ar.target_id,
         ar.reaction_key,
         count(*)::integer,
         jsonb_agg(
           jsonb_build_object(
             'userId', ar.user_id,
             'displayName', coalesce(p.display_name, 'プレイヤー'),
             'avatarUrl', p.avatar_url
           ) order by ar.created_at, ar.user_id
         ),
         coalesce(bool_or(ar.user_id = (select auth.uid())), false)
    from all_reactions ar
    join public.profiles p on p.id = ar.user_id
   group by ar.scope, ar.target_id, ar.reaction_key;
$function$;

drop function if exists public.set_shared_question_reaction(uuid, text, boolean);
create function public.set_shared_question_reaction(
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
  if p_reaction_key not in (
    'like', 'agree', 'difficult', 'good_question', 'important', 'hmm',
    'strategy', 'mistake', 'big_difference', 'small_difference', 'memo',
    'theory', 'basic_order', 'call', 'riichi', 'pass', 'silent', 'kan',
    'exclaim', 'question'
  ) then raise exception 'invalid reaction'; end if;
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

drop function if exists public.set_shared_comment_reaction(uuid, text, text, boolean);
create function public.set_shared_comment_reaction(
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
  if p_reaction_key not in (
    'like', 'agree', 'difficult', 'good_question', 'important', 'hmm',
    'strategy', 'mistake', 'big_difference', 'small_difference', 'memo',
    'theory', 'basic_order', 'call', 'riichi', 'pass', 'silent', 'kan',
    'exclaim', 'question'
  ) then raise exception 'invalid reaction'; end if;
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

revoke all on function public.get_shared_reaction_summary(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_reaction_summary(text, uuid) to authenticated;
revoke all on function public.set_shared_question_reaction(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_shared_question_reaction(uuid, text, boolean) to authenticated;
revoke all on function public.set_shared_comment_reaction(uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_shared_comment_reaction(uuid, text, text, boolean) to authenticated;
