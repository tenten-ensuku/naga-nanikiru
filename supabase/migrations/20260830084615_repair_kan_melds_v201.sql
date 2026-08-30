-- 現行リプレイで確認できる副露状態に合わせ、保存済みの3問を補正する。
-- 手牌・副露以外のpayload（画像・コメント・出典情報など）は変更しない。
-- 全問題集を監査した結果、同じ「カン牌が手牌に残る」欠落はこの3問だけだった。
do $$
declare
  repaired_count integer;
begin
  update public.questions
     set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
       'handBeforeDraw', jsonb_build_array(
         'man4', 'man4', 'man9', 'man7', 'pin1', 'sou8', 'sou4'
       ),
       'melds', jsonb_build_array(
         jsonb_build_object(
           'type', 'pon',
           'pai', 'ji2',
           'consumed', jsonb_build_array('ji2', 'ji2')
         ),
         jsonb_build_object(
           'type', 'daiminkan',
           'pai', 'pin9',
           'consumed', jsonb_build_array('pin9', 'pin9', 'pin9')
         )
       )
     )
   where collection_id = '3c14e853-67df-4dd7-8237-77e95056ade2'::uuid
     and source_report_id = 'ff3708c66c66cd676a4a787c0d488d74b76efc7a70c81b0a713d290da3ebf6f0v2_2'
     and scene_tw = 2
     and scene_ts = 7
     and scene_tv = 20;

  get diagnostics repaired_count = row_count;
  if repaired_count <> 1 then
    raise exception 'Expected to repair Pierre question 910, repaired %', repaired_count;
  end if;

  update public.questions
     set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
       'handBeforeDraw', jsonb_build_array(
         'man9', 'man3', 'sou8', 'man9', 'ji3', 'man2', 'ji1'
       ),
       'melds', jsonb_build_array(
         jsonb_build_object(
           'type', 'pon',
           'pai', 'ji4',
           'consumed', jsonb_build_array('ji4', 'ji4')
         ),
         jsonb_build_object(
           'type', 'daiminkan',
           'pai', 'ji2',
           'consumed', jsonb_build_array('ji2', 'ji2', 'ji2')
         )
       )
     )
   where collection_id = 'd6b773c0-f727-4541-8740-d9920888f6bb'::uuid
     and source_report_id = '34a33ce6f47e9175ac23dbfd1214dc3e0e200c6cbd78182d94decc071ab21443v2_2'
     and scene_tw = 0
     and scene_ts = 1
     and scene_tv = 19;

  get diagnostics repaired_count = row_count;
  if repaired_count <> 1 then
    raise exception 'Expected to repair Pierre question 1312, repaired %', repaired_count;
  end if;

  update public.questions
     set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
       'handBeforeDraw', jsonb_build_array(
         'ji1', 'sou3', 'pin2', 'man9', 'aka3', 'sou5', 'man9', 'pin3', 'sou3', 'ji7'
       ),
       'melds', jsonb_build_array(
         jsonb_build_object(
           'type', 'daiminkan',
           'pai', 'ji5',
           'consumed', jsonb_build_array('ji5', 'ji5', 'ji5')
         )
       )
     )
   where collection_id = 'd6b773c0-f727-4541-8740-d9920888f6bb'::uuid
     and source_report_id = '0d235c549aa64bc6c64f3829bb9f861a63db48c7bb0cda136de409eb391cc9fbv2_2'
     and scene_tw = 3
     and scene_ts = 11
     and scene_tv = 26;

  get diagnostics repaired_count = row_count;
  if repaired_count <> 1 then
    raise exception 'Expected to repair Pierre question 1377, repaired %', repaired_count;
  end if;

  if not exists (
    select 1
      from public.questions
     where collection_id = '3c14e853-67df-4dd7-8237-77e95056ade2'::uuid
       and source_report_id = 'ff3708c66c66cd676a4a787c0d488d74b76efc7a70c81b0a713d290da3ebf6f0v2_2'
       and scene_tw = 2
       and scene_ts = 7
       and scene_tv = 20
       and jsonb_array_length(payload -> 'handBeforeDraw') = 7
       and payload -> 'melds' @> '[{"type":"daiminkan","pai":"pin9","consumed":["pin9","pin9","pin9"]}]'::jsonb
  ) then
    raise exception 'Question 910 kan repair verification failed';
  end if;

  if not exists (
    select 1
      from public.questions
     where collection_id = 'd6b773c0-f727-4541-8740-d9920888f6bb'::uuid
       and source_report_id = '34a33ce6f47e9175ac23dbfd1214dc3e0e200c6cbd78182d94decc071ab21443v2_2'
       and scene_tw = 0
       and scene_ts = 1
       and scene_tv = 19
       and jsonb_array_length(payload -> 'handBeforeDraw') = 7
       and payload -> 'melds' @> '[{"type":"daiminkan","pai":"ji2","consumed":["ji2","ji2","ji2"]}]'::jsonb
  ) then
    raise exception 'Question 1312 kan repair verification failed';
  end if;

  if not exists (
    select 1
      from public.questions
     where collection_id = 'd6b773c0-f727-4541-8740-d9920888f6bb'::uuid
       and source_report_id = '0d235c549aa64bc6c64f3829bb9f861a63db48c7bb0cda136de409eb391cc9fbv2_2'
       and scene_tw = 3
       and scene_ts = 11
       and scene_tv = 26
       and jsonb_array_length(payload -> 'handBeforeDraw') = 10
       and payload -> 'melds' @> '[{"type":"daiminkan","pai":"ji5","consumed":["ji5","ji5","ji5"]}]'::jsonb
  ) then
    raise exception 'Question 1377 kan repair verification failed';
  end if;
end
$$;
