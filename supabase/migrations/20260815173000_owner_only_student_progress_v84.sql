-- V84: make student progress visible only to the application owner.
-- The default NAGA workspace is also used as the membership boundary.

create or replace function private.can_view_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target_student_id is not null
    and (
      target_student_id = (select auth.uid())
      or (
        private.is_app_admin()
        and exists (
          select 1
          from public.workspace_members owner_member
          join public.workspace_members student_member
            on student_member.workspace_id = owner_member.workspace_id
          where owner_member.user_id = (select auth.uid())
            and owner_member.role = 'owner'
            and owner_member.status = 'active'
            and student_member.user_id = target_student_id
            and student_member.role = 'student'
            and student_member.status = 'active'
        )
      )
    );
$$;

create or replace function private.add_default_naga_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role, status)
  select w.id, new.id, 'student', 'active'
  from public.workspaces w
  where w.name = 'NAGA問題集'
    and w.owner_id <> new.id
  on conflict (workspace_id, user_id) do update
    set role = case when public.workspace_members.role = 'owner' then 'owner' else 'student' end,
        status = 'active';
  return new;
end;
$$;

drop trigger if exists on_profile_created_add_default_naga_student on public.profiles;
create trigger on_profile_created_add_default_naga_student
after insert on public.profiles
for each row execute function private.add_default_naga_student();

do $$
declare
  v_owner_id uuid;
  v_workspace_id uuid;
begin
  select id into v_owner_id
  from auth.users
  where coalesce((raw_app_meta_data ->> 'is_admin')::boolean, false)
  order by created_at
  limit 1;

  if v_owner_id is null then
    raise exception 'No application owner account was found';
  end if;

  select id into v_workspace_id
  from public.workspaces
  where owner_id = v_owner_id
    and name = 'NAGA問題集'
  limit 1;

  if v_workspace_id is null then
    insert into public.workspaces(owner_id, name)
    values (v_owner_id, 'NAGA問題集')
    returning id into v_workspace_id;
  end if;

  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (v_workspace_id, v_owner_id, 'owner', 'active')
  on conflict (workspace_id, user_id) do update
    set role = 'owner', status = 'active';

  insert into public.workspace_members(workspace_id, user_id, role, status)
  select v_workspace_id, u.id, 'student', 'active'
  from auth.users u
  where u.id <> v_owner_id
  on conflict (workspace_id, user_id) do update
    set role = case when public.workspace_members.role = 'owner' then 'owner' else 'student' end,
        status = 'active';
end;
$$;
