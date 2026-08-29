-- 問題1603（ピエール問題集 第9巻）の保存済みデータを、カンを副露として
-- 表現する現在のリプレイ形式へ補正する。コメント・画像・出典情報は変更しない。
do $$
declare
  repaired_count integer;
begin
  update public.questions
     set payload = payload || jsonb_build_object(
       'handBeforeDraw', jsonb_build_array(
         'man2', 'pin2', 'man3', 'pin2', 'man8', 'man1', 'man9'
       ),
       'melds', jsonb_build_array(
         jsonb_build_object(
           'type', 'chi',
           'pai', 'aka3',
           'consumed', jsonb_build_array('sou6', 'sou7')
         ),
         jsonb_build_object(
           'type', 'daiminkan',
           'pai', 'ji5',
           'consumed', jsonb_build_array('ji5', 'ji5', 'ji5')
         )
       )
     )
   where source_report_id = 'f839fbe953e327b32422e1d16c523aa49bef1083780d2a8005282f74451e977bv2_2'
     and scene_tw = 2
     and scene_ts = 7
     and scene_tv = 81;

  get diagnostics repaired_count = row_count;
  if repaired_count <> 1 then
    raise exception 'Expected to repair exactly one kan question, repaired %', repaired_count;
  end if;

  if not exists (
    select 1
      from public.questions
     where source_report_id = 'f839fbe953e327b32422e1d16c523aa49bef1083780d2a8005282f74451e977bv2_2'
       and scene_tw = 2
       and scene_ts = 7
       and scene_tv = 81
       and jsonb_array_length(payload -> 'handBeforeDraw') = 7
       and payload -> 'melds' @> '[{"type":"daiminkan","pai":"ji5","consumed":["ji5","ji5","ji5"]}]'::jsonb
  ) then
    raise exception 'Kan question repair verification failed';
  end if;
end
$$;
