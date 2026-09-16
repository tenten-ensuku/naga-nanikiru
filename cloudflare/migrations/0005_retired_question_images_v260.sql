-- A private, initially empty allowlist for explicitly retired question images.
-- This migration does not retire, delete, or rewrite any existing data.
-- Operator order: back up images, register only reviewed keys, recheck all live
-- references while these guards are active, remove shared keys from this table,
-- then delete only the remaining reference-free R2 objects. Keep their rows here
-- after deletion so a stale editor or a later import cannot restore broken URLs.
CREATE TABLE private_retired_question_images (
  object_key TEXT NOT NULL PRIMARY KEY,
  path TEXT GENERATED ALWAYS AS (substr(object_key,instr(object_key,'/')+1)) VIRTUAL,
  owner_prefix TEXT GENERATED ALWAYS AS (substr(path,1,instr(path,'/'))) VIRTUAL,
  reason TEXT NOT NULL DEFAULT 'json-board-migration',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (substr(object_key,1,instr(object_key,'/')-1)
    IN ('naga-question-assets','question-assets')),
  CHECK (length(substr(object_key,instr(object_key,'/')+1)) BETWEEN 1 AND 1024),
  CHECK (instr(substr(object_key,instr(object_key,'/')+1),'/')>0),
  CHECK (instr('/'||object_key||'/','/../')=0 AND instr('/'||object_key||'/','/./')=0
    AND instr(object_key,char(92))=0 AND instr(object_key,'%')=0
    AND instr(object_key,'?')=0 AND instr(object_key,'#')=0)
);

-- Prefix probes only establish whether a candidate start is possible. They
-- stop at the first indexed match, even when thousands of keys share a book.
CREATE INDEX private_retired_question_image_owner_idx
  ON private_retired_question_images(owner_prefix);

-- Old attachments may omit the bucket. For each input string, visit its slash
-- positions and walk backward within that segment to valid start boundaries.
-- Enumerate distinct retired owner prefixes using indexed MIN/next-MIN seeks,
-- never by scanning every retired key. Before window or slash expansion, skip
-- strings that contain none of these prefixes (including large data URIs).
-- Full strings are materialized once, then searched in windows with 1024
-- disjoint start positions plus preceding/following context. Even a maximum
-- length path crossing a window boundary retains both adjacent characters.
-- Slash scans therefore inspect at most 2049 characters, and recursive rows
-- carry IDs and bounded segments rather than copies of an entire data URI.
-- A segment without internal start delimiters has only one possible start;
-- do not expand ordinary URL/base64 segments into one recursive row per byte.
-- Refuse more than 65536 slash occurrences across the inspected strings before
-- recursion. This caps pathological input expansion without silently skipping
-- any reference or imposing a small byte limit on existing embedded images.
-- Only starts with an indexed owner-prefix match enumerate ends (at most 1024
-- characters). Final checks use two exact object_key PK probes, never a scan
-- of the retired keys. Spaces and punctuation may occur inside a valid path,
-- so keep later end boundaries and later start occurrences as well.
-- D1 limits LIKE/GLOB patterns to 50 bytes, shorter than real image keys:
-- https://developers.cloudflare.com/d1/platform/limits/
-- No LIKE/GLOB pattern or wildcard interpretation is used.

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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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
    ), chunks(input_id,offset) AS (
      SELECT input_id,1 FROM inputs
      UNION ALL
      SELECT c.input_id,c.offset+1024 FROM chunks c JOIN inputs i ON i.input_id=c.input_id
        WHERE c.offset+1024<=i.input_length
    ), text_values(text_id,value,first_start,last_start) AS MATERIALIZED (
      SELECT row_number() OVER (),substr(i.value,max(1,c.offset-1),2048+(c.offset>1)),
          1+(c.offset>1),1024+(c.offset>1)
        FROM chunks c JOIN inputs i ON i.input_id=c.input_id
    ), slashes(text_id,previous,position) AS (
      SELECT text_id,0,instr(value,'/') FROM text_values
      UNION ALL
      SELECT s.text_id,s.position,s.position+instr(substr(t.value,s.position+1),'/')
        FROM slashes s JOIN text_values t ON t.text_id=s.text_id
        WHERE instr(substr(t.value,s.position+1),'/')>0
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

CREATE TRIGGER retired_image_link_insert_v260 BEFORE INSERT ON media_question_links
WHEN EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key=NEW.object_key)
BEGIN
  SELECT RAISE(ABORT,'question_image_retired');
END;

CREATE TRIGGER retired_image_link_update_v260 BEFORE UPDATE OF object_key,question_id ON media_question_links
WHEN (NEW.object_key IS NOT OLD.object_key OR NEW.question_id IS NOT OLD.question_id)
  AND EXISTS (SELECT 1 FROM private_retired_question_images WHERE object_key=NEW.object_key)
BEGIN
  SELECT RAISE(ABORT,'question_image_retired');
END;

-- answer_attempts, question_audit_events, and audit_archives are historical
-- records, not new live image references. They remain unchanged and writable.
