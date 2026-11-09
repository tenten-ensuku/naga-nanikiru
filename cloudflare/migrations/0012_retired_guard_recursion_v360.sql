-- Fix D1 trigger compilation: recursive terms must not re-enter materialized
-- sibling CTEs. D1 rejected the old guards with "no such table: main.inputs"
-- or "VIEWs and/or subqueries nested too deep" before any comment could save.
-- Carry only input length through chunks and an already bounded <=2049-character
-- window through slashes. Full input strings remain materialized once; the
-- retirement ledger, indexed exact-key matching, input budget, and guards on
-- all existing entry points stay in effect. No stored rows are changed.
-- Existing trigger names are retained for operator tooling.

DROP TRIGGER retired_image_question_insert_v260;
CREATE TRIGGER retired_image_question_insert_v260 BEFORE INSERT ON questions
WHEN EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(j.atom,'%2F','/'),'%2f','/') AS value
          FROM json_tree(NEW.payload) j
          WHERE j.type='text' AND (instr(j.atom,'/')>0 OR instr(j.atom,'%2')>0)
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_question_update_v260;
CREATE TRIGGER retired_image_question_update_v260 BEFORE UPDATE OF payload ON questions
WHEN NEW.payload IS NOT OLD.payload AND EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(j.atom,'%2F','/'),'%2f','/') AS value
          FROM json_tree(NEW.payload) j
          WHERE j.type='text' AND (instr(j.atom,'/')>0 OR instr(j.atom,'%2')>0)
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_comment_insert_v260;
CREATE TRIGGER retired_image_comment_insert_v260 BEFORE INSERT ON comments
WHEN EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(NEW.body,'%2F','/'),'%2f','/') AS value
      UNION ALL
      SELECT replace(replace(j.atom,'%2F','/'),'%2f','/') AS value
          FROM json_tree(NEW.attachments) j
          WHERE j.type='text' AND (instr(j.atom,'/')>0 OR instr(j.atom,'%2')>0)
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_comment_update_v260;
CREATE TRIGGER retired_image_comment_update_v260 BEFORE UPDATE OF body,attachments ON comments
WHEN (NEW.body IS NOT OLD.body OR NEW.attachments IS NOT OLD.attachments)
  AND EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(NEW.body,'%2F','/'),'%2f','/') AS value
      UNION ALL
      SELECT replace(replace(j.atom,'%2F','/'),'%2f','/') AS value
          FROM json_tree(NEW.attachments) j
          WHERE j.type='text' AND (instr(j.atom,'/')>0 OR instr(j.atom,'%2')>0)
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_candidate_insert_v260;
CREATE TRIGGER retired_image_candidate_insert_v260 BEFORE INSERT ON generation_candidates
WHEN EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(j.atom,'%2F','/'),'%2f','/') AS value
          FROM json_tree(NEW.candidate_payload) j
          WHERE j.type='text' AND (instr(j.atom,'/')>0 OR instr(j.atom,'%2')>0)
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_candidate_update_v260;
CREATE TRIGGER retired_image_candidate_update_v260 BEFORE UPDATE OF candidate_payload ON generation_candidates
WHEN NEW.candidate_payload IS NOT OLD.candidate_payload AND EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(j.atom,'%2F','/'),'%2f','/') AS value
          FROM json_tree(NEW.candidate_payload) j
          WHERE j.type='text' AND (instr(j.atom,'/')>0 OR instr(j.atom,'%2')>0)
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_reaction_insert_v260;
CREATE TRIGGER retired_image_reaction_insert_v260 BEFORE INSERT ON custom_reactions
WHEN NEW.image_path IS NOT NULL AND EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(NEW.image_path,'%2F','/'),'%2f','/') AS value
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_reaction_update_v260;
CREATE TRIGGER retired_image_reaction_update_v260 BEFORE UPDATE OF image_path ON custom_reactions
WHEN NEW.image_path IS NOT OLD.image_path AND NEW.image_path IS NOT NULL
  AND EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(NEW.image_path,'%2F','/'),'%2f','/') AS value
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_profile_insert_v260;
CREATE TRIGGER retired_image_profile_insert_v260 BEFORE INSERT ON profiles
WHEN NEW.avatar_url IS NOT NULL AND EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(NEW.avatar_url,'%2F','/'),'%2f','/') AS value
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;

DROP TRIGGER retired_image_profile_update_v260;
CREATE TRIGGER retired_image_profile_update_v260 BEFORE UPDATE OF avatar_url ON profiles
WHEN NEW.avatar_url IS NOT OLD.avatar_url AND NEW.avatar_url IS NOT NULL
  AND EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key>'')
BEGIN
  SELECT RAISE(ABORT,'question_image_retired') WHERE EXISTS (
    WITH RECURSIVE input_values(value) AS MATERIALIZED (
      SELECT replace(replace(NEW.avatar_url,'%2F','/'),'%2f','/') AS value
    ), input_budget(ok) AS MATERIALIZED (
      SELECT CASE WHEN sum(length(value)-length(replace(value,'/','')))>65536
        THEN RAISE(ABORT,'question_image_reference_too_complex') ELSE 1 END FROM input_values
    ), prefix_walk(owner_prefix) AS (
      SELECT min(owner_prefix) FROM private_retired_question_images
        INDEXED BY private_retired_question_image_owner_idx
      UNION ALL
      SELECT (SELECT min(owner_prefix) FROM private_retired_question_images
          INDEXED BY private_retired_question_image_owner_idx
          WHERE owner_prefix>p.owner_prefix)
        FROM prefix_walk p WHERE p.owner_prefix IS NOT NULL
    ), retired_prefixes(owner_prefix) AS MATERIALIZED (
      SELECT owner_prefix FROM prefix_walk WHERE owner_prefix IS NOT NULL
    ), inputs(input_id,value,input_length) AS MATERIALIZED (
      SELECT row_number() OVER (),v.value,length(v.value) FROM input_values v
        WHERE (SELECT ok FROM input_budget)=1 AND instr(v.value,'/')>0
          AND EXISTS (SELECT 1 FROM retired_prefixes p WHERE instr(v.value,p.owner_prefix)>0)
    ), chunks(input_id,input_length,offset) AS (
      SELECT input_id,input_length,1 FROM inputs
      UNION ALL
      SELECT input_id,input_length,offset+1024 FROM chunks
        WHERE offset+1024<=input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,value,previous,position) AS (
      SELECT text_id,value,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT text_id,value,position,position+instr(substr(value,position+1),'/')
        FROM slashes
        WHERE instr(substr(value,position+1),'/')>0
    ), segments(text_id,slash_position,segment) AS MATERIALIZED (
      SELECT s.text_id,s.position,
          substr(t.value,max(s.previous+1,s.position-1023),min(s.position-s.previous,1024))
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
    ), starts(text_id,slash_position,segment,position) AS (
      SELECT text_id,slash_position,segment,
          CASE WHEN instr(segment,' ')+instr(segment,char(34))+instr(segment,char(39))
              +instr(segment,'(')+instr(segment,'[')+instr(segment,'=')+instr(segment,'{')
              +instr(segment,char(9))+instr(segment,char(10))+instr(segment,char(13))=0
            THEN 1 ELSE length(segment) END
        FROM segments
      UNION ALL
      SELECT text_id,slash_position,segment,position-1 FROM starts WHERE position>1
    ), ends(tail,position) AS (
      SELECT substr(t.value,s.slash_position-length(s.segment)+s.position,1025),
          length(s.segment)-s.position+2
        FROM starts s JOIN text_values t ON t.text_id=s.text_id
        WHERE s.slash_position-length(s.segment)+s.position BETWEEN t.first_start AND t.last_start
          AND ((s.position>1
            AND instr('/ "''([={'||char(9)||char(10)||char(13),substr(s.segment,s.position-1,1))>0)
          OR (s.position=1 AND (s.slash_position=length(s.segment)
            OR instr('/ "''([={'||char(9)||char(10)||char(13),
              substr(t.value,s.slash_position-length(s.segment),1))>0)))
          AND EXISTS (
            SELECT 1 FROM private_retired_question_images
              INDEXED BY private_retired_question_image_owner_idx
              WHERE owner_prefix=substr(s.segment,s.position)
          )
      UNION ALL
      SELECT tail,position+1 FROM ends WHERE position<=length(tail) AND position<=1024
    )
    SELECT 1 FROM ends e
      WHERE (e.position>length(e.tail) OR instr('] ?#"''),;!>}'||char(9)||char(10)||char(13),
          substr(e.tail,e.position,1))>0)
        AND EXISTS (
          SELECT 1 FROM private_retired_question_images r
            WHERE r.object_key IN ('naga-question-assets/'||substr(e.tail,1,e.position-1),
              'question-assets/'||substr(e.tail,1,e.position-1))
        )
    LIMIT 1
  );
END;
