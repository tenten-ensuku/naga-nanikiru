-- v181: keep the complete shared-collection access contract while adding
-- Pierre series metadata. The volume picker needs the same can_view fields
-- as the normal collection screen.
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
  request_message text,
  series_key text,
  series_parent_id uuid,
  series_parent_slug text,
  series_title text,
  volume_number integer,
  volume_start integer,
  volume_end integer,
  is_series_parent boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id,
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
         (select cm.role
            from public.collection_members cm
           where cm.collection_id = c.id
             and cm.user_id = (select auth.uid())
           limit 1),
         (select cm.status
            from public.collection_members cm
           where cm.collection_id = c.id
             and cm.user_id = (select auth.uid())
           limit 1),
         (select ar.id
            from public.collection_access_requests ar
           where ar.collection_id = c.id
             and ar.requester_id = (select auth.uid())
           order by ar.created_at desc
           limit 1),
         (select ar.status
            from public.collection_access_requests ar
           where ar.collection_id = c.id
             and ar.requester_id = (select auth.uid())
           order by ar.created_at desc
           limit 1),
         (select ar.message
            from public.collection_access_requests ar
           where ar.collection_id = c.id
             and ar.requester_id = (select auth.uid())
           order by ar.created_at desc
           limit 1),
         c.series_key,
         c.series_parent_id,
         case
           when c.series_parent_id is null and c.series_key is not null then c.share_slug
           else parent.share_slug
         end,
         case
           when c.series_parent_id is null and c.series_key is not null then c.title
           else parent.title
         end,
         c.volume_number,
         c.volume_start,
         c.volume_end,
         c.series_parent_id is null and c.series_key is not null
    from public.collections c
    left join public.profiles owner_profile on owner_profile.id = c.owner_id
    left join public.collections parent on parent.id = c.series_parent_id
   where c.share_slug = p_share_slug
     and c.archived_at is null;
$function$;

revoke all on function public.get_shared_collection(text) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_collection(text) to anon, authenticated;
