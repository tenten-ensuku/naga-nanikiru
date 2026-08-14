-- Shared comments can contain up to four intentionally public image attachments.
-- The bucket is separate from question-assets so private question uploads remain private.

alter table public.comments
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.comments drop constraint if exists comments_body_check;
alter table public.comments drop constraint if exists comments_attachments_shape_check;

alter table public.comments
  add constraint comments_body_check
  check (
    char_length(body) <= 4000
    and (char_length(trim(body)) >= 1 or jsonb_array_length(attachments) >= 1)
  );

alter table public.comments
  add constraint comments_attachments_shape_check
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comment-assets',
  'comment-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists comment_assets_insert on storage.objects;
create policy comment_assets_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'comment-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] = 'comments'
);

drop policy if exists comment_assets_update on storage.objects;
create policy comment_assets_update on storage.objects for update to authenticated
using (bucket_id = 'comment-assets' and owner_id = (select auth.uid())::text)
with check (
  bucket_id = 'comment-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] = 'comments'
);

drop policy if exists comment_assets_delete on storage.objects;
create policy comment_assets_delete on storage.objects for delete to authenticated
using (bucket_id = 'comment-assets' and owner_id = (select auth.uid())::text);

drop function if exists public.get_shared_comments(text, uuid);
create function public.get_shared_comments(p_share_slug text, p_question_id uuid default null)
returns table (
  id uuid,
  question_id uuid,
  author_name text,
  author_avatar_url text,
  body text,
  attachments jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select cm.id, cm.question_id, p.display_name, p.avatar_url, cm.body, cm.attachments, cm.created_at
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

  insert into public.comments(collection_id, question_id, user_id, body, attachments)
  values (target_collection_id, p_question_id, (select auth.uid()), coalesce(trim(p_body), ''), attachment_payload)
  returning id into new_comment_id;
  return new_comment_id;
end;
$$;

revoke all on function public.get_shared_comments(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_comments(text, uuid) to anon, authenticated;
revoke all on function public.post_shared_comment(text, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.post_shared_comment(text, uuid, text, jsonb) to authenticated;
