-- Allow authors to revise their own shared comments and authors/managers to remove them.
-- The browser still exposes edit/delete controls only when the current user owns the comment.

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated
using (
  user_id = (select auth.uid())
  or private.can_manage_collection(collection_id)
)
with check (
  user_id = (select auth.uid())
  or private.can_manage_collection(collection_id)
);

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
    and c.visibility in ('unlisted', 'public')
    and c.published_at is not null
    and c.archived_at is null
    and cm.deleted_at is null
    and (p_question_id is null or cm.question_id = p_question_id)
  order by cm.created_at;
$$;

drop function if exists public.update_shared_comment(uuid, text, jsonb);
create function public.update_shared_comment(
  p_comment_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attachment_payload jsonb := coalesce(p_attachments, '[]'::jsonb);
  updated_comment_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if jsonb_typeof(attachment_payload) <> 'array' or jsonb_array_length(attachment_payload) > 4 then
    raise exception 'comment attachments are invalid';
  end if;
  if char_length(coalesce(trim(p_body), '')) > 4000
    or (char_length(coalesce(trim(p_body), '')) = 0 and jsonb_array_length(attachment_payload) = 0) then
    raise exception 'comment content is invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(attachment_payload) as attachment(value)
    where jsonb_typeof(attachment.value) <> 'object'
      or char_length(coalesce(attachment.value->>'path', '')) = 0
      or char_length(coalesce(attachment.value->>'alt', '')) > 200
      or (attachment.value->>'path') !~ ('^' || (select auth.uid())::text || '/comments/[A-Za-z0-9][A-Za-z0-9._-]*$')
      or not exists (
        select 1
        from storage.objects object_row
        where object_row.bucket_id = 'comment-assets'
          and object_row.name = attachment.value->>'path'
          and object_row.owner_id = (select auth.uid())::text
      )
  ) then
    raise exception 'comment attachments are invalid';
  end if;

  update public.comments
  set body = coalesce(trim(p_body), ''),
      attachments = attachment_payload,
      updated_at = now()
  where id = p_comment_id
    and user_id = (select auth.uid())
    and deleted_at is null
  returning id into updated_comment_id;
  if updated_comment_id is null then
    raise exception 'comment not found or not editable';
  end if;
end;
$$;

drop function if exists public.delete_shared_comment(uuid);
create function public.delete_shared_comment(p_comment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed_attachments jsonb;
  deleted_comment_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  update public.comments
  set deleted_at = now(), updated_at = now()
  where id = p_comment_id
    and deleted_at is null
  returning id, attachments into deleted_comment_id, removed_attachments;
  if deleted_comment_id is null then
    raise exception 'comment not found or not deletable';
  end if;
  return coalesce(removed_attachments, '[]'::jsonb);
end;
$$;

revoke all on function public.get_shared_comments(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_shared_comment(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.delete_shared_comment(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_comments(text, uuid) to anon, authenticated;
grant execute on function public.update_shared_comment(uuid, text, jsonb) to authenticated;
grant execute on function public.delete_shared_comment(uuid) to authenticated;
