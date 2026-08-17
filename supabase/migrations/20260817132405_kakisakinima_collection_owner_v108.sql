-- V108: one-time exception for the verified Kakisaki Nima account.
-- The profile match is cross-checked against existing answer history and must
-- be unique; this is a one-time server-side migration, not runtime name auth.

do $$
declare
  target_collection_id uuid;
  target_user_id uuid;
  candidate_count integer;
begin
  select count(*)::integer into candidate_count
  from public.profiles p
  where p.display_name = 'kakisakinima'
    and exists (
      select 1
      from public.answer_attempts aa
      where aa.user_id = p.id
    );

  if candidate_count <> 1 then
    raise exception 'expected exactly one verified kakisakinima account, found %', candidate_count;
  end if;

  select p.id into target_user_id
  from public.profiles p
  where p.display_name = 'kakisakinima'
    and exists (
      select 1
      from public.answer_attempts aa
      where aa.user_id = p.id
    );

  select c.id into target_collection_id
  from public.collections c
  where c.title = '垣崎にま問題集'
    and c.share_slug = '9f0872755e2f4ea18a475ef2'
    and c.archived_at is null;

  if target_collection_id is null then
    raise exception '垣崎にま問題集 was not found';
  end if;

  update public.collections
  set owner_id = target_user_id,
      updated_at = now()
  where id = target_collection_id
    and owner_id is distinct from target_user_id;
end;
$$;
