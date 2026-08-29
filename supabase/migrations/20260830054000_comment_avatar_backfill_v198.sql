-- Discordから取り込んだ過去コメントにも、対応するアプリ内プロフィールの
-- Discordアイコンを保持させる。コメント本文・画像・日時は変更しない。

with comment_payloads as (
  select
    q.id,
    jsonb_agg(
      case
        when coalesce(
          nullif(btrim(comment.value->>'avatarUrl'), ''),
          nullif(btrim(comment.value->>'avatar_url'), ''),
          nullif(btrim(comment.value->>'authorAvatarUrl'), ''),
          nullif(btrim(comment.value->>'author_avatar_url'), '')
        ) is not null
        or matched.avatar_url is null
          then comment.value
        else comment.value || jsonb_build_object('avatarUrl', matched.avatar_url)
      end
      order by comment.ordinality
    ) as comments
  from public.questions q
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(q.payload->'comments') = 'array'
      then q.payload->'comments'
      else '[]'::jsonb
    end
  ) with ordinality as comment(value, ordinality)
  left join lateral (
    select p.avatar_url
      from public.profiles p
     where p.avatar_url ~* '^https://(cdn\.discordapp\.com|media\.discordapp\.net|images-ext-[0-9]+\.discordapp\.net)/'
       and (
         lower(btrim(comment.value->>'author')) = lower(btrim(p.display_name))
         or lower(btrim(comment.value->>'author')) in ('marlboro', 'マルモロ') and lower(btrim(p.display_name)) = 'marlboro0908'
         or lower(btrim(comment.value->>'author')) = '垣崎にま' and lower(btrim(p.display_name)) = 'kakisakinima'
         or lower(btrim(comment.value->>'author')) = 'くにたそ' and lower(btrim(p.display_name)) = 'kunimusya'
         or (
           char_length(btrim(comment.value->>'author')) >= 4
           and lower(btrim(p.display_name)) like lower(btrim(comment.value->>'author')) || '%'
         )
       )
     order by
       (lower(btrim(comment.value->>'author')) = lower(btrim(p.display_name))) desc,
       char_length(p.display_name)
     limit 1
  ) matched on true
  where q.deleted_at is null
    and jsonb_typeof(q.payload->'comments') = 'array'
  group by q.id
)
update public.questions q
   set payload = jsonb_set(q.payload, '{comments}', comment_payloads.comments, true)
  from comment_payloads
 where q.id = comment_payloads.id;
