-- V100: collection spaces with owner-controlled visibility and access requests.
-- Existing legacy values are preserved: unlisted remains URL-only access and
-- workspace remains workspace-member access. New collections use private.

alter table public.collections drop constraint if exists collections_visibility_check;
alter table public.collections
  add constraint collections_visibility_check
  check (visibility in ('private', 'request', 'limited', 'public', 'unlisted', 'workspace'));

create table if not exists public.collection_members (
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (collection_id, user_id)
);

create table if not exists public.collection_access_requests (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requested_role text not null default 'viewer' check (requested_role in ('viewer', 'editor')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  message text not null default '' check (char_length(message) <= 1000),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_access_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  request_id uuid references public.collection_access_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('access_requested', 'access_approved', 'access_rejected', 'access_revoked')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists collection_members_user_idx
  on public.collection_members(user_id, collection_id)
  where status = 'active';
create index if not exists collection_access_requests_collection_idx
  on public.collection_access_requests(collection_id, status, created_at desc);
create index if not exists collection_access_requests_requester_idx
  on public.collection_access_requests(requester_id, created_at desc);
create unique index if not exists collection_access_requests_pending_idx
  on public.collection_access_requests(collection_id, requester_id)
  where status = 'pending';
create index if not exists collection_access_notifications_recipient_idx
  on public.collection_access_notifications(recipient_id, read_at, created_at desc);

alter table public.collection_members enable row level security;
alter table public.collection_access_requests enable row level security;
alter table public.collection_access_notifications enable row level security;

create or replace function private.can_access_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.collections c
    where c.id = target_collection_id
      and c.archived_at is null
      and (
        c.owner_id = (select auth.uid())
        or private.is_app_admin()
        or (c.published_at is not null and c.visibility in ('public', 'unlisted'))
        or (c.visibility = 'workspace' and private.is_workspace_member(c.workspace_id))
        or (c.visibility in ('limited', 'request') and exists (
          select 1 from public.collection_members cm
          where cm.collection_id = c.id
            and cm.user_id = (select auth.uid())
            and cm.status = 'active'
        ))
      )
  );
$$;

create or replace function private.can_edit_collection_content(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.collections c
    where c.id = target_collection_id
      and c.archived_at is null
      and (
        c.owner_id = (select auth.uid())
        or private.is_app_admin()
        or exists (
          select 1 from public.collection_members cm
          where cm.collection_id = c.id
            and cm.user_id = (select auth.uid())
            and cm.role = 'editor'
            and cm.status = 'active'
        )
      )
  );
$$;

create or replace function private.can_contribute_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.collections c
    where c.id = target_collection_id
      and c.archived_at is null
      and (
        private.can_edit_collection_content(c.id)
        or (
          c.allow_contributions
          and private.can_access_collection(c.id)
          and c.visibility in ('public', 'unlisted', 'workspace')
          and c.published_at is not null
        )
      )
  );
$$;

create or replace function private.can_edit_question(target_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.questions q
    where q.id = target_question_id
      and (
        q.created_by = (select auth.uid())
        or private.can_edit_collection_content(q.collection_id)
      )
  );
$$;

revoke all on function private.can_access_collection(uuid) from public, anon, authenticated;
revoke all on function private.can_edit_collection_content(uuid) from public, anon, authenticated;
revoke all on function private.can_contribute_collection(uuid) from public, anon, authenticated;
revoke all on function private.can_edit_question(uuid) from public, anon, authenticated;
grant execute on function private.can_access_collection(uuid) to anon, authenticated;
grant execute on function private.can_edit_collection_content(uuid) to authenticated;
grant execute on function private.can_contribute_collection(uuid) to authenticated;
grant execute on function private.can_edit_question(uuid) to authenticated;

drop policy if exists collection_members_select on public.collection_members;
create policy collection_members_select on public.collection_members for select to authenticated
using (user_id = (select auth.uid()) or private.can_manage_collection(collection_id));
drop policy if exists collection_members_insert on public.collection_members;
create policy collection_members_insert on public.collection_members for insert to authenticated
with check (private.can_manage_collection(collection_id));
drop policy if exists collection_members_update on public.collection_members;
create policy collection_members_update on public.collection_members for update to authenticated
using (private.can_manage_collection(collection_id))
with check (private.can_manage_collection(collection_id));
drop policy if exists collection_members_delete on public.collection_members;
create policy collection_members_delete on public.collection_members for delete to authenticated
using (private.can_manage_collection(collection_id));

drop policy if exists collection_access_requests_select on public.collection_access_requests;
create policy collection_access_requests_select on public.collection_access_requests for select to authenticated
using (requester_id = (select auth.uid()) or private.can_manage_collection(collection_id));
drop policy if exists collection_access_requests_insert on public.collection_access_requests;
create policy collection_access_requests_insert on public.collection_access_requests for insert to authenticated
with check (requester_id = (select auth.uid()));
drop policy if exists collection_access_requests_update on public.collection_access_requests;
create policy collection_access_requests_update on public.collection_access_requests for update to authenticated
using (private.can_manage_collection(collection_id))
with check (private.can_manage_collection(collection_id));

drop policy if exists collection_access_notifications_select on public.collection_access_notifications;
create policy collection_access_notifications_select on public.collection_access_notifications for select to authenticated
using (recipient_id = (select auth.uid()));
drop policy if exists collection_access_notifications_update on public.collection_access_notifications;
create policy collection_access_notifications_update on public.collection_access_notifications for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

grant select, insert, update, delete on public.collection_members to authenticated;
grant select, insert, update on public.collection_access_requests to authenticated;
grant select, update on public.collection_access_notifications to authenticated;

drop function if exists public.get_shared_collection(text);
create function public.get_shared_collection(p_share_slug text)
returns table (
  id uuid,
  owner_id uuid,
  owner_name text,
  title text,
  description text,
  visibility text,
  allow_comments boolean,
  allow_contributions boolean,
  published_at timestamptz,
  can_view boolean,
  can_edit boolean,
  can_manage boolean,
  is_owner boolean,
  member_role text,
  member_status text,
  request_id uuid,
  request_status text,
  request_message text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.owner_id,
    owner_profile.display_name,
    c.title,
    c.description,
    c.visibility,
    c.allow_comments,
    c.allow_contributions,
    c.published_at,
    private.can_access_collection(c.id),
    private.can_edit_collection_content(c.id),
    private.can_manage_collection(c.id),
    c.owner_id = (select auth.uid()),
    (select cm.role from public.collection_members cm where cm.collection_id = c.id and cm.user_id = (select auth.uid()) limit 1),
    (select cm.status from public.collection_members cm where cm.collection_id = c.id and cm.user_id = (select auth.uid()) limit 1),
    (select ar.id from public.collection_access_requests ar where ar.collection_id = c.id and ar.requester_id = (select auth.uid()) order by ar.created_at desc limit 1),
    (select ar.status from public.collection_access_requests ar where ar.collection_id = c.id and ar.requester_id = (select auth.uid()) order by ar.created_at desc limit 1),
    (select ar.message from public.collection_access_requests ar where ar.collection_id = c.id and ar.requester_id = (select auth.uid()) order by ar.created_at desc limit 1)
  from public.collections c
  left join public.profiles owner_profile on owner_profile.id = c.owner_id
  where c.share_slug = p_share_slug
    and c.archived_at is null;
$$;

drop function if exists public.get_shared_questions(text);
create function public.get_shared_questions(p_share_slug text)
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
    and private.can_access_collection(c.id)
    and q.deleted_at is null
  order by q.sort_order, q.created_at;
$$;

drop function if exists public.get_shared_comments(text, uuid);
create function public.get_shared_comments(p_share_slug text, p_question_id uuid default null)
returns table (
  id uuid,
  question_id uuid,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  body text,
  attachments jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select cm.id, cm.question_id, cm.user_id, p.display_name, p.avatar_url, cm.body, cm.attachments, cm.created_at, cm.updated_at
  from public.comments cm
  join public.collections c on c.id = cm.collection_id
  join public.profiles p on p.id = cm.user_id
  where c.share_slug = p_share_slug
    and private.can_access_collection(c.id)
    and cm.deleted_at is null
    and (p_question_id is null or cm.question_id = p_question_id)
  order by cm.created_at;
$$;

create or replace function public.post_shared_comment(
  p_share_slug text,
  p_question_id uuid,
  p_body text,
  p_attachments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_collection_id uuid;
  new_comment_id uuid;
  attachment_payload jsonb := coalesce(p_attachments, '[]'::jsonb);
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(attachment_payload) <> 'array' or jsonb_array_length(attachment_payload) > 4 then raise exception 'comment attachments are invalid'; end if;
  if char_length(coalesce(trim(p_body), '')) > 4000 or (char_length(coalesce(trim(p_body), '')) = 0 and jsonb_array_length(attachment_payload) = 0) then raise exception 'comment content is invalid'; end if;
  if exists (
    select 1 from jsonb_array_elements(attachment_payload) as attachment(value)
    where jsonb_typeof(attachment.value) <> 'object'
      or char_length(coalesce(attachment.value->>'path', '')) = 0
      or char_length(coalesce(attachment.value->>'alt', '')) > 200
      or (attachment.value->>'path') !~ ('^' || (select auth.uid())::text || '/comments/[A-Za-z0-9][A-Za-z0-9._-]*$')
      or not exists (select 1 from storage.objects object_row where object_row.bucket_id = 'comment-assets' and object_row.name = attachment.value->>'path' and object_row.owner_id = (select auth.uid())::text)
  ) then raise exception 'comment attachments are invalid'; end if;
  select c.id into target_collection_id
  from public.collections c
  where c.share_slug = p_share_slug and c.allow_comments and private.can_access_collection(c.id);
  if target_collection_id is null then raise exception 'shared collection not found'; end if;
  if p_question_id is not null and not exists (select 1 from public.questions q where q.id = p_question_id and q.collection_id = target_collection_id and q.deleted_at is null) then raise exception 'question does not belong to collection'; end if;
  insert into public.comments(collection_id, question_id, user_id, body, attachments)
  values (target_collection_id, p_question_id, (select auth.uid()), coalesce(trim(p_body), ''), attachment_payload)
  returning id into new_comment_id;
  return new_comment_id;
end;
$$;

create or replace function public.record_shared_attempt(
  p_share_slug text,
  p_question_id uuid,
  p_client_attempt_id uuid,
  p_answer jsonb,
  p_grade text,
  p_elapsed_ms integer default null,
  p_answered_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_attempt_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if p_grade not in ('💮', '◎', '〇', '△', '×') then raise exception 'invalid grade'; end if;
  if p_elapsed_ms is not null and p_elapsed_ms not between 0 and 86400000 then raise exception 'invalid elapsed time'; end if;
  if not exists (select 1 from public.questions q join public.collections c on c.id = q.collection_id where q.id = p_question_id and c.share_slug = p_share_slug and q.deleted_at is null and private.can_access_collection(c.id)) then raise exception 'shared question not found'; end if;
  insert into public.answer_attempts(client_attempt_id, user_id, question_id, answer, grade, elapsed_ms, answered_at)
  values (p_client_attempt_id, (select auth.uid()), p_question_id, coalesce(p_answer, '{}'::jsonb), p_grade, p_elapsed_ms, p_answered_at)
  on conflict (user_id, client_attempt_id) do update set answer = excluded.answer, grade = excluded.grade, elapsed_ms = excluded.elapsed_ms, answered_at = excluded.answered_at
  returning id into new_attempt_id;
  return new_attempt_id;
end;
$$;

create or replace function public.create_shared_question(
  p_share_slug text,
  p_title text,
  p_payload jsonb,
  p_source_kind text default 'manual',
  p_source_report_id text default null,
  p_source_url text default null,
  p_scene_tw smallint default null,
  p_scene_ts integer default null,
  p_scene_tv integer default null,
  p_decision_type text default 'discard'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_collection_id uuid; new_question_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(coalesce(p_title, '')) > 160 then raise exception 'question title is too long'; end if;
  if p_source_kind not in ('manual', 'discord', 'naga_scene', 'naga_match') then raise exception 'invalid source kind'; end if;
  if p_decision_type not in ('discard', 'call', 'riichi', 'combined') then raise exception 'invalid decision type'; end if;
  select c.id into target_collection_id from public.collections c where c.share_slug = p_share_slug and c.archived_at is null and c.allow_contributions;
  if target_collection_id is null or not private.can_contribute_collection(target_collection_id) then raise exception 'shared collection does not accept contributions'; end if;
  insert into public.questions(collection_id, created_by, title, source_kind, source_report_id, source_url, scene_tw, scene_ts, scene_tv, decision_type, payload)
  values (target_collection_id, (select auth.uid()), coalesce(p_title, ''), p_source_kind, p_source_report_id, p_source_url, p_scene_tw, p_scene_ts, p_scene_tv, p_decision_type, coalesce(p_payload, '{}'::jsonb))
  returning id into new_question_id;
  return new_question_id;
end;
$$;

create or replace function public.request_question_deletion(p_question_id uuid, p_reason text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare request_id uuid; target_collection_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(coalesce(p_reason, '')) > 1000 then raise exception 'deletion request reason is too long'; end if;
  select q.collection_id into target_collection_id from public.questions q where q.id = p_question_id and q.deleted_at is null and private.can_access_collection(q.collection_id);
  if target_collection_id is null then raise exception 'question not found'; end if;
  insert into public.question_deletion_requests(question_id, requester_id, reason)
  values (p_question_id, (select auth.uid()), coalesce(p_reason, ''))
  on conflict (question_id, requester_id, status) do update set reason = excluded.reason, created_at = now()
  returning id into request_id;
  insert into public.question_audit_events(question_id, collection_id, actor_id, event_type, snapshot)
  values (p_question_id, target_collection_id, (select auth.uid()), 'deletion_requested', jsonb_build_object('requestId', request_id, 'reason', coalesce(p_reason, '')));
  return request_id;
end;
$$;

create or replace function public.get_question_poll_stats(p_share_slug text, p_question_id uuid)
returns table (sample_size bigint, correct_rate numeric, average_seconds numeric, choice_counts jsonb, grade_counts jsonb)
language sql stable security definer set search_path = ''
as $$
  with first_attempts as (
    select distinct on (a.user_id) a.user_id, a.answer, a.grade, a.elapsed_ms
    from public.answer_attempts a join public.questions q on q.id = a.question_id join public.collections c on c.id = q.collection_id
    where a.question_id = p_question_id and q.deleted_at is null and c.share_slug = p_share_slug and private.can_access_collection(c.id)
    order by a.user_id, a.answered_at, a.id
  ), totals as (
    select count(*)::bigint as n, count(*) filter (where grade in ('💮', '◎', '〇'))::bigint as correct_n, round(avg(elapsed_ms)::numeric / 1000, 1) as avg_seconds from first_attempts
  ), choices as (
    select coalesce(nullif(answer ->> 'selected', ''), nullif(answer ->> 'callDecision', ''), nullif(answer ->> 'riichi', ''), '未選択') as choice, count(*)::bigint as n from first_attempts group by 1
  ), grades as (select grade, count(*)::bigint as n from first_attempts group by grade)
  select t.n, round(100.0 * t.correct_n / nullif(t.n, 0), 1), t.avg_seconds,
    coalesce((select jsonb_object_agg(choice, n) from choices), '{}'::jsonb), coalesce((select jsonb_object_agg(grade, n) from grades), '{}'::jsonb)
  from totals t
  where t.n >= 5 and (select auth.uid()) is not null and exists (select 1 from public.answer_attempts mine where mine.question_id = p_question_id and mine.user_id = (select auth.uid()));
$$;

create or replace function public.list_my_collections()
returns table (id uuid, share_slug text, title text, description text, visibility text, owner_id uuid, member_role text, member_status text, can_view boolean, can_edit boolean, can_manage boolean, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.share_slug, c.title, c.description, c.visibility, c.owner_id,
    (select cm.role from public.collection_members cm where cm.collection_id = c.id and cm.user_id = (select auth.uid()) limit 1),
    (select cm.status from public.collection_members cm where cm.collection_id = c.id and cm.user_id = (select auth.uid()) limit 1),
    private.can_access_collection(c.id), private.can_edit_collection_content(c.id), private.can_manage_collection(c.id), c.created_at
  from public.collections c
  where c.archived_at is null and private.can_access_collection(c.id)
  order by c.created_at desc;
$$;

create or replace function public.request_collection_access(p_share_slug text, p_message text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare target_collection_id uuid; target_owner_id uuid; new_request_id uuid; current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if char_length(coalesce(p_message, '')) > 1000 then raise exception 'request message is too long'; end if;
  select c.id, c.owner_id into target_collection_id, target_owner_id from public.collections c where c.share_slug = p_share_slug and c.archived_at is null;
  if target_collection_id is null then raise exception 'collection not found'; end if;
  if private.can_access_collection(target_collection_id) then raise exception 'collection access already granted'; end if;
  if not exists (select 1 from public.collections c where c.id = target_collection_id and c.visibility = 'request') then raise exception 'access requests are not enabled'; end if;
  insert into public.collection_access_requests(collection_id, requester_id, message)
  values (target_collection_id, current_user_id, coalesce(trim(p_message), ''))
  on conflict (collection_id, requester_id) where status = 'pending' do update set message = excluded.message, updated_at = now()
  returning id into new_request_id;
  insert into public.collection_access_notifications(recipient_id, collection_id, request_id, actor_id, kind, payload)
  values (target_owner_id, target_collection_id, new_request_id, current_user_id, 'access_requested', jsonb_build_object('message', coalesce(trim(p_message), '')));
  return new_request_id;
end;
$$;

create or replace function public.list_collection_access_requests(p_collection_id uuid)
returns table (id uuid, collection_id uuid, requester_id uuid, requester_name text, requested_role text, status text, message text, created_at timestamptz, reviewed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.collection_id, r.requester_id, p.display_name, r.requested_role, r.status, r.message, r.created_at, r.reviewed_at
  from public.collection_access_requests r join public.profiles p on p.id = r.requester_id
  where r.collection_id = p_collection_id and private.can_manage_collection(r.collection_id)
  order by case when r.status = 'pending' then 0 else 1 end, r.created_at desc;
$$;

create or replace function public.review_collection_access(p_request_id uuid, p_approve boolean, p_role text default 'viewer')
returns void
language plpgsql security definer set search_path = ''
as $$
declare request_row public.collection_access_requests%rowtype; current_user_id uuid := (select auth.uid());
begin
  if p_role not in ('viewer', 'editor') then raise exception 'invalid collection member role'; end if;
  select r.* into request_row from public.collection_access_requests r where r.id = p_request_id and r.status = 'pending';
  if request_row.id is null or not private.can_manage_collection(request_row.collection_id) then raise exception 'access request review is not allowed'; end if;
  if p_approve then
    insert into public.collection_members(collection_id, user_id, role, status, granted_by, granted_at, revoked_at)
    values (request_row.collection_id, request_row.requester_id, p_role, 'active', current_user_id, now(), null)
    on conflict (collection_id, user_id) do update set role = excluded.role, status = 'active', granted_by = excluded.granted_by, granted_at = now(), revoked_at = null;
  end if;
  update public.collection_access_requests set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = current_user_id, reviewed_at = now(), updated_at = now() where id = p_request_id;
  insert into public.collection_access_notifications(recipient_id, collection_id, request_id, actor_id, kind, payload)
  values (request_row.requester_id, request_row.collection_id, p_request_id, current_user_id, case when p_approve then 'access_approved' else 'access_rejected' end, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.revoke_collection_access(p_collection_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare current_user_id uuid := (select auth.uid());
begin
  if p_user_id = current_user_id or not private.can_manage_collection(p_collection_id) then raise exception 'access revoke is not allowed'; end if;
  update public.collection_members set status = 'revoked', revoked_at = now() where collection_id = p_collection_id and user_id = p_user_id and status = 'active';
  if not found then raise exception 'active collection member not found'; end if;
  insert into public.collection_access_notifications(recipient_id, collection_id, actor_id, kind)
  values (p_user_id, p_collection_id, current_user_id, 'access_revoked');
end;
$$;

create or replace function public.set_collection_visibility(p_collection_id uuid, p_visibility text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_visibility not in ('private', 'request', 'limited', 'public') then raise exception 'invalid collection visibility'; end if;
  if not private.can_manage_collection(p_collection_id) then raise exception 'collection visibility update is not allowed'; end if;
  update public.collections set visibility = p_visibility, published_at = case when p_visibility = 'private' then null else coalesce(published_at, now()) end, updated_at = now() where id = p_collection_id and archived_at is null;
end;
$$;

create or replace function public.list_collection_notifications(p_unread_only boolean default false)
returns table (id uuid, collection_id uuid, request_id uuid, kind text, payload jsonb, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.collection_id, n.request_id, n.kind, n.payload, n.created_at, n.read_at
  from public.collection_access_notifications n
  where n.recipient_id = (select auth.uid()) and (not p_unread_only or n.read_at is null)
  order by n.created_at desc;
$$;

create or replace function public.mark_collection_notifications_read(p_notification_ids uuid[] default null)
returns void
language sql security definer set search_path = ''
as $$
  update public.collection_access_notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = (select auth.uid())
    and (p_notification_ids is null or id = any(p_notification_ids));
$$;

revoke all on function public.get_shared_collection(text) from public, anon, authenticated, service_role;
revoke all on function public.get_shared_questions(text) from public, anon, authenticated, service_role;
revoke all on function public.get_shared_comments(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.post_shared_comment(text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.record_shared_attempt(text, uuid, uuid, jsonb, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.request_question_deletion(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.get_question_poll_stats(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_my_collections() from public, anon, authenticated, service_role;
revoke all on function public.request_collection_access(text, text) from public, anon, authenticated, service_role;
revoke all on function public.list_collection_access_requests(uuid) from public, anon, authenticated, service_role;
revoke all on function public.review_collection_access(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_collection_access(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_collection_visibility(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.list_collection_notifications(boolean) from public, anon, authenticated, service_role;
revoke all on function public.mark_collection_notifications_read(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_collection(text) to anon, authenticated;
grant execute on function public.get_shared_questions(text) to anon, authenticated;
grant execute on function public.get_shared_comments(text, uuid) to anon, authenticated;
grant execute on function public.post_shared_comment(text, uuid, text, jsonb) to authenticated;
grant execute on function public.record_shared_attempt(text, uuid, uuid, jsonb, text, integer, timestamptz) to authenticated;
grant execute on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text) to authenticated;
grant execute on function public.request_question_deletion(uuid, text) to authenticated;
grant execute on function public.get_question_poll_stats(text, uuid) to authenticated;
grant execute on function public.list_my_collections() to authenticated;
grant execute on function public.request_collection_access(text, text) to authenticated;
grant execute on function public.list_collection_access_requests(uuid) to authenticated;
grant execute on function public.review_collection_access(uuid, boolean, text) to authenticated;
grant execute on function public.revoke_collection_access(uuid, uuid) to authenticated;
grant execute on function public.set_collection_visibility(uuid, text) to authenticated;
grant execute on function public.list_collection_notifications(boolean) to authenticated;
grant execute on function public.mark_collection_notifications_read(uuid[]) to authenticated;

