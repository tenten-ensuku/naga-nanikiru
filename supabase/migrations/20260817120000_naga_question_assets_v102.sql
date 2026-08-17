-- Bot同期用の問題画像・コメント画像を保存する公開バケット。
-- 書き込みはサーバー専用secret keyを使う同期処理だけに限定し、
-- 閲覧は問題集の公開範囲判定を通過したアプリから行う。
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'naga-question-assets',
  'naga-question-assets',
  true,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[],
  10485760
)
on conflict (id) do update
set public = true,
    allowed_mime_types = excluded.allowed_mime_types,
    file_size_limit = excluded.file_size_limit;
