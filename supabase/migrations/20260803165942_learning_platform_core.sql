create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'プレイヤー' check (char_length(display_name) between 1 and 80),
  discord_user_id text unique,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'teacher', 'student')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  workspace_id uuid references public.workspaces(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'workspace', 'public')),
  share_slug text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  allow_comments boolean not null default true,
  allow_contributions boolean not null default true,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default 'プレイヤー' check (char_length(created_by_name) between 1 and 80),
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80),
  title text not null default '' check (char_length(title) <= 160),
  legacy_key text,
  sort_order integer not null default 0,
  source_kind text not null default 'manual' check (source_kind in ('manual', 'discord', 'naga_scene', 'naga_match')),
  source_report_id text,
  source_url text,
  scene_tw smallint check (scene_tw between 0 and 3),
  scene_ts integer check (scene_ts >= 0),
  scene_tv integer check (scene_tv >= 0),
  decision_type text not null default 'discard' check (decision_type in ('discard', 'call', 'riichi', 'combined')),
  payload jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (collection_id, source_report_id, scene_tw, scene_ts, scene_tv),
  unique (collection_id, legacy_key)
);

create table public.answer_attempts (
  id uuid primary key default gen_random_uuid(),
  client_attempt_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer jsonb not null default '{}'::jsonb,
  grade text not null check (grade in ('💮', '◎', '〇', '△', '×')),
  elapsed_ms integer check (elapsed_ms is null or elapsed_ms between 0 and 86400000),
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, client_attempt_id)
);

create table public.user_question_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  favorite boolean not null default false,
  state text not null default 'active' check (state in ('active', 'snoozed', 'trash', 'hidden_forever')),
  snoozed_until timestamptz,
  next_review_at timestamptz,
  last_grade text check (last_grade is null or last_grade in ('💮', '◎', '〇', '△', '×')),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.question_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (question_id, requester_id, status)
);

create table public.question_audit_events (
  id bigint generated always as identity primary key,
  question_id uuid,
  collection_id uuid not null references public.collections(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('created', 'updated', 'trashed', 'restored', 'deletion_requested', 'deletion_request_resolved', 'permanently_deleted')),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid references public.collections(id) on delete set null,
  source_kind text not null check (source_kind in ('naga_scene', 'naga_match')),
  source_url text not null,
  source_report_id text not null,
  target_player_seat smallint check (target_player_seat between 0 and 3),
  target_player_name text,
  extraction_preset text not null default 'bad_moves' check (extraction_preset in ('bad_moves', 'custom')),
  extraction_config jsonb not null default '{"thresholdPercent":5,"decisionTypes":["discard","call","riichi"],"modelRule":"any","maxCandidates":100}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table public.generation_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  scene_tw smallint not null check (scene_tw between 0 and 3),
  scene_ts integer not null check (scene_ts >= 0),
  scene_tv integer not null check (scene_tv >= 0),
  decision_type text not null check (decision_type in ('discard', 'call', 'riichi', 'combined')),
  actual_choice jsonb not null default '{}'::jsonb,
  model_scores jsonb not null default '{}'::jsonb,
  candidate_payload jsonb not null default '{}'::jsonb,
  selected boolean not null default false,
  created_question_id uuid references public.questions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, scene_ts, scene_tv, decision_type)
);

create index answer_attempts_user_answered_idx on public.answer_attempts(user_id, answered_at desc);
create index answer_attempts_question_idx on public.answer_attempts(question_id, answered_at desc);
create index question_state_review_idx on public.user_question_state(user_id, next_review_at) where state = 'active';
create index questions_collection_order_idx on public.questions(collection_id, sort_order, created_at);
create index comments_collection_created_idx on public.comments(collection_id, created_at) where deleted_at is null;
create index questions_deleted_idx on public.questions(collection_id, deleted_at) where deleted_at is not null;
create index deletion_requests_pending_idx on public.question_deletion_requests(question_id, created_at) where status = 'pending';
create index question_audit_events_question_idx on public.question_audit_events(question_id, created_at desc);
create index workspace_members_user_idx on public.workspace_members(user_id, workspace_id) where status = 'active';
create index class_members_user_idx on public.class_members(user_id, class_id) where status = 'active';
create index generation_jobs_requester_idx on public.generation_jobs(requested_by, created_at desc);

create or replace function private.is_workspace_member(target_workspace_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = target_user_id
      and wm.status = 'active'
  );
$$;

create or replace function private.is_workspace_admin(target_workspace_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = target_user_id
      and wm.status = 'active'
      and wm.role in ('owner', 'teacher')
  );
$$;

create or replace function private.is_workspace_owner(target_workspace_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = target_user_id
      and wm.status = 'active'
      and wm.role = 'owner'
  );
$$;

create or replace function private.is_app_admin(target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and target_user_id = (select auth.uid())
    and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

create or replace function private.can_manage_class(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.class_members cm
      where cm.class_id = target_class_id
        and cm.user_id = (select auth.uid())
        and cm.status = 'active'
        and cm.role = 'teacher'
    )
    or exists (
      select 1 from public.classes c
      join public.workspace_members wm on wm.workspace_id = c.workspace_id
      where c.id = target_class_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'teacher')
    )
  );
$$;

create or replace function private.can_view_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and target_student_id is not null and (
    target_student_id = (select auth.uid())
    or exists (
      select 1
      from public.class_members teacher_member
      join public.class_members student_member on student_member.class_id = teacher_member.class_id
      where teacher_member.user_id = (select auth.uid())
        and teacher_member.role = 'teacher'
        and teacher_member.status = 'active'
        and student_member.user_id = target_student_id
        and student_member.role = 'student'
        and student_member.status = 'active'
    )
    or exists (
      select 1
      from public.workspace_members teacher_member
      join public.workspace_members student_member on student_member.workspace_id = teacher_member.workspace_id
      where teacher_member.user_id = (select auth.uid())
        and teacher_member.role in ('owner', 'teacher')
        and teacher_member.status = 'active'
        and student_member.user_id = target_student_id
        and student_member.role = 'student'
        and student_member.status = 'active'
    )
  );
$$;

create or replace function private.can_access_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.collections c
    where c.id = target_collection_id
      and c.archived_at is null
      and (
        (c.visibility = 'public' and c.published_at is not null)
        or c.owner_id = (select auth.uid())
        or (c.visibility = 'workspace' and private.is_workspace_member(c.workspace_id))
      )
  );
$$;

create or replace function private.can_manage_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.collections c
    where c.id = target_collection_id
      and (
        c.owner_id = (select auth.uid())
        or private.is_app_admin()
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
    select 1 from public.collections c
    where c.id = target_collection_id
      and c.archived_at is null
      and (
        private.can_manage_collection(c.id)
        or (
          c.allow_contributions
          and c.visibility in ('unlisted', 'workspace', 'public')
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
    select 1 from public.questions q
    where q.id = target_question_id
      and (
        q.created_by = (select auth.uid())
        or private.can_manage_collection(q.collection_id)
      )
  );
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid, uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid, uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid, uuid) to authenticated;
grant execute on function private.is_app_admin(uuid) to authenticated;
grant execute on function private.can_manage_class(uuid) to authenticated;
grant execute on function private.can_view_student(uuid) to authenticated;
grant execute on function private.can_access_collection(uuid) to anon, authenticated;
grant execute on function private.can_manage_collection(uuid) to authenticated;
grant execute on function private.can_contribute_collection(uuid) to authenticated;
grant execute on function private.can_edit_question(uuid) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), 'プレイヤー'), 80),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'active');
  return new;
end;
$$;

create trigger on_workspace_created
after insert on public.workspaces
for each row execute function private.add_workspace_owner();

create or replace function private.prepare_question_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by or new.collection_id is distinct from old.collection_id then
      raise exception 'question ownership is immutable';
    end if;
    new.updated_by := coalesce(actor, new.updated_by, old.updated_by, new.created_by);
    new.updated_at := now();
    if old.deleted_at is null and new.deleted_at is not null then
      new.deleted_by := coalesce(actor, new.deleted_by);
    elsif old.deleted_at is not null and new.deleted_at is null then
      new.deleted_by := null;
    end if;
  else
    new.updated_by := coalesce(new.updated_by, actor, new.created_by);
  end if;

  select p.display_name into new.created_by_name
  from public.profiles p where p.id = new.created_by;
  select p.display_name into new.updated_by_name
  from public.profiles p where p.id = new.updated_by;
  return new;
end;
$$;

create trigger prepare_question_write
before insert or update on public.questions
for each row execute function private.prepare_question_write();

create or replace function private.log_question_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_type text;
  actor uuid;
begin
  if tg_op = 'INSERT' then
    change_type := 'created';
    actor := coalesce((select auth.uid()), new.created_by);
    insert into public.question_audit_events(question_id, collection_id, actor_id, event_type, snapshot)
    values (new.id, new.collection_id, actor, change_type, to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    change_type := 'permanently_deleted';
    actor := coalesce((select auth.uid()), old.updated_by, old.created_by);
    insert into public.question_audit_events(question_id, collection_id, actor_id, event_type, snapshot)
    values (old.id, old.collection_id, actor, change_type, to_jsonb(old));
    return old;
  end if;

  change_type := case
    when old.deleted_at is null and new.deleted_at is not null then 'trashed'
    when old.deleted_at is not null and new.deleted_at is null then 'restored'
    else 'updated'
  end;
  actor := coalesce((select auth.uid()), new.updated_by, new.created_by);
  insert into public.question_audit_events(question_id, collection_id, actor_id, event_type, snapshot)
  values (new.id, new.collection_id, actor, change_type, to_jsonb(new));
  return new;
end;
$$;

create trigger log_question_change
after insert or update or delete on public.questions
for each row execute function private.log_question_change();

revoke execute on function private.handle_new_user() from public, anon, authenticated;
revoke execute on function private.add_workspace_owner() from public, anon, authenticated;
revoke execute on function private.prepare_question_write() from public, anon, authenticated;
revoke execute on function private.log_question_change() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.collections enable row level security;
alter table public.questions enable row level security;
alter table public.answer_attempts enable row level security;
alter table public.user_question_state enable row level security;
alter table public.comments enable row level security;
alter table public.question_deletion_requests enable row level security;
alter table public.question_audit_events enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_candidates enable row level security;

create policy profiles_select on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.can_view_student(id));
create policy profiles_insert on public.profiles for insert to authenticated
with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy workspaces_select on public.workspaces for select to authenticated
using (private.is_workspace_member(id));
create policy workspaces_insert on public.workspaces for insert to authenticated
with check (owner_id = (select auth.uid()));
create policy workspaces_update on public.workspaces for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy workspace_members_select on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()) or private.is_workspace_admin(workspace_id));
create policy workspace_members_insert on public.workspace_members for insert to authenticated
with check (private.is_workspace_owner(workspace_id) and role <> 'owner');
create policy workspace_members_update on public.workspace_members for update to authenticated
using (private.is_workspace_owner(workspace_id) and role <> 'owner')
with check (private.is_workspace_owner(workspace_id) and role <> 'owner');
create policy workspace_members_delete on public.workspace_members for delete to authenticated
using (private.is_workspace_owner(workspace_id) and role <> 'owner');

create policy classes_select on public.classes for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy classes_insert on public.classes for insert to authenticated
with check (created_by = (select auth.uid()) and private.is_workspace_admin(workspace_id));
create policy classes_update on public.classes for update to authenticated
using (private.can_manage_class(id)) with check (private.can_manage_class(id));
create policy classes_delete on public.classes for delete to authenticated
using (private.can_manage_class(id));

create policy class_members_select on public.class_members for select to authenticated
using (user_id = (select auth.uid()) or private.can_manage_class(class_id));
create policy class_members_insert on public.class_members for insert to authenticated
with check (private.can_manage_class(class_id));
create policy class_members_update on public.class_members for update to authenticated
using (private.can_manage_class(class_id)) with check (private.can_manage_class(class_id));
create policy class_members_delete on public.class_members for delete to authenticated
using (private.can_manage_class(class_id));

create policy collections_select on public.collections for select to anon, authenticated
using (private.can_access_collection(id));
create policy collections_insert on public.collections for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (workspace_id is null or private.is_workspace_member(workspace_id))
);
create policy collections_update on public.collections for update to authenticated
using (private.can_manage_collection(id))
with check (private.can_manage_collection(id));
create policy collections_delete on public.collections for delete to authenticated
using (private.can_manage_collection(id));

create policy questions_select_active on public.questions for select to anon, authenticated
using (private.can_access_collection(collection_id) and deleted_at is null);
create policy questions_select_trash on public.questions for select to authenticated
using (deleted_at is not null and private.can_edit_question(id));
create policy questions_insert on public.questions for insert to authenticated
with check (created_by = (select auth.uid()) and private.can_contribute_collection(collection_id));
create policy questions_update on public.questions for update to authenticated
using (private.can_edit_question(id))
with check (private.can_edit_question(id));
create policy questions_delete on public.questions for delete to authenticated
using (private.is_app_admin());

create policy attempts_select on public.answer_attempts for select to authenticated
using (user_id = (select auth.uid()) or private.can_view_student(user_id));
create policy attempts_insert on public.answer_attempts for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.questions q where q.id = question_id and private.can_access_collection(q.collection_id))
);
create policy attempts_update on public.answer_attempts for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy attempts_delete on public.answer_attempts for delete to authenticated
using (user_id = (select auth.uid()));

create policy question_state_select on public.user_question_state for select to authenticated
using (user_id = (select auth.uid()));
create policy question_state_insert on public.user_question_state for insert to authenticated
with check (user_id = (select auth.uid()));
create policy question_state_update on public.user_question_state for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy question_state_delete on public.user_question_state for delete to authenticated
using (user_id = (select auth.uid()));

create policy comments_select on public.comments for select to authenticated
using (user_id = (select auth.uid()) or private.can_manage_collection(collection_id));
create policy comments_insert on public.comments for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.collections c
    where c.id = collection_id and c.allow_comments and private.can_access_collection(c.id)
  )
);
create policy comments_delete on public.comments for delete to authenticated
using (user_id = (select auth.uid()) or private.can_manage_collection(collection_id));

create policy deletion_requests_select on public.question_deletion_requests for select to authenticated
using (
  requester_id = (select auth.uid())
  or exists (
    select 1 from public.questions q
    where q.id = question_id
      and (q.created_by = (select auth.uid()) or private.can_manage_collection(q.collection_id))
  )
);
create policy deletion_requests_insert on public.question_deletion_requests for insert to authenticated
with check (
  requester_id = (select auth.uid())
  and exists (
    select 1 from public.questions q
    where q.id = question_id
      and q.deleted_at is null
      and private.can_access_collection(q.collection_id)
  )
);
create policy deletion_requests_update on public.question_deletion_requests for update to authenticated
using (
  exists (
    select 1 from public.questions q
    where q.id = question_id and private.can_manage_collection(q.collection_id)
  )
)
with check (
  exists (
    select 1 from public.questions q
    where q.id = question_id and private.can_manage_collection(q.collection_id)
  )
);

create policy question_audit_select on public.question_audit_events for select to authenticated
using (actor_id = (select auth.uid()) or private.can_manage_collection(collection_id));

create policy generation_jobs_all on public.generation_jobs for all to authenticated
using (requested_by = (select auth.uid()))
with check (requested_by = (select auth.uid()));
create policy generation_candidates_select on public.generation_candidates for select to authenticated
using (exists (select 1 from public.generation_jobs j where j.id = job_id and j.requested_by = (select auth.uid())));
create policy generation_candidates_insert on public.generation_candidates for insert to authenticated
with check (exists (select 1 from public.generation_jobs j where j.id = job_id and j.requested_by = (select auth.uid())));
create policy generation_candidates_update on public.generation_candidates for update to authenticated
using (exists (select 1 from public.generation_jobs j where j.id = job_id and j.requested_by = (select auth.uid())))
with check (exists (select 1 from public.generation_jobs j where j.id = job_id and j.requested_by = (select auth.uid())));
create policy generation_candidates_delete on public.generation_candidates for delete to authenticated
using (exists (select 1 from public.generation_jobs j where j.id = job_id and j.requested_by = (select auth.uid())));

create or replace function public.get_shared_collection(p_share_slug text)
returns table (
  id uuid,
  owner_id uuid,
  title text,
  description text,
  visibility text,
  allow_comments boolean,
  allow_contributions boolean,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.owner_id, c.title, c.description, c.visibility, c.allow_comments, c.allow_contributions, c.published_at
  from public.collections c
  where c.share_slug = p_share_slug
    and c.visibility in ('unlisted', 'public')
    and c.published_at is not null
    and c.archived_at is null;
$$;

create or replace function public.get_shared_questions(p_share_slug text)
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
    and c.visibility in ('unlisted', 'public')
    and c.published_at is not null
    and c.archived_at is null
    and q.deleted_at is null
  order by q.sort_order, q.created_at;
$$;

create or replace function public.get_shared_comments(p_share_slug text, p_question_id uuid default null)
returns table (
  id uuid,
  question_id uuid,
  author_name text,
  author_avatar_url text,
  body text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select cm.id, cm.question_id, p.display_name, p.avatar_url, cm.body, cm.created_at
  from public.comments cm
  join public.collections c on c.id = cm.collection_id
  join public.profiles p on p.id = cm.user_id
  where c.share_slug = p_share_slug
    and c.visibility in ('unlisted', 'public')
    and c.published_at is not null
    and c.archived_at is null
    and cm.deleted_at is null
    and (p_question_id is null or cm.question_id = p_question_id)
  order by cm.created_at;
$$;

create or replace function public.post_shared_comment(p_share_slug text, p_question_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_collection_id uuid;
  new_comment_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if char_length(trim(p_body)) not between 1 and 4000 then
    raise exception 'comment length is invalid';
  end if;

  select c.id into target_collection_id
  from public.collections c
  where c.share_slug = p_share_slug
    and c.visibility in ('unlisted', 'public')
    and c.published_at is not null
    and c.archived_at is null
    and c.allow_comments;

  if target_collection_id is null then
    raise exception 'shared collection not found';
  end if;
  if p_question_id is not null and not exists (
    select 1 from public.questions q
    where q.id = p_question_id and q.collection_id = target_collection_id
  ) then
    raise exception 'question does not belong to collection';
  end if;

  insert into public.comments(collection_id, question_id, user_id, body)
  values (target_collection_id, p_question_id, (select auth.uid()), trim(p_body))
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
declare
  new_attempt_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if p_grade not in ('💮', '◎', '〇', '△', '×') then
    raise exception 'invalid grade';
  end if;
  if p_elapsed_ms is not null and p_elapsed_ms not between 0 and 86400000 then
    raise exception 'invalid elapsed time';
  end if;
  if not exists (
    select 1
    from public.questions q
    join public.collections c on c.id = q.collection_id
    where q.id = p_question_id
      and c.share_slug = p_share_slug
      and c.visibility in ('unlisted', 'public')
      and c.published_at is not null
      and c.archived_at is null
  ) then
    raise exception 'shared question not found';
  end if;

  insert into public.answer_attempts(client_attempt_id, user_id, question_id, answer, grade, elapsed_ms, answered_at)
  values (p_client_attempt_id, (select auth.uid()), p_question_id, coalesce(p_answer, '{}'::jsonb), p_grade, p_elapsed_ms, p_answered_at)
  on conflict (user_id, client_attempt_id) do update set
    answer = excluded.answer,
    grade = excluded.grade,
    elapsed_ms = excluded.elapsed_ms,
    answered_at = excluded.answered_at
  returning id into new_attempt_id;
  return new_attempt_id;
end;
$$;

create or replace function public.get_my_capabilities()
returns table (is_admin boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_app_admin();
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
declare
  target_collection_id uuid;
  new_question_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if char_length(coalesce(p_title, '')) > 160 then
    raise exception 'question title is too long';
  end if;
  if p_source_kind not in ('manual', 'discord', 'naga_scene', 'naga_match') then
    raise exception 'invalid source kind';
  end if;
  if p_decision_type not in ('discard', 'call', 'riichi', 'combined') then
    raise exception 'invalid decision type';
  end if;

  select c.id into target_collection_id
  from public.collections c
  where c.share_slug = p_share_slug
    and c.visibility in ('unlisted', 'public')
    and c.published_at is not null
    and c.archived_at is null
    and c.allow_contributions;

  if target_collection_id is null or not private.can_contribute_collection(target_collection_id) then
    raise exception 'shared collection does not accept contributions';
  end if;

  insert into public.questions(
    collection_id, created_by, title, source_kind, source_report_id, source_url,
    scene_tw, scene_ts, scene_tv, decision_type, payload
  ) values (
    target_collection_id, (select auth.uid()), coalesce(p_title, ''), p_source_kind,
    p_source_report_id, p_source_url, p_scene_tw, p_scene_ts, p_scene_tv,
    p_decision_type, coalesce(p_payload, '{}'::jsonb)
  ) returning id into new_question_id;
  return new_question_id;
end;
$$;

create or replace function public.update_shared_question(
  p_question_id uuid,
  p_title text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit_question(p_question_id) then
    raise exception 'question edit is not allowed';
  end if;
  if char_length(coalesce(p_title, '')) > 160 then
    raise exception 'question title is too long';
  end if;
  update public.questions
  set title = coalesce(p_title, ''), payload = coalesce(p_payload, '{}'::jsonb)
  where id = p_question_id and deleted_at is null;
end;
$$;

create or replace function public.trash_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit_question(p_question_id) then
    raise exception 'question trash is not allowed';
  end if;
  update public.questions
  set deleted_at = now(), deleted_by = (select auth.uid())
  where id = p_question_id and deleted_at is null;
end;
$$;

create or replace function public.restore_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit_question(p_question_id) then
    raise exception 'question restore is not allowed';
  end if;
  update public.questions
  set deleted_at = null, deleted_by = null
  where id = p_question_id and deleted_at is not null;
end;
$$;

create or replace function public.request_question_deletion(p_question_id uuid, p_reason text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id uuid;
  target_collection_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if char_length(coalesce(p_reason, '')) > 1000 then
    raise exception 'deletion request reason is too long';
  end if;
  select q.collection_id into target_collection_id
  from public.questions q
  join public.collections c on c.id = q.collection_id
  where q.id = p_question_id
    and q.deleted_at is null
    and c.visibility in ('unlisted', 'public')
    and c.published_at is not null
    and c.archived_at is null;
  if target_collection_id is null then
    raise exception 'question not found';
  end if;

  insert into public.question_deletion_requests(question_id, requester_id, reason)
  values (p_question_id, (select auth.uid()), coalesce(p_reason, ''))
  on conflict (question_id, requester_id, status)
  do update set reason = excluded.reason, created_at = now()
  returning id into request_id;

  insert into public.question_audit_events(question_id, collection_id, actor_id, event_type, snapshot)
  values (p_question_id, target_collection_id, (select auth.uid()), 'deletion_requested', jsonb_build_object('requestId', request_id, 'reason', coalesce(p_reason, '')));
  return request_id;
end;
$$;

create or replace function public.resolve_question_deletion_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_question_id uuid;
  target_collection_id uuid;
begin
  select r.question_id, q.collection_id into target_question_id, target_collection_id
  from public.question_deletion_requests r
  join public.questions q on q.id = r.question_id
  where r.id = p_request_id and r.status = 'pending';

  if target_question_id is null or not private.can_manage_collection(target_collection_id) then
    raise exception 'deletion request resolution is not allowed';
  end if;

  update public.question_deletion_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      resolved_by = (select auth.uid()), resolved_at = now()
  where id = p_request_id;

  if p_approve then
    update public.questions
    set deleted_at = now(), deleted_by = (select auth.uid())
    where id = target_question_id and deleted_at is null;
  end if;

  insert into public.question_audit_events(question_id, collection_id, actor_id, event_type, snapshot)
  values (target_question_id, target_collection_id, (select auth.uid()), 'deletion_request_resolved', jsonb_build_object('requestId', p_request_id, 'approved', p_approve));
end;
$$;

create or replace function public.permanently_delete_question(p_question_id uuid, p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_app_admin() then
    raise exception 'administrator access required';
  end if;
  if p_confirmation <> '完全削除' then
    raise exception 'confirmation text is invalid';
  end if;
  delete from public.questions where id = p_question_id;
end;
$$;

create or replace function public.get_question_poll_stats(p_share_slug text, p_question_id uuid)
returns table (
  sample_size bigint,
  correct_rate numeric,
  average_seconds numeric,
  choice_counts jsonb,
  grade_counts jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with first_attempts as (
    select distinct on (a.user_id)
      a.user_id, a.answer, a.grade, a.elapsed_ms
    from public.answer_attempts a
    join public.questions q on q.id = a.question_id
    join public.collections c on c.id = q.collection_id
    where a.question_id = p_question_id
      and q.deleted_at is null
      and c.share_slug = p_share_slug
      and c.visibility in ('unlisted', 'public')
      and c.published_at is not null
      and c.archived_at is null
    order by a.user_id, a.answered_at, a.id
  ), totals as (
    select
      count(*)::bigint as n,
      count(*) filter (where grade in ('💮', '◎', '〇'))::bigint as correct_n,
      round(avg(elapsed_ms)::numeric / 1000, 1) as avg_seconds
    from first_attempts
  ), choices as (
    select coalesce(
      nullif(answer ->> 'selected', ''),
      nullif(answer ->> 'callDecision', ''),
      nullif(answer ->> 'riichi', ''),
      '未選択'
    ) as choice, count(*)::bigint as n
    from first_attempts
    group by 1
  ), grades as (
    select grade, count(*)::bigint as n
    from first_attempts
    group by grade
  )
  select
    t.n,
    round(100.0 * t.correct_n / nullif(t.n, 0), 1),
    t.avg_seconds,
    coalesce((select jsonb_object_agg(choice, n) from choices), '{}'::jsonb),
    coalesce((select jsonb_object_agg(grade, n) from grades), '{}'::jsonb)
  from totals t
  where t.n >= 5
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.answer_attempts mine
      where mine.question_id = p_question_id and mine.user_id = (select auth.uid())
    );
$$;

revoke all on function public.get_shared_collection(text) from public, anon, authenticated, service_role;
revoke all on function public.get_shared_questions(text) from public, anon, authenticated, service_role;
revoke all on function public.get_shared_comments(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.post_shared_comment(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_shared_attempt(text, uuid, uuid, jsonb, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.get_my_capabilities() from public, anon, authenticated, service_role;
revoke all on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.update_shared_question(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.trash_question(uuid) from public, anon, authenticated, service_role;
revoke all on function public.restore_question(uuid) from public, anon, authenticated, service_role;
revoke all on function public.request_question_deletion(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_question_deletion_request(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.permanently_delete_question(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.get_question_poll_stats(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_collection(text) to anon, authenticated;
grant execute on function public.get_shared_questions(text) to anon, authenticated;
grant execute on function public.get_shared_comments(text, uuid) to anon, authenticated;
grant execute on function public.post_shared_comment(text, uuid, text) to authenticated;
grant execute on function public.record_shared_attempt(text, uuid, uuid, jsonb, text, integer, timestamptz) to authenticated;
grant execute on function public.get_my_capabilities() to authenticated;
grant execute on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text) to authenticated;
grant execute on function public.update_shared_question(uuid, text, jsonb) to authenticated;
grant execute on function public.trash_question(uuid) to authenticated;
grant execute on function public.restore_question(uuid) to authenticated;
grant execute on function public.request_question_deletion(uuid, text) to authenticated;
grant execute on function public.resolve_question_deletion_request(uuid, boolean) to authenticated;
grant execute on function public.permanently_delete_question(uuid, text) to authenticated;
grant execute on function public.get_question_poll_stats(text, uuid) to authenticated;

create view public.student_learning_summary
with (security_invoker = true)
as
select
  a.user_id,
  p.display_name,
  count(*)::bigint as attempt_count,
  count(distinct a.question_id)::bigint as answered_questions,
  round(avg(a.elapsed_ms)::numeric / 1000, 1) as average_seconds,
  count(*) filter (where a.grade in ('💮', '◎', '〇'))::bigint as safe_count,
  count(*) filter (where a.grade in ('△', '×'))::bigint as weak_count,
  max(a.answered_at) as last_answered_at
from public.answer_attempts a
join public.profiles p on p.id = a.user_id
group by a.user_id, p.display_name;

grant usage on schema public to anon, authenticated;
grant select on public.collections, public.questions to anon;
grant select, insert, update, delete on public.profiles, public.workspaces, public.workspace_members,
  public.classes, public.class_members, public.collections, public.questions, public.answer_attempts,
  public.user_question_state, public.comments, public.question_deletion_requests,
  public.generation_jobs, public.generation_candidates to authenticated;
grant select on public.question_audit_events to authenticated;
grant select on public.student_learning_summary to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-assets', 'question-assets', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy question_assets_insert on storage.objects for insert to authenticated
with check (bucket_id = 'question-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy question_assets_select on storage.objects for select to authenticated
using (bucket_id = 'question-assets' and owner_id = (select auth.uid())::text);
create policy question_assets_update on storage.objects for update to authenticated
using (bucket_id = 'question-assets' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'question-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy question_assets_delete on storage.objects for delete to authenticated
using (bucket_id = 'question-assets' and owner_id = (select auth.uid())::text);
