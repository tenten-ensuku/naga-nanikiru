-- V211: カスタムリアクション作成者FKの参照・削除を支えるインデックス
create index if not exists custom_reactions_creator_user_idx
  on public.custom_reactions (creator_user_id);
