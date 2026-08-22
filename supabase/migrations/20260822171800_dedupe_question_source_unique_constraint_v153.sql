do $$
declare
  existing_constraint record;
begin
  for existing_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.questions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) =
        'UNIQUE NULLS NOT DISTINCT (collection_id, source_report_id, scene_tw, scene_ts, scene_tv)'
  loop
    execute format(
      'alter table public.questions drop constraint if exists %I',
      existing_constraint.conname
    );
  end loop;
end $$;

alter table public.questions
  add constraint questions_source_report_scene_key
  unique nulls not distinct (collection_id, source_report_id, scene_tw, scene_ts, scene_tv);
