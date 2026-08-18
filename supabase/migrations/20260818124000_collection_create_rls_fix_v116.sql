-- v116: create collection through a tightly scoped security-definer RPC.
--
-- The caller is still required to be authenticated and the owner_id is always
-- taken from auth.uid().  SECURITY DEFINER is used here only because the
-- invoker-side INSERT was rejected by the collections RLS policy even for a
-- valid authenticated session.  No caller-supplied owner_id is accepted.

create or replace function public.create_collection(
  p_title text,
  p_description text default '',
  p_workspace_id uuid default null,
  p_visibility text default 'private',
  p_allow_contributions boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_description text := coalesce(p_description, '');
  normalized_visibility text := lower(btrim(coalesce(p_visibility, 'private')));
  new_collection public.collections;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if char_length(normalized_title) not between 1 and 120 then
    raise exception 'collection title is invalid';
  end if;
  if char_length(normalized_description) > 3000 then
    raise exception 'collection description is too long';
  end if;
  if normalized_visibility not in ('private', 'request', 'public') then
    raise exception 'invalid collection visibility';
  end if;
  if p_workspace_id is not null and not private.is_workspace_member(p_workspace_id, current_user_id) then
    raise exception 'workspace membership is required';
  end if;

  insert into public.collections(
    owner_id,
    workspace_id,
    title,
    description,
    visibility,
    allow_contributions,
    published_at
  )
  values (
    current_user_id,
    p_workspace_id,
    normalized_title,
    normalized_description,
    normalized_visibility,
    coalesce(p_allow_contributions, true),
    case when normalized_visibility = 'private' then null else now() end
  )
  returning * into new_collection;

  return to_jsonb(new_collection);
end;
$$;

revoke all on function public.create_collection(text, text, uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.create_collection(text, text, uuid, text, boolean) to authenticated;
