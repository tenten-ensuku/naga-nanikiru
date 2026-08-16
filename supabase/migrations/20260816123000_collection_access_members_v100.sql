-- V100 follow-up: let collection managers review and revoke active members.
create or replace function public.list_collection_members(p_collection_id uuid)
returns table (user_id uuid, display_name text, role text, status text, granted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select cm.user_id, p.display_name, cm.role, cm.status, cm.granted_at
  from public.collection_members cm
  left join public.profiles p on p.id = cm.user_id
  where cm.collection_id = p_collection_id
    and private.can_manage_collection(cm.collection_id)
  order by cm.status, cm.granted_at desc;
$$;

revoke all on function public.list_collection_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_collection_members(uuid) to authenticated;
