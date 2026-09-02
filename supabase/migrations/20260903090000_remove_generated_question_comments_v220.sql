-- V220: remove the legacy automatic comment created by the NAGA question generator.
-- The predicate is intentionally narrow: user-authored comments and comments with
-- attachments are preserved.
with marked as (
  select
    q.id as question_id,
    cm.value,
    cm.ordinality,
    (
      cm.value->>'id' like 'generated-%'
      and cm.value->>'author' = '問題生成'
      and cm.value->>'content' in ('NAGA URLから作成した問題です。', 'NAGA URLから追加した問題です。')
      and coalesce(cm.value->'attachments', '[]'::jsonb) = '[]'::jsonb
    ) as is_generated
  from public.questions q
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(q.payload->'comments') = 'array' then q.payload->'comments' else '[]'::jsonb end
  ) with ordinality as cm(value, ordinality)
),
rewritten as (
  select
    question_id,
    bool_or(is_generated) as has_generated,
    jsonb_agg(value order by ordinality) filter (where not is_generated) as kept_comments
  from marked
  group by question_id
)
update public.questions q
set payload = jsonb_set(
  coalesce(q.payload, '{}'::jsonb),
  '{comments}',
  coalesce(rewritten.kept_comments, '[]'::jsonb),
  true
),
updated_at = now()
from rewritten
where q.id = rewritten.question_id
  and rewritten.has_generated;
