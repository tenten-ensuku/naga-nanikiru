-- 同一のNAGA局面を複数回追加しても、画面にDBエラーを返さず既存問題を返す。
-- 旧環境に残る4列の制約を整理し、tvまで含めた局面単位で一意にする。
alter table public.questions
  drop constraint if exists questions_collection_id_source_report_id_scene_tw_scene_ts_key,
  drop constraint if exists questions_collection_id_source_report_id_scene_tw_scene_ts_scene_tv_key;

alter table public.questions
  add constraint questions_collection_id_source_report_id_scene_tw_scene_ts_scene_tv_key
  unique nulls not distinct (collection_id, source_report_id, scene_tw, scene_ts, scene_tv);

drop function if exists public.create_shared_question(
  text, text, jsonb, text, text, text, smallint, integer, integer, text
);

create function public.create_shared_question(
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_collection_id uuid;
  existing_question_id uuid;
  new_question_id uuid;
  target_number integer;
  normalized_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(coalesce(p_title, '')) > 160 then raise exception 'question title is too long'; end if;
  if p_source_kind not in ('manual', 'discord', 'naga_scene', 'naga_match') then raise exception 'invalid source kind'; end if;
  if p_decision_type not in ('discard', 'call', 'riichi', 'combined') then raise exception 'invalid decision type'; end if;

  select c.id into target_collection_id
  from public.collections c
  where c.share_slug = p_share_slug
    and c.archived_at is null;
  if target_collection_id is null or not private.can_contribute_collection(target_collection_id) then
    raise exception 'an owner or editor member is required to add questions';
  end if;

  -- 先に既存行を返す。これにより、同一局面の再追加はエラーではなく
  -- 既存問題への移動情報として扱える。
  select q.id into existing_question_id
  from public.questions q
  where q.collection_id = target_collection_id
    and q.source_report_id is not distinct from p_source_report_id
    and q.scene_tw is not distinct from p_scene_tw
    and q.scene_ts is not distinct from p_scene_ts
    and q.scene_tv is not distinct from p_scene_tv
  order by q.created_at asc
  limit 1;
  if existing_question_id is not null then
    return jsonb_build_object('question_id', existing_question_id, 'already_exists', true);
  end if;

  -- 競合時も登録処理を失敗させず、下の再検索で勝者のIDを返す。
  select coalesce(max((q.payload ->> 'number')::integer), 0) + 1
    into target_number
  from public.questions q
  where q.collection_id = target_collection_id
    and (q.payload ->> 'number') ~ '^[0-9]+$';

  normalized_payload := case
    when jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object' then coalesce(p_payload, '{}'::jsonb)
    else '{}'::jsonb
  end;
  normalized_payload := jsonb_set(normalized_payload, '{number}', to_jsonb(target_number), true);
  normalized_payload := jsonb_set(normalized_payload, '{title}', to_jsonb(format('問題%s', target_number)), true);

  insert into public.questions(
    collection_id, created_by, title, source_kind, source_report_id, source_url,
    scene_tw, scene_ts, scene_tv, decision_type, payload
  ) values (
    target_collection_id, (select auth.uid()), format('問題%s', target_number), p_source_kind,
    p_source_report_id, p_source_url, p_scene_tw, p_scene_ts, p_scene_tv,
    p_decision_type, normalized_payload
  ) on conflict do nothing returning id into new_question_id;

  if new_question_id is not null then
    return jsonb_build_object('question_id', new_question_id, 'already_exists', false);
  end if;

  select q.id into existing_question_id
  from public.questions q
  where q.collection_id = target_collection_id
    and q.source_report_id is not distinct from p_source_report_id
    and q.scene_tw is not distinct from p_scene_tw
    and q.scene_ts is not distinct from p_scene_ts
    and q.scene_tv is not distinct from p_scene_tv
  order by q.created_at asc
  limit 1;
  if existing_question_id is null then
    raise exception 'question could not be created';
  end if;
  return jsonb_build_object('question_id', existing_question_id, 'already_exists', true);
end;
$$;

revoke all on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_shared_question(text, text, jsonb, text, text, text, smallint, integer, integer, text)
  to authenticated;
